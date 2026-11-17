"""SMTP AUTH NTLMv2. Only allowlisted diagnostics, never wire/debug transcripts."""
import base64
import json
import logging
import os
import re
import smtplib
import ssl
import struct
import sys
from email.message import EmailMessage
from email.policy import SMTP
from email.utils import formataddr, formatdate

ERROR_TYPES = set('SmtpFailure ImportError ModuleNotFoundError AttributeError TypeError ValueError KeyError OSError TimeoutError ConnectionRefusedError ConnectionResetError BrokenPipeError gaierror SSLError SSLCertVerificationError SMTPException SMTPConnectError SMTPServerDisconnected SMTPResponseException SMTPHeloError SMTPAuthenticationError SMTPNotSupportedError SMTPSenderRefused SMTPRecipientsRefused SMTPDataError SpnegoError InvalidTokenError InvalidCredentialError BadMechanismError BadNameError NoCredentialError OperationNotAvailableError FeatureMissingError'.split())


class SmtpFailure(Exception):
    pass


class Diagnostics:
    def __init__(self):
        self.stage = 'prepare'
        self.operation = None

    def emit(self, event, **fields):
        print(json.dumps({'stage': self.stage, 'event': event, **({'operation': self.operation} if self.operation else {}), **fields}), file=sys.stderr, flush=True)

    def start(self, stage):
        self.stage = stage
        self.operation = None
        self.emit('start')

    def reply(self, code, response=b'', accepted=True):
        fields = {'smtp_code': code} if isinstance(code, int) and 100 <= code <= 599 else {}
        # Never inspect a 334 challenge; only retain numeric enhanced status codes.
        if code != 334 and isinstance(response, bytes):
            match = re.match(rb'^([245]\.\d{1,3}\.\d{1,3})(?:\s|$)', response)
            if match:
                fields['enhanced_code'] = match[1].decode('ascii')
        self.emit('ok' if accepted else 'error', **fields)

    def exception(self, error, reason):
        fields = {'reason': reason, 'error_type': type(error).__name__ if type(error).__name__ in ERROR_TYPES else 'UnexpectedError'}
        for key in ('errno', 'winerror', 'error_code', 'verify_code'):
            value = getattr(error, key, None)
            if isinstance(value, int) and not isinstance(value, bool):
                fields[key] = value
        code = getattr(error, 'smtp_code', None)
        if isinstance(code, int) and 100 <= code <= 599:
            fields['smtp_code'] = code
        reply = getattr(error, 'smtp_error', b'')
        if code != 334 and isinstance(reply, bytes):
            match = re.match(rb'^([245]\.\d{1,3}\.\d{1,3})(?:\s|$)', reply)
            if match:
                fields['enhanced_code'] = match[1].decode('ascii')
        # No str(error), repr(error), traceback locals, addresses or server text.
        self.emit('error', **fields)


class TracedSMTP:
    def getreply(self):
        code, response = super().getreply()
        trace = getattr(self, 'diagnostics', None)
        if trace is not None and trace.stage == 'data':
            trace.reply(code, response, code in (354, 250))
        return code, response

    def mail(self, sender, options=()):
        self.diagnostics.start('mail_from')
        code, response = super().mail(sender, options)
        self.diagnostics.reply(code, response, code == 250)
        return code, response

    def rcpt(self, recipient, options=()):
        self.diagnostics.start('rcpt_to')
        code, response = super().rcpt(recipient, options)
        self.diagnostics.reply(code, response, code in (250, 251))
        return code, response

    def data(self, msg):
        self.diagnostics.start('data')
        return super().data(msg)


class SMTPClient(TracedSMTP, smtplib.SMTP):
    pass


class SMTPSSLClient(TracedSMTP, smtplib.SMTP_SSL):
    pass


