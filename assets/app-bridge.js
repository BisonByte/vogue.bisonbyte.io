// Bridge between the static React build and the PHP backend API.
// Keeps this logic out of index.html to make the entrypoint cleaner/safer.

// CRITICAL: Override Storage.prototype.setItem IMMEDIATELY before anything else
(function() {
  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = originalSetItem; // Ensure we have the original
  console.log('[app-bridge] Storage.prototype override prepared');
})();

(function () {
  const TOKEN_KEY = 'vogue_token';

  function clearLocalAuth() {
    localStorage.removeItem('vogue_sesion');
    localStorage.removeItem('vogue_user');
    localStorage.removeItem(TOKEN_KEY);
  }

  async function apiFetch(path, options = {}) {
    const token = localStorage.getItem(TOKEN_KEY);
    const headers = new Headers(options.headers || {});
    if (token) headers.set('Authorization', 'Bearer ' + token);

    const finalOptions = Object.assign({ credentials: 'same-origin' }, options, { headers });
    const res = await fetch(path, finalOptions);
    if (res.status === 401) {
      clearLocalAuth();
    }
    return res;
  }

  const api = {
    login: async (username, password) => {
      const res = await apiFetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data && data.ok && data.token) {
        try {
          localStorage.setItem(TOKEN_KEY, data.token);
        } catch (e) {}
      }
      return data;
    },
    logout: async () => {
      const res = await apiFetch('/api/logout', { method: 'POST' });
      const data = await res.json().catch(() => ({ ok: false }));
      clearLocalAuth();
      return data;
    },
    me: async () => {
      const res = await apiFetch('/api/me');
      return res.json();
    },
    save: async (key, value) => {
      const res = await apiFetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      return res.json();
    },
    load: async (key) => {
      const res = await apiFetch('/api/load?key=' + encodeURIComponent(key));
      return res.json();
    },
    deleteKey: async (key) => {
      const res = await apiFetch('/api/delete?key=' + encodeURIComponent(key), { method: 'DELETE' });
      return res.json();
    },
    addItem: async (data) => {
      try {
        const existing = await api.load('vogue_transacciones').catch(() => ({ value: null }));
        const list = Array.isArray(existing && existing.value ? existing.value : existing) ? (existing.value || []) : [];
        list.push(data);
        const saved = await api.save('vogue_transacciones', list).catch((e) => ({ ok: false, error: '' + e }));
        return saved;
      } catch (e) {
        return { ok: false, error: '' + e };
      }
    },
    items: async () => {
      const res = await apiFetch('/api/items');
      return res.json();
    },
    export: async () => {
      const r = await apiFetch('/api/export');
      return r.json();
    },
    import: async (payload) => {
      const r = await apiFetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return r.json();
    },
    clients: async () => {
      const res = await apiFetch('/api/clients');
      return res.json();
    },
    addClient: async (payload) => {
      const res = await apiFetch('/api/client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return res.json();
    },
    updateClient: async (id, payload) => {
      const res = await apiFetch('/api/client', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({}, payload, { id })),
      });
      return res.json();
    },
    deleteClient: async (id) => {
      const res = await apiFetch('/api/client?id=' + encodeURIComponent(id), { method: 'DELETE' });
      return res.json();
    },
  };

  window.appDB = Object.assign(window.appDB || {}, api);
})();

