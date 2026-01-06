// SYNC HANDLER: Intercept localStorage writes and sync to server immediately
(function() {
  const originalSetItem = localStorage.setItem.bind(localStorage);
  let syncInProgress = false;
  
  localStorage.setItem = function(key, value) {
    originalSetItem(key, value);
    
    if (key === 'vogue_transacciones') {
      console.log('[sync] localStorage.setItem: vogue_transacciones, length:', (value || '').substring(0, 100));
      
      // Try to sync immediately
      syncToServer(key, value);
    }
  };
  
  function syncToServer(key, value) {
    if (syncInProgress) return;
    syncInProgress = true;
    
    // Wait a bit for appDB to be ready
    function attemptSync(retry = 0) {
      if (retry > 50) {
        console.warn('[sync] appDB not available after retries');
        syncInProgress = false;
        return;
      }
      
      if (window.appDB && typeof window.appDB.save === 'function') {
        try {
          const parsed = JSON.parse(value);
          console.log('[sync] Syncing', key, 'with', parsed.length, 'items');
          window.appDB.save(key, parsed)
            .then(r => {
              console.log('[sync] Success:', r);
              syncInProgress = false;
            })
            .catch(e => {
              console.warn('[sync] Error:', e);
              syncInProgress = false;
            });
        } catch (e) {
          console.warn('[sync] Parse error:', e);
          syncInProgress = false;
        }
      } else {
        setTimeout(() => attemptSync(retry + 1), 50);
      }
    }
    
    attemptSync();
  }
  
  console.log('[sync] Sync interceptor installed');
})();
