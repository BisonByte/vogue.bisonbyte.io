<?php

function mailConfig(): array {
    $config = loadConfig();
    return [
        'host' => $config['mail_host'] ?? '',
        'port' => $config['mail_port'] ?? 0,
        'secure' => $config['mail_secure'] ?? 'ssl',
        'user' => $config['mail_user'] ?? '',
        'pass' => $config['mail_pass'] ?? '',
        'from' => $config['mail_from'] ?? ($config['mail_user'] ?? ''),
        'from_name' => $config['mail_from_name'] ?? 'Vogue',
        'to' => $config['security_email'] ?? ($config['mail_user'] ?? ''),
    ];
}

function sendSecurityEmail(string $subject, string $textBody, ?string $htmlBody = null): bool {
    $cfg = mailConfig();
    if ($cfg['host'] === '' || $cfg['to'] === '') {
        return false;
    }
    $htmlBody = $htmlBody ?? nl2br(htmlspecialchars($textBody, ENT_QUOTES, 'UTF-8'));
    return smtpSendMail($cfg, $cfg['to'], $subject, $textBody, $htmlBody);
}

function smtpSendMail(array $cfg, string $to, string $subject, string $textBody, string $htmlBody): bool {
    $host = $cfg['host'] ?? '';
    $port = (int) ($cfg['port'] ?? 0);
    $secure = strtolower((string) ($cfg['secure'] ?? ''));
    $user = (string) ($cfg['user'] ?? '');
    $pass = (string) ($cfg['pass'] ?? '');
    $from = (string) ($cfg['from'] ?? '');
    $fromName = (string) ($cfg['from_name'] ?? '');

    if ($host === '' || $port <= 0 || $from === '') {
        return false;
    }

    $transport = ($secure === 'ssl') ? "ssl://{$host}:{$port}" : "{$host}:{$port}";
    $fp = @stream_socket_client($transport, $errno, $errstr, 12, STREAM_CLIENT_CONNECT);
    if (!$fp) {
        error_log("SMTP connect failed: {$errstr}");
        return false;
    }

    $hostname = gethostname() ?: 'localhost';
    if (!smtpExpect($fp, 220)) return false;
    if (!smtpCommand($fp, "EHLO {$hostname}", 250)) return false;

    if ($secure === 'tls') {
        if (!smtpCommand($fp, "STARTTLS", 220)) return false;
        if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
            return false;
        }
        if (!smtpCommand($fp, "EHLO {$hostname}", 250)) return false;
    }

    if ($user !== '' && $pass !== '') {
        if (!smtpCommand($fp, "AUTH LOGIN", 334)) return false;
        if (!smtpCommand($fp, base64_encode($user), 334)) return false;
        if (!smtpCommand($fp, base64_encode($pass), 235)) return false;
    }

    if (!smtpCommand($fp, "MAIL FROM:<{$from}>", 250)) return false;
    if (!smtpCommand($fp, "RCPT TO:<{$to}>", 250)) return false;
    if (!smtpCommand($fp, "DATA", 354)) return false;

    $boundary = 'vogue-' . bin2hex(random_bytes(12));
    $fromHeader = $fromName !== '' ? "{$fromName} <{$from}>" : $from;
    $headers = [
        "From: {$fromHeader}",
        "To: {$to}",
        "Subject: {$subject}",
        "MIME-Version: 1.0",
        "Content-Type: multipart/alternative; boundary=\"{$boundary}\"",
    ];

    $body = [];
    $body[] = "--{$boundary}";
    $body[] = "Content-Type: text/plain; charset=UTF-8";
    $body[] = "Content-Transfer-Encoding: 8bit";
    $body[] = "";
    $body[] = $textBody;
    $body[] = "--{$boundary}";
    $body[] = "Content-Type: text/html; charset=UTF-8";
    $body[] = "Content-Transfer-Encoding: 8bit";
    $body[] = "";
    $body[] = $htmlBody;
    $body[] = "--{$boundary}--";

    $payload = implode("\r\n", array_merge($headers, ["", implode("\r\n", $body)])) . "\r\n.";
    fwrite($fp, $payload . "\r\n");
    $sent = smtpExpect($fp, 250);
    smtpCommand($fp, "QUIT", 221);
    fclose($fp);
    return $sent;
}

function smtpCommand($fp, string $command, int $expected): bool {
    fwrite($fp, $command . "\r\n");
    return smtpExpect($fp, $expected);
}

function smtpExpect($fp, int $expected): bool {
    $response = smtpRead($fp);
    if ($response === null) {
        return false;
    }
    return (int) substr($response, 0, 3) === $expected;
}

function smtpRead($fp): ?string {
    $data = '';
    while (!feof($fp)) {
        $line = fgets($fp, 512);
        if ($line === false) break;
        $data .= $line;
        if (isset($line[3]) && $line[3] === ' ') {
            break;
        }
    }
    return $data !== '' ? $data : null;
}