(function () {
  const originSave = Storage.prototype.setItem.bind(window.localStorage);
  const originRemove = Storage.prototype.removeItem.bind(window.localStorage);
  const lastSynced = Object.create(null);
  const dirtyKeys = new Set();
  let flushTimer = null;

  // OVERRIDE Storage.prototype.setItem IMMEDIATELY (before React loads)
  try {
    Storage.prototype.setItem = function (key, value) {
      originSave(key, value);
      console.log('[app-bridge] Storage.prototype.setItem called:', key, typeof value === 'string' ? value.substring(0, 100) : value);
      markDirty(key);
    };
    Storage.prototype.removeItem = function (key) {
      originRemove(key);
      markDirty(key);
    };
    console.log('[app-bridge] Storage.prototype.setItem/removeItem overridden at startup');
  } catch (e) {
    console.warn('Could not override localStorage methods at startup', e);
  }

  function loadAppScript() {
    const mainScriptTag = document.getElementById('app-script');
    if (mainScriptTag && mainScriptTag.dataset.src) {
      const script = document.createElement('script');
      script.type = 'module';
      script.crossOrigin = true;
      script.src = mainScriptTag.dataset.src;
      document.head.appendChild(script);
    }
  }

  const SERVER_SYNC_EXCLUDED_KEYS = ['vogue_sesion', 'vogue_user', 'vogue_token'];

  function shouldSyncKey(key) {
    return SERVER_SYNC_EXCLUDED_KEYS.indexOf(key) === -1;
  }

  function isEmptyValue(value) {
    if (value == null) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    if (typeof value === 'string') return value.trim() === '';
    return false;
  }

  function tryParseJSON(value) {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch (e) {
      return value;
    }
  }

  function clearLocalSession() {
    try {
      originRemove('vogue_sesion');
    } catch (e) {
      try {
        localStorage.removeItem('vogue_sesion');
      } catch (e2) {}
    }
    try {
      originRemove('vogue_user');
    } catch (e) {
      try {
        localStorage.removeItem('vogue_user');
      } catch (e2) {}
    }
    try {
      originRemove('vogue_token');
    } catch (e) {
      try {
        localStorage.removeItem('vogue_token');
      } catch (e2) {}
    }
  }

  async function backendUser() {
    try {
      if (window.appDB && typeof window.appDB.me === 'function') {
        const data = await window.appDB.me();
        return data && data.user ? data.user : null;
      }
    } catch (e) {}
    return null;
  }

  async function fetchServerKV() {
    try {
      if (window.appDB && typeof window.appDB.export === 'function') {
        const data = await window.appDB.export();
        if (!data || !data.kv || typeof data.kv !== 'object') return null;
        return data.kv || {};
      }
      const res = await fetch('/api/export', { credentials: 'same-origin' });
      if (!res.ok) return null;
      const data = await res.json();
      return data.kv || {};
    } catch (e) {
      console.warn('Could not fetch server KV', e);
      return null;
    }
  }

  async function serverSave(key, value) {
    try {
      if (isEmptyValue(value)) return;
      let payloadStr = null;
      try {
        payloadStr = JSON.stringify(value);
      } catch (e) {}
      if (payloadStr && lastSynced[key] === payloadStr) {
        console.log('[app-bridge] serverSave(' + key + ') skipped - no change since last sync');
        return;
      }
      if (payloadStr) lastSynced[key] = payloadStr;

      if (window.appDB && typeof window.appDB.save === 'function') {
        console.log('[app-bridge] serverSave(' + key + ') via appDB.save()');
        await window.appDB.save(key, value);
        console.log('[app-bridge] serverSave(' + key + ') success via appDB');
        return;
      }
      console.log('[app-bridge] serverSave(' + key + ') via /api/save');
      await fetch('/api/save', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      console.log('[app-bridge] serverSave(' + key + ') success via /api/save');
    } catch (e) {
      console.warn('[app-bridge] serverSave failed', e);
    }
  }

  async function serverDelete(key) {
    try {
      delete lastSynced[key];
      if (window.appDB && typeof window.appDB.deleteKey === 'function') {
        await window.appDB.deleteKey(key);
        return;
      }
      await fetch('/api/delete?key=' + encodeURIComponent(key), {
        method: 'DELETE',
        credentials: 'same-origin',
      });
    } catch (e) {
      console.warn('serverDelete failed', e);
    }
  }

  function markDirty(key) {
    if (!shouldSyncKey(key)) return;
    console.log('[app-bridge] markDirty(' + key + ')');
    dirtyKeys.add(key);
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushDirty().catch(function () {});
    }, 800);
  }

  async function flushDirty() {
    if (!dirtyKeys.size) return { ok: true, flushed: 0 };
    const keys = Array.from(dirtyKeys);
    dirtyKeys.clear();
    console.log('[app-bridge] flushDirty() called with keys:', keys);
    for (const k of keys) {
      const raw = localStorage.getItem(k);
      if (raw === null) {
        await serverDelete(k);
        continue;
      }
      const parsed = tryParseJSON(raw);
      if (isEmptyValue(parsed)) continue;
      console.log('[app-bridge] serverSave(' + k + ') with', Array.isArray(parsed) ? parsed.length + ' items' : 'value');
      await serverSave(k, parsed);
    }
    return { ok: true, flushed: keys.length };
  }

  async function safePushAll() {
    if (window.appDB && typeof window.appDB.pushAllLocalToServer === 'function') {
      try {
        return await window.appDB.pushAllLocalToServer();
      } catch (e) {
        console.warn('pushAllLocalToServer failed', e);
      }
    }
    return { ok: false };
  }

  // On load: populate localStorage from server kv (server wins)
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const user = await backendUser();
      if (!user) {
        if (localStorage.getItem('vogue_sesion') === 'true') {
          clearLocalSession();
        }
        return;
      }

      const kv = await fetchServerKV();
      if (kv) {
        try {
          Object.keys(kv).forEach((k) => {
            if (!shouldSyncKey(k)) return;
            const serverVal = kv[k];
            try {
              lastSynced[k] = JSON.stringify(serverVal);
            } catch (e) {}

            const localRaw = localStorage.getItem(k);
            const localVal = localRaw === null ? null : tryParseJSON(localRaw);
            const localEmpty = localRaw === null || isEmptyValue(localVal);
            const serverEmpty = isEmptyValue(serverVal);

            if (localEmpty && !serverEmpty) {
              try {
                originSave(k, JSON.stringify(serverVal));
              } catch (e) {
                try {
                  originSave(k, String(serverVal));
                } catch (e2) {}
              }
            }
          });
          console.log('localStorage populated from server (kv keys):', Object.keys(kv));
        } catch (e) {
          console.warn('Error populating localStorage', e);
        }
      }

      await safePushAll();
    } catch (e) {
      console.error('Failed to fetch and populate initial data', e);
    } finally {
      loadAppScript();
    }
  });

  setInterval(() => {
    flushDirty().catch(function () {});
  }, 5000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushDirty().catch(function () {});
  });
  window.addEventListener('pagehide', () => {
    flushDirty().catch(function () {});
  });

  window.appDB = window.appDB || {};
  window.appDB.pushAllLocalToServer = async function () {
    try {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!shouldSyncKey(k)) continue;
        const v = localStorage.getItem(k);
        const parsed = tryParseJSON(v);
        if (isEmptyValue(parsed)) continue;
        await serverSave(k, parsed);
      }
      return { ok: true };
    } catch (e) {
      console.error(e);
      return { ok: false, error: '' + e };
    }
  };
})();

