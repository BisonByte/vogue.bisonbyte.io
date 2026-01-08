<?php
$backendPublic = __DIR__ . '/backend/public/index.php';
$frontendIndex = __DIR__ . '/index.html';

// Prioridad 1: si existe un backend Laravel, se carga.
if (file_exists($backendPublic)) {
    require $backendPublic;
    exit;
}

// Prioridad 2: si existe el build estático, se sirve directamente.
if (file_exists($frontendIndex)) {
    readfile($frontendIndex);
    exit;
}

// Fallback: mensaje de mantenimiento solo si no hay frontend ni backend.
http_response_code(503);
?><!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Sitio en mantenimiento / configuración</title>
  <style>body{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#222} code{background:#f4f4f4;padding:2px 6px;border-radius:4px}</style>
</head>
<body>
  <h1>La aplicación no está desplegada</h1>
  <p>No se encontró <code>backend/public/index.php</code> ni <code>index.html</code> (build del frontend).</p>
  <p>Sube tu build de frontend (Vite/React) o coloca tu aplicación Laravel dentro de <code>backend/</code>.</p>
</body>
</html>
