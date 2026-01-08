<?php
// Copia este archivo a config.local.php y rellena tus credenciales de cPanel/MySQL.
// También puedes usar variables de entorno DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS.

return [
    // Usa MySQL con los datos que te entrega cPanel. SQLite ya no está soportado.
    'db_host' => 'localhost',
    'db_port' => 3306,
    'db_name' => 'cpanel_db_name',
    'db_user' => 'cpanel_db_user',
    'db_pass' => 'cpanel_db_password',

    // Ajusta el origen permitido si usas otro dominio o subdominio.
    'cors_allowed_origin' => 'https://vogue.bisonbyte.io',

    // URL base de la aplicacion para enlaces de recuperacion.
    'app_url' => 'https://vogue.bisonbyte.io',

    // Configuracion SMTP para notificaciones de seguridad.
    'mail_host' => 'mail.spacemail.com',
    'mail_port' => 465,
    'mail_secure' => 'ssl', // ssl o tls
    'mail_user' => 'correo@tu-dominio.com',
    'mail_pass' => 'tu_password',
    'mail_from' => 'correo@tu-dominio.com',
    'mail_from_name' => 'Vogue Shein',
    'security_email' => 'reportes@tu-dominio.com',
];