(function () {
  function isLoginForm(form) {
    if (!(form instanceof HTMLFormElement)) return !1;
    const userField = form.querySelector('input[type="text"],input[type="email"]');
    const passField = form.querySelector(
      'input[type="password"],input[autocomplete="current-password"],input[name*="pass" i],input[placeholder="••••••"]'
    );
    return !!(userField && passField);
  }

  async function waitForLocalFlag(flagKey, expectedValue, timeoutMs = 1500) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        if (localStorage.getItem(flagKey) === expectedValue) return true;
      } catch (e) {}
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  }

  document.addEventListener(
    'submit',
    function (ev) {
      const form = ev.target;
      if (!isLoginForm(form)) return;
      if (!window.appDB || typeof window.appDB.login !== 'function') return;
      const userInput = form.querySelector('input[type="text"],input[type="email"]');
      const passInput = form.querySelector(
        'input[type="password"],input[autocomplete="current-password"],input[name*="pass" i],input[placeholder="••••••"]'
      );
      if (!userInput || !passInput) return;
      const username = userInput.value || '';
      const password = passInput.value || '';
      if (!username || !password) return;
      Promise.resolve()
        .then(() => window.appDB.login(username, password))
        .then(async (res) => {
          if (res && res.ok) {
            if (window.appDB && typeof window.appDB.pushAllLocalToServer === 'function') {
              try {
                await window.appDB.pushAllLocalToServer();
              } catch (e) {}
            }
            // Esperar a que React persista `vogue_sesion=true` en localStorage antes de recargar.
            await waitForLocalFlag('vogue_sesion', 'true', 1500);
            setTimeout(() => window.location.reload(), 50);
          }
        })
        .catch(function () {});
    },
    true
  );

  document.addEventListener(
    'click',
    function (ev) {
      const btn = ev.target.closest('button');
      if (!btn) return;
      const text = (btn.textContent || '').toLowerCase();
      if (text.includes('cerrar sesión') || text.includes('cerrar sesion') || text.includes('logout')) {
        if (window.appDB && typeof window.appDB.logout === 'function') {
          window.appDB.logout().catch(function () {});
        }
      }
    },
    true
  );
})();
