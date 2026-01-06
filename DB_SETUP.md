Pasos rápidos para activar MySQL en cPanel
-----------------------------------------

Nota (nuevo backend Laravel)
---------------------------
- Los endpoints `/api/*` ahora los maneja **Laravel** (código en `backend/` y front controller público en `api/`).
- El frontend sigue siendo estático (`index.html` + `assets/`) y se conecta igual a `/api/...`.

1) Crear la base y el usuario en cPanel  
   - Entra a **MySQL Databases** en cPanel.  
   - Crea una base, por ejemplo `vogue_app`.  
   - Crea un usuario (ej. `vogue_user`) y asigna una contraseña segura.  
   - Concede **ALL PRIVILEGES** al usuario sobre la base.

2) Importar el esquema y datos demo (tester)  
   - Entra a **phpMyAdmin** y selecciona la base.  
   - Usa la pestaña **Importar** y sube el archivo `db_schema.sql` de este proyecto.  
   - Si prefieres CLI, un ejemplo:  
     ```bash
     mysql -u <usuario_cpanel> -p <base_de_datos> < db_schema.sql
     ```
   - Esto creará tablas `kv_store`, `items`, `clients` y `sync_events` e insertará un registro demo para probar.

3) Configurar credenciales en el proyecto
   - Copia `config.example.php` a `config.local.php` y coloca tus datos:
     ```php
     return [
       'db_host' => 'localhost',
       'db_port' => 3306,
       'db_name' => 'vogue_app',
       'db_user' => 'vogue_user',
       'db_pass' => 'TU_PASSWORD',
       'cors_allowed_origin' => 'https://vogue.bisonbyte.io'
     ];
     ```
   - También puedes usar variables de entorno `DB_HOST`, `DB_NAME`, etc.
   - MySQL es obligatorio; sin credenciales completas la aplicación mostrará un error.
   - Laravel tomará las credenciales desde `backend/.env` **o** automáticamente desde `config.php`/`config.local.php` (legacy).

4) Probar la conexión  
   - Abre `https://tu-dominio/` y haz login (por defecto `admin` / `123`).  
   - Para probar por CLI:  
     - `curl -H 'Content-Type: application/json' -d '{"username":"admin","password":"123"}' https://tu-dominio/api/login`  
     - Con el `token` devuelto: `curl -H "Authorization: Bearer <TOKEN>" https://tu-dominio/api/export`
   - Los endpoints para clientes:  
     - `GET /api/clients`  
     - `POST /api/client` (JSON: { nombre, productoEnlace, monto, direccionEnvio, notas })  
     - `PUT /api/client` (JSON: { id, ...campos a editar })  
     - `DELETE /api/client?id=ID`
   - Historial/auditoría de sincronización (para verificar que se guarda y se ve en todos lados):  
     - `GET /api/sync-events?limit=50`  
     - `GET /api/sync-events?key=vogue_clientes`  
     - `GET /api/sync-events?key=vogue_transacciones`

5) Migraciones Laravel (una vez)  
   - Ejecuta: `php backend/artisan migrate --force` para crear tablas auxiliares (cache/jobs) y `api_tokens`.
   - Tus tablas `kv_store`, `items`, `clients` se respetan (no se borran).

Notas
-----
- La autenticación por defecto sigue siendo `admin` / `123` (cámbiala en `backend/.env` con `VOGUE_ADMIN_PASSWORD_HASH`).  
- Para generar un hash bcrypt rápido: `php -r 'echo password_hash(\"TU_PASSWORD\", PASSWORD_BCRYPT), \"\\n\";'`  
- Para exportar datos: `GET /api/export` (requiere `Authorization: Bearer <TOKEN>`).  
- El frontend en un dispositivo nuevo: inicia sesión y recarga la página para que pueda hidratar datos desde `/api/export`.