def send_mail(config, message, diagnostics=None):
    trace = diagnostics or Diagnostics()
    client = None
    reason = 'internal'
    try:
        os.environ['LM_COMPAT_LEVEL'] = '3'
        trace.start('dependency')
        reason = 'dependency'
        # Third-party debug logging can contain tokens. Our diagnostics use print.
        logging.disable(logging.CRITICAL)
        import spnego
        trace.emit('ok')
        trace.start('prepare')
        reason = 'config'
        security = config.get('security')
        port = config.get('port')
        if (security not in ('none', 'starttls', 'ssl') or not isinstance(port, int)
                or not 1 <= port <= 65535 or not config.get('host')
                or not config.get('username') or not config.get('password') or not message.get('to')):
            raise SmtpFailure('config')
        mail = EmailMessage(policy=SMTP)
        mail['From'] = formataddr((config.get('fromName', ''), config['fromEmail']))
        mail['To'] = ', '.join(message['to'])
        mail['Subject'] = message.get('subject', '')
        mail['Date'] = formatdate(localtime=False)
        mail.set_content(message.get('html', ''), subtype='html', charset='utf-8', cte='base64')
        trace.emit('ok')
        trace.start('connection')
        reason = 'connection'
        cls = SMTPSSLClient if security == 'ssl' else SMTPClient
        options = {'context': ssl.create_default_context()} if security == 'ssl' else {}
        client = cls(config['host'], port, timeout=15, **options)
        client.diagnostics = trace
        trace.reply(220)

        def ehlo():
            trace.start('ehlo')
            code, response = client.ehlo('gestion-estudios.local')
            trace.reply(code, response, code == 250)
            if code != 250:
                raise SmtpFailure('connection')

        ehlo()
        if security == 'starttls':
            trace.start('starttls')
            reason = 'tls'
            if not client.has_extn('starttls'):
                raise SmtpFailure('tls')
            code, response = client.starttls(context=ssl.create_default_context())
            trace.reply(code, response, code == 220)
            reason = 'connection'
            ehlo()
        trace.start('ntlm_negotiate')
        reason = 'capability'
        if 'NTLM' not in client.esmtp_features.get('auth', '').upper().split():
            raise SmtpFailure('capability')
        reason = 'internal'
        trace.operation = 'context'
        context = spnego.client(
            config['username'], config['password'], hostname=config['host'], service='smtp',
            protocol='ntlm', context_req=spnego.ContextReq.none,
            options=spnego.NegotiateOptions.use_ntlm,
        )
        trace.operation = 'type1'
        token = context.step()
        reason = 'auth'
        code, challenge = client.docmd('AUTH', 'NTLM ' + base64.b64encode(token).decode('ascii'))
        trace.reply(code, challenge, code == 334)
        if code != 334:
            raise SmtpFailure('auth')
        reason = 'challenge'
        trace.operation = 'type2'
        challenge = base64.b64decode(challenge, validate=True)
        if (len(challenge) < 48 or challenge[:8] != b'NTLMSSP\x00'
                or struct.unpack_from('<I', challenge, 8)[0] != 2):
            raise SmtpFailure('challenge')
        flags = struct.unpack_from('<I', challenge, 20)[0]
        info_length, _, info_offset = struct.unpack_from('<HHI', challenge, 40)
        if (flags & 0x00880000 != 0x00880000 or info_length < 4
                or info_offset < 48 or info_offset + info_length > len(challenge)):
            raise SmtpFailure('challenge')
        trace.operation = 'type3'
        response = context.step(challenge)
        if not context.complete or response is None:
            raise SmtpFailure('challenge')
        trace.emit('ok')
        trace.start('auth')
        reason = 'auth'
        code, reply = client.docmd(base64.b64encode(response).decode('ascii'))
        trace.reply(code, reply, code == 235)
        if code != 235:
            raise SmtpFailure('auth')
        reason = 'message'
        refused = client.send_message(mail, from_addr=config['fromEmail'], to_addrs=message['to'])
        if refused:
            # Keep existing partial-recipient behavior, but identify RCPT rather than DATA.
            trace.stage = 'rcpt_to'
            raise SmtpFailure('message')
        trace.start('quit')
        try:
            code, reply = client.quit()
            trace.reply(code, reply, code == 221)
        except (OSError, smtplib.SMTPException) as error:
            trace.exception(error, 'connection')
            # DATA accepted already: avoid a false failure that invites duplicates.
    except Exception as error:
        if isinstance(error, SmtpFailure):
            reason = str(error)  # Only our fixed identifiers, never third-party text.
        elif isinstance(error, ssl.SSLError):
            reason = 'tls'
        trace.exception(error, reason)
        raise SmtpFailure(reason) from None
    finally:
        if client is not None:
            client.close()


def main():
    trace = Diagnostics()
    try:
        payload = json.loads(sys.stdin.read(1024 * 1024 + 1))
        send_mail(payload['config'], payload['message'], trace)
        print(json.dumps({'ok': True}))
        return 0
    except SmtpFailure as error:
        print(json.dumps({'error': str(error)}))
    except Exception as error:
        trace.exception(error, 'internal')
        print(json.dumps({'error': 'internal'}))
    return 1


if __name__ == '__main__':
    sys.exit(main())
