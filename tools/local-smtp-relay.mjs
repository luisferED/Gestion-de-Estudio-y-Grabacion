import http from "node:http";
import net from "node:net";
import tls from "node:tls";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.LOCAL_SMTP_RELAY_PORT || 3127);
const HOST = "127.0.0.1";
const MAX_BODY = 1024 * 1024;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const cleanHeader = (value = "") => String(value).replace(/[\r\n]+/g, " ").trim();
const base64 = (value = "") => Buffer.from(String(value), "utf8").toString("base64");

function smtpError(stage, error) {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(`${stage}: ${detail}`);
}

function connection(host, port, secure, rejectUnauthorized) {
  return new Promise((resolve, reject) => {
    const options = { host, port, timeout: 12000 };
    const socket = secure
      ? tls.connect({ ...options, servername: net.isIP(host) ? undefined : host, rejectUnauthorized })
      : net.connect(options);
    const fail = (error) => reject(smtpError("No se pudo conectar con Exchange", error));
    socket.once("error", fail);
    socket.once(secure ? "secureConnect" : "connect", () => {
      socket.off("error", fail);
      socket.setTimeout(15000, () => socket.destroy(new Error("Tiempo de espera agotado.")));
      resolve(socket);
    });
  });
}

function sendWithWindowsExchange(config, message) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "tools", "send-smtp-exchange.ps1")],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "";
    let errors = "";
    child.stdout.on("data", chunk => { output += chunk.toString("utf8"); });
    child.stderr.on("data", chunk => { errors += chunk.toString("utf8"); });
    child.on("error", error => reject(smtpError("No se pudo iniciar el autenticador de Windows", error)));
    child.on("exit", code => {
      if (code === 0 && output.includes('"ok":true')) resolve();
      else reject(new Error(`Exchange rechazó la autenticación NTLM o el envío: ${errors.trim() || output.trim() || `código ${code}`}`));
    });
    const encodedPayload = Buffer.from(JSON.stringify({ config, message }), "utf8").toString("base64");
    child.stdin.end(encodedPayload);
  });
}

function replyReader(socket) {
  let buffer = "";
  const pending = [];
  const settle = () => {
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const match = line.match(/^(\d{3})([ -])/);
      if (!match || match[2] !== " " || !pending.length) continue;
      const item = pending.shift();
      const code = Number(match[1]);
      if (item.expected.includes(code)) item.resolve({ code, line });
      else item.reject(new Error(`Exchange respondió ${code}: ${line}`));
    }
  };
  socket.on("data", chunk => {
    buffer += chunk.toString("utf8");
    settle();
  });
  socket.on("error", error => {
    while (pending.length) pending.shift().reject(error);
  });
  socket.on("close", () => {
    while (pending.length) pending.shift().reject(new Error("Exchange cerró la conexión."));
  });
  return expected => new Promise((resolve, reject) => pending.push({ expected, resolve, reject }));
}

async function sendMail(config, message) {
  const host = String(config.host || "").trim();
  const port = Number(config.port);
  const security = String(config.security || "starttls");
  const rejectUnauthorized = true;
  if(config.authMode==="login" && security==="none") throw new Error("AUTH LOGIN requiere TLS.");
  if(!["none","login"].includes(config.authMode)) throw new Error("NTLM/Kerberos/OAuth2 requieren una adaptaci?n adicional en Linux.");
  if (!host) throw new Error("Falta el servidor SMTP.");
  if (!Number.isInteger(port)) throw new Error("El puerto SMTP no es válido.");
  if (!message?.to?.length) throw new Error("No hay destinatarios.");
  if (process.platform === "win32" && config.authMode === "login" && security !== "ssl") {
    await sendWithWindowsExchange(config, message);
    return;
  }

  let socket = await connection(host, port, security === "ssl", rejectUnauthorized);
  let read = replyReader(socket);
  const write = async (value, expected) => {
    socket.write(`${value}\r\n`, "utf8");
    return read(expected);
  };

  await read([220]).catch(error => { throw smtpError("Exchange no presentó el servicio SMTP", error); });
  await write("EHLO gestion-grabaciones.local", [250]).catch(error => { throw smtpError("Exchange rechazó EHLO", error); });

  if (security === "starttls") {
    await write("STARTTLS", [220]).catch(error => {
      throw smtpError("Exchange no aceptó STARTTLS; confirme que usa el puerto 587", error);
    });
    socket.removeAllListeners("data");
    socket = await new Promise((resolve, reject) => {
      const secureSocket = tls.connect({
        socket,
        servername: net.isIP(host) ? undefined : host,
        rejectUnauthorized,
      });
      secureSocket.once("secureConnect", () => resolve(secureSocket));
      secureSocket.once("error", error => reject(smtpError("Falló el certificado TLS de Exchange", error)));
    });
    read = replyReader(socket);
    await write("EHLO gestion-grabaciones.local", [250]);
  }

  if (config.authMode === "login") {
    if (!config.username || !config.password) throw new Error("Faltan el usuario o la contraseña SMTP.");
    await write("AUTH LOGIN", [334]).catch(error => { throw smtpError("Exchange no permite AUTH LOGIN", error); });
    await write(base64(config.username), [334]);
    await write(base64(config.password), [235]).catch(error => {
      throw smtpError("Exchange rechazó el usuario o la contraseña", error);
    });
  }

  await write(`MAIL FROM:<${cleanHeader(config.fromEmail)}>`, [250]).catch(error => {
    throw smtpError("Exchange rechazó el remitente", error);
  });
  for (const recipient of message.to) {
    await write(`RCPT TO:<${cleanHeader(recipient)}>`, [250, 251]).catch(error => {
      throw smtpError(`Exchange rechazó al destinatario ${recipient}`, error);
    });
  }
  await write("DATA", [354]);

  const subject = `=?UTF-8?B?${base64(cleanHeader(message.subject))}?=`;
  const fromName = `=?UTF-8?B?${base64(cleanHeader(config.fromName || "Gestión de Grabaciones ED"))}?=`;
  const html = String(message.html || "").replace(/(^|\r?\n)\./g, "$1..");
  const data = [
    `From: ${fromName} <${cleanHeader(config.fromEmail)}>`,
    `To: ${message.to.map(cleanHeader).join(", ")}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    `Date: ${new Date().toUTCString()}`,
    "",
    html,
    ".",
  ].join("\r\n") + "\r\n";
  socket.write(data, "utf8");
  await read([250]).catch(error => { throw smtpError("Exchange no aceptó el mensaje", error); });
  try { await write("QUIT", [221]); } catch {}
  socket.end();
}

const server = http.createServer((request, response) => {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  if (request.method === "GET" && request.url === "/health") {
    response.end(JSON.stringify({ ok: true, service: "smtp-local-relay" }));
    return;
  }
  const isMail = request.method === "POST" && request.url === "/send";
  if (!isMail) {
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "Ruta inexistente." }));
    return;
  }
  let body = "";
  request.on("data", chunk => {
    body += chunk;
    if (body.length > MAX_BODY) request.destroy();
  });
  request.on("end", async () => {
    try {
      const payload = JSON.parse(body);
      await sendMail(payload.config, payload.message);
      response.end(JSON.stringify({ ok: true }));
    } catch (error) {
      response.statusCode = 502;
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "No se pudo enviar el correo." }));
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[SMTP local] Relay listo en http://${HOST}:${PORT}`);
});

server.on("error", error => {
  if (error.code === "EADDRINUSE") {
    console.log(`[SMTP local] El relay ya está activo en el puerto ${PORT}.`);
    process.exit(0);
  }
  throw error;
});
