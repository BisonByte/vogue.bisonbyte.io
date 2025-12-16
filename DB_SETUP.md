Pasos rápidos para activar MySQL en cPanel
-----------------------------------------

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
   - Esto creará tablas `kv_store`, `items` y `clients` e insertará un registro demo para probar.

3) Configurar credenciales en el proyecto
   - Copia `config.example.php` a `config.local.php` y coloca tus datos:
     ```php
     return [
       'db_driver' => 'mysql', // o 'sqlite' si prefieres archivo local
       'db_host' => 'localhost',
       'db_port' => 3306,
       'db_name' => 'vogue_app',
       'db_user' => 'vogue_user',
       'db_pass' => 'TU_PASSWORD',
       'sqlite_path' => __DIR__ . '/storage/vogue.sqlite', // usado si no hay MySQL
       'cors_allowed_origin' => 'https://vogue.bisonbyte.io'
     ];
     ```
   - También puedes usar variables de entorno `DB_HOST`, `DB_NAME`, etc.
   - Si dejas las credenciales MySQL vacías, la app usará automáticamente SQLite en `storage/vogue.sqlite`, creando las tablas al vuelo.

4) Probar la conexión  
   - Abre `https://tu-dominio/api/export` (autenticado) para ver que ya lee desde MySQL.  
   - Los endpoints para clientes:  
     - `GET /api/clients`  
     - `POST /api/client` (JSON: { nombre, productoEnlace, monto, direccionEnvio, notas })  
     - `PUT /api/client` (JSON: { id, ...campos a editar })  
     - `DELETE /api/client?id=ID`

5) Copias de seguridad rápidas  
   - Ejecuta `backup.php` en el navegador o por CLI `php backup.php` para generar `storage/backups/vogue-backup-*.json` con kv, items y clients.

Notas
-----
- Si existía `storage/data.json`, se migrará automáticamente a MySQL la primera vez que se conecte.  
- El seeding crea un cliente demo y un item demo si las tablas están vacías.  
- La autenticación sigue siendo el usuario `admin` con contraseña `123` (cámbiala cuando gustes).
