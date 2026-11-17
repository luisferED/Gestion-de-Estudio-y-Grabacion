"""No sockets, credentials or real SMTP messages in these unit tests."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('smtp_ntlm', Path(__file__).resolve().parents[1] / 'tools' / 'smtp-ntlm.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
SECRET = 'PRIVATE_PASSWORD_HASH_TOKEN_MESSAGE'
CONFIG = dict(host='fixture.invalid', port=587, security='none', username='fictional', password=SECRET, fromEmail='sender@example.test')
MESSAGE = dict(to=['recipient@example.test'], subject=SECRET, html=SECRET)


class FakeSMTP:
    esmtp_features = {'auth': 'GSSAPI NTLM'}
    def __init__(self, *args, **kwargs):
        pass
    def ehlo(self, *args):
        return 250, SECRET.encode()
    def close(self):
        pass


class DiagnosticsTests(unittest.TestCase):
    def test_unexpected_ntlm_initialization_error_is_attributed_without_its_message(self):
        fake = types.SimpleNamespace(client=lambda *a, **kw: (_ for _ in ()).throw(AttributeError(SECRET)), ContextReq=types.SimpleNamespace(none=0), NegotiateOptions=types.SimpleNamespace(use_ntlm=1))
        stream = io.StringIO()
        with patch.dict('sys.modules', {'spnego': fake}), patch.object(helper, 'SMTPClient', FakeSMTP), contextlib.redirect_stderr(stream):
            with self.assertRaises(helper.SmtpFailure):
                helper.send_mail(CONFIG, MESSAGE)
        events = [json.loads(line) for line in stream.getvalue().splitlines()]
        last = events[-1]
        self.assertEqual(last['stage'], 'ntlm_negotiate')
        self.assertEqual(last['operation'], 'context')
        self.assertEqual(last['error_type'], 'AttributeError')
        self.assertNotIn(SECRET, stream.getvalue())

    def test_exception_records_only_numeric_os_fields(self):
        trace = helper.Diagnostics()
        trace.stage = 'connection'
        stream = io.StringIO()
        with contextlib.redirect_stderr(stream):
            trace.exception(ConnectionRefusedError(111, SECRET), 'connection')
        result = json.loads(stream.getvalue())
        self.assertEqual(result['errno'], 111)
        self.assertEqual(result['error_type'], 'ConnectionRefusedError')
        self.assertNotIn(SECRET, stream.getvalue())

    def test_challenge_and_error_response_text_never_enter_diagnostics(self):
        stream = io.StringIO()
        trace = helper.Diagnostics()
        with contextlib.redirect_stderr(stream):
            trace.reply(334, SECRET.encode())
            trace.exception(helper.smtplib.SMTPDataError(554, b'5.6.0 ' + SECRET.encode()), 'message')
        events = [json.loads(line) for line in stream.getvalue().splitlines()]
        self.assertEqual(events[0]['smtp_code'], 334)
        self.assertNotIn('enhanced_code', events[0])
        self.assertEqual(events[1]['enhanced_code'], '5.6.0')
        self.assertEqual(events[1]['smtp_code'], 554)
        self.assertNotIn(SECRET, stream.getvalue())


if __name__ == '__main__':
    unittest.main()
