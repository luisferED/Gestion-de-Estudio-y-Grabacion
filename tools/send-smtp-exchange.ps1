$ErrorActionPreference = "Stop"
$inputBase64 = [Console]::In.ReadToEnd().Trim()
$inputBytes = [System.Convert]::FromBase64String($inputBase64)
$inputJson = [System.Text.Encoding]::UTF8.GetString($inputBytes)
$payload = $inputJson | ConvertFrom-Json
$config = $payload.config
$message = $payload.message

$mail = [System.Net.Mail.MailMessage]::new()
$mail.From = [System.Net.Mail.MailAddress]::new(
  [string]$config.fromEmail,
  [string]$config.fromName,
  [System.Text.Encoding]::UTF8
)
foreach ($recipient in $message.to) {
  [void]$mail.To.Add([string]$recipient)
}
$mail.Subject = [string]$message.subject
$mail.SubjectEncoding = [System.Text.Encoding]::UTF8
$mail.HeadersEncoding = [System.Text.Encoding]::UTF8
$mail.Body = [string]$message.html
$mail.BodyEncoding = [System.Text.Encoding]::UTF8
$mail.BodyTransferEncoding = [System.Net.Mime.TransferEncoding]::Base64
$mail.IsBodyHtml = $true

$smtp = [System.Net.Mail.SmtpClient]::new([string]$config.host, [int]$config.port)
$smtp.DeliveryMethod = [System.Net.Mail.SmtpDeliveryMethod]::Network
$smtp.EnableSsl = ([string]$config.security -eq "starttls")
$smtp.Timeout = 20000

$username = [string]$config.username
$password = [string]$config.password
if ($username.Contains("\")) {
  $parts = $username.Split("\", 2)
  $smtp.Credentials = [System.Net.NetworkCredential]::new($parts[1], $password, $parts[0])
} else {
  $smtp.Credentials = [System.Net.NetworkCredential]::new($username, $password)
}

try {
  $smtp.Send($mail)
  [Console]::Out.Write('{"ok":true}')
} finally {
  $mail.Dispose()
  $smtp.Dispose()
}
