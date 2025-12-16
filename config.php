<?php
// Configuración base solo para MySQL (cPanel). Puedes sobreescribir cualquier valor creando config.local.php
// o definiendo variables de entorno (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS, CORS_ALLOWED_ORIGIN).

$config = [
    // Credenciales de la base creada en cPanel.
    'db_host' => getenv('DB_HOST') ?: 'localhost',
    'db_port' => getenv('DB_PORT') ?: 3306,
    'db_name' => getenv('DB_NAME') ?: 'ddiarsmuvk_vogue',
    'db_user' => getenv('DB_USER') ?: 'ddiarsmuvk_vogue',
    'db_pass' => getenv('DB_PASS') ?: 'CD1nb]GZ]oXQ',

    'cors_allowed_origin' => getenv('CORS_ALLOWED_ORIGIN') ?: 'https://vogue.bisonbyte.io',
];

$localFile = __DIR__ . '/config.local.php';
if (file_exists($localFile)) {
    $local = require $localFile;
    if (is_array($local)) {
        $config = array_merge($config, $local);
    }
}

return $config;
