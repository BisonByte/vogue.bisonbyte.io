// Bridge Profesional v6: Server Authority Pattern
// Garantiza que el Servidor es la fuente de verdad antes de iniciar la App.

(function() {
  // 1. Intercepción Crítica del Almacenamiento
  // Capturamos las funciones originales antes de que React pueda tocarlas.
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;
  const originalGetItem = Storage.prototype.getItem;
  
  // Variables de estado de sincronización
  const lastSynced = {}; // Memoria de lo último que el servidor nos envió
  const dirtyKeys = new Set(); // Llaves que han cambiado localmente y necesitan subirse
  let flushTimer = null;
  const TOKEN_KEY = 'vogue_token';
  const SESSION_KEY = 'vogue_sesion';
  const SERVER_SYNC_EXCLUDED_KEYS = ['vogue_sesion', 'vogue_user', 'vogue_token'];
  const DELETE_INTENT_KEY = 'vogue_delete_intent';
  const DELETE_INTENT_TTL_MS = 5 * 60 * 1000;
  const PROTECTED_KEYS = new Set(['vogue_clientes', 'vogue_transacciones']);
  let serverSessionPromise = null;
  let serverSessionReady = false;

  // ==========================================
  // GUARDIA DE BORRADO (Confirmacion humana)
  // ==========================================

  const originalConfirm = window.confirm;

  function shouldMarkDeleteIntent(message) {
    if (!message) return false;
    const text = String(message).toLowerCase();
    return text.includes('borrar') || text.includes('eliminar') || text.includes('elimin');
  }

  function resolveDeleteTarget(message) {
    const text = String(message || '').toLowerCase();
    if (text.includes('cliente')) return 'vogue_clientes';
    if (text.includes('registro') || text.includes('historial')) return 'vogue_transacciones';
    return '*';
  }

  function recordDeleteIntent(message) {
    const payload = {
      ts: Date.now(),
      target: resolveDeleteTarget(message)
    };
    try {
      sessionStorage.setItem(DELETE_INTENT_KEY, JSON.stringify(payload));
    } catch (e) {}
  }

  function readDeleteIntent() {
    try {
      const raw = sessionStorage.getItem(DELETE_INTENT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.ts !== 'number') return null;
      const age = Date.now() - parsed.ts;
      if (age < 0 || age > DELETE_INTENT_TTL_MS) {
        sessionStorage.removeItem(DELETE_INTENT_KEY);
        return null;
      }
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function clearDeleteIntent() {
    try {
      sessionStorage.removeItem(DELETE_INTENT_KEY);
    } catch (e) {}
  }

  function extractKeyFromBody(body) {
    if (!body) return null;
    if (typeof body === 'string') {
      try {
        const parsed = JSON.parse(body);
        return parsed && typeof parsed.key === 'string' ? parsed.key : null;
      } catch (e) {
        return null;
      }
    }
    if (typeof body === 'object' && typeof body.key === 'string') {
      return body.key;
    }
    return null;
  }

  function extractKeyFromPath(path) {
    try {
      const url = new URL(path, window.location.origin);
      return url.searchParams.get('key');
    } catch (e) {
      return null;
    }
  }

  function resolveDeleteIntentForRequest(path, options) {
    if (typeof path !== 'string') return null;
    const method = options && options.method ? String(options.method).toUpperCase() : 'GET';
    if (method === 'GET') return null;

    const isSave = path.includes('/api/save');
    const isDelete = path.includes('/api/delete');
    const isClientDelete = path.includes('/api/client') && method === 'DELETE';
    if (!isSave && !isDelete && !isClientDelete) return null;

    const intent = readDeleteIntent();
    if (!intent) return null;

    let key = null;
    if (isSave) {
      key = extractKeyFromBody(options && options.body);
    } else if (isDelete) {
      key = extractKeyFromPath(path) || extractKeyFromBody(options && options.body);
    }

    if (intent.target && intent.target !== '*' && key && intent.target !== key) return null;
    if (intent.target && intent.target !== '*' && !key && !isClientDelete) return null;
    return intent;
  }

  if (typeof originalConfirm === 'function') {
    window.confirm = function(message) {
      const result = originalConfirm.call(window, message);
      if (result && shouldMarkDeleteIntent(message)) {
        recordDeleteIntent(message);
      }
      return result;
    };
  }

  // ==========================================
  // LÓGICA DE API (Comunicación Backend)
  // ==========================================
  async function apiFetch(path, options = {}) {
    const token = originalGetItem.call(localStorage, TOKEN_KEY);
    const headers = new Headers(options.headers || {});
    if (token) headers.set('Authorization', 'Bearer ' + token);
    const deleteIntent = resolveDeleteIntentForRequest(path, options);
    if (deleteIntent) {
      headers.set('X-Vogue-Delete-Intent', String(deleteIntent.ts));
    }
    const finalOptions = Object.assign({ credentials: 'same-origin' }, options, { headers });
    
    try {
      const res = await fetch(path, finalOptions);
      if (deleteIntent && res && res.ok) {
        clearDeleteIntent();
      }
      if (res.status === 401 && token) clearLocalAuth();
      return res;
    } catch (e) {
      console.error('[API Error]', e);
      throw e;
    }
  }

  function clearLocalAuth() {
    originalRemoveItem.call(localStorage, 'vogue_user');
    originalRemoveItem.call(localStorage, TOKEN_KEY);
  }

  function isLocalSessionActive() {
    return originalGetItem.call(localStorage, SESSION_KEY) === 'true';
  }

  function getAdminCredentials() {
    const user = window.__VOGUE_ADMIN_USER || 'admin';
    const pass = window.__VOGUE_ADMIN_PASS || '123';
    if (!user || !pass) return null;
    return { username: user, password: pass };
  }

  async function ensureServerSession() {
    if (serverSessionReady) return true;
    if (serverSessionPromise) return serverSessionPromise;

    serverSessionPromise = (async () => {
      try {
        const meRes = await apiFetch('/api/me');
        if (meRes.ok) {
          const me = await meRes.json();
          if (me && me.user) {
            serverSessionReady = true;
            return true;
          }
        }
      } catch (e) {}

      const creds = getAdminCredentials();
      if (!creds) return false;

      try {
        const loginRes = await apiFetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(creds),
        });
        if (!loginRes.ok) return false;
        const data = await loginRes.json();
        if (data && data.ok) {
          serverSessionReady = true;
          return true;
        }
      } catch (e) {}
      return false;
    })();

    const ok = await serverSessionPromise;
    if (!ok) serverSessionPromise = null;
    return ok;
  }

  function canSync() {
    const token = originalGetItem.call(localStorage, TOKEN_KEY);
    return isLocalSessionActive() || !!token;
  }

  // ==========================================
  // LÓGICA DE SINCRONIZACIÓN (Core)
  // ==========================================
  
  // Guardar en el servidor (Push)
  async function serverSave(key, value) {
    if (value === null || value === undefined) return;
    if (!canSync()) return;
    
    // Evitar bucles: Si lo que vamos a guardar es igual a lo que el servidor nos dio, no hacemos nada.
    const payloadStr = JSON.stringify(value);
    if (lastSynced[key] === payloadStr) {
      return;
    }
    
    console.log(`[Sync] Enviando cambios al servidor: ${key}`);
    
    try {
      if (!(await ensureServerSession())) {
        console.warn('[Sync] Sesion de servidor no disponible.');
        return;
      }
      const res = await apiFetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      if (res && res.status === 401) {
        serverSessionReady = false;
      }
      if (res && res.ok) {
        lastSynced[key] = payloadStr;
      }
    } catch (e) {
      console.warn(`[Sync] Fallo al guardar ${key}`, e);
    }
  }

  // Borrar en el servidor
  async function serverDelete(key) {
    delete lastSynced[key];
    try {
      if (!(await ensureServerSession())) return;
      const res = await apiFetch('/api/delete?key=' + encodeURIComponent(key), { method: 'DELETE' });
      if (res && res.status === 401) {
        serverSessionReady = false;
      }
    } catch (e) {}
  }

  // Marcar como sucio (Cola de espera)
  function markDirty(key) {
    if (SERVER_SYNC_EXCLUDED_KEYS.includes(key)) return;
    dirtyKeys.add(key);
    
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flushDirty, 1000); // Debounce de 1 segundo
  }

  // Ejecutar sincronización (Flush)
  async function flushDirty() {
    if (dirtyKeys.size === 0) return;
    if (!canSync()) {
      flushTimer = setTimeout(flushDirty, 2000);
      return;
    }
    const keys = Array.from(dirtyKeys);
    dirtyKeys.clear();
    
    for (const key of keys) {
      const val = originalGetItem.call(localStorage, key);
      if (val === null) {
        await serverDelete(key);
      } else {
        try {
          const parsed = JSON.parse(val);
          await serverSave(key, parsed);
        } catch (e) {
          // Si no es JSON válido, lo guardamos como string o lo ignoramos
        }
      }
    }
  }

  // ==========================================
  // INICIALIZACIÓN PROFESIONAL
  // ==========================================
  
  async function initializeApp() {
    console.log('[System] Iniciando secuencia de arranque profesional...');
    
    // 1. Verificar sesión local o token
    const token = originalGetItem.call(localStorage, TOKEN_KEY);
    
    if (token || isLocalSessionActive()) {
      // 2. Descargar TODOS los datos del servidor (Single Source of Truth)
      try {
        await ensureServerSession();
        console.log('[System] Descargando base de datos remota...');
        const res = await apiFetch('/api/export');
        if (res.ok) {
          const data = await res.json();
          const serverKV = data.kv || {};

          // 3. Hidratar LocalStorage (El servidor manda)
          Object.keys(serverKV).forEach(key => {
            if (SERVER_SYNC_EXCLUDED_KEYS.includes(key)) return;
            
            const serverValue = serverKV[key];
            const serverStr = JSON.stringify(serverValue);
            
            // Guardamos en memoria que esto vino del servidor
            lastSynced[key] = serverStr;
            
            // Sobrescribimos LocalStorage sin piedad
            // Esto evita que datos viejos del celular borren datos nuevos del servidor
            originalSetItem.call(localStorage, key, serverStr);
            console.log(`[System] Sincronizado: ${key}`);
          });
        }
      } catch (e) {
        console.error('[System] Error crítico conectando al servidor', e);
        // Opcional: Mostrar alerta al usuario de que está offline
      }
    }

    // 4. Iniciar la App Visual (React)
    // Solo ahora que los datos están listos, permitimos que React arranque.
    loadReactApp();
  }

  function loadReactApp() {
    const scriptTag = document.getElementById('app-script');
    if (scriptTag && scriptTag.dataset.src) {
      console.log('[System] Ejecutando Frontend...');
      const script = document.createElement('script');
      script.type = 'module';
      script.crossOrigin = true;
      script.src = scriptTag.dataset.src;
      document.head.appendChild(script);
    }
  }

  // ==========================================
  // OVERRIDES (Interceptores)
  // ==========================================
  
  // Sobrescribimos setItem para detectar cambios que haga React
  Storage.prototype.setItem = function(key, value) {
    originalSetItem.call(this, key, value);
    markDirty(key);
  };

  Storage.prototype.removeItem = function(key) {
    if (PROTECTED_KEYS.has(key)) {
      const intent = readDeleteIntent();
      if (!intent || (intent.target && intent.target !== '*' && intent.target !== key)) {
      console.warn('[Guard] Borrado bloqueado para', key);
      return;
      }
    }
    originalRemoveItem.call(this, key);
    markDirty(key);
  };

  // Exponer API pública para login manual si es necesario
  window.appDB = {
    login: async (u, p) => {
      const res = await apiFetch('/api/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: u, password: p})
      });
      const d = await res.json();
      if (d.ok) {
        if (d.token) {
          originalSetItem.call(localStorage, TOKEN_KEY, d.token);
        }
        serverSessionReady = true;
      }
      return d;
    },
    logout: async () => {
      await apiFetch('/api/logout', {method: 'POST'});
      clearLocalAuth();
      window.location.reload();
    },
    save: async (key, value) => {
      if (!(await ensureServerSession())) {
        return { ok: false, error: 'No autenticado' };
      }
      const res = await apiFetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      return res.json();
    },
    export: async () => {
      if (!(await ensureServerSession())) {
        return { ok: false, error: 'No autenticado' };
      }
      const res = await apiFetch('/api/export');
      return res.json();
    }
  };

  // Arrancar el sistema cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
  } else {
    initializeApp();
  }

})();
