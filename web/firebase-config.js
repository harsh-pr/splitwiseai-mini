// Firebase Web Configuration Loader
// Loads configuration dynamically from Vercel Environment Variables (/api/config)

window.FIREBASE_CONFIG = window.FIREBASE_CONFIG || null;

(async function loadFirebaseConfig() {
  if (!window.FIREBASE_CONFIG || !window.FIREBASE_CONFIG.apiKey) {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const cfg = await res.json();
        if (cfg && cfg.apiKey) {
          window.FIREBASE_CONFIG = cfg;
          if (typeof ApiService !== 'undefined' && ApiService.initFirebase) {
            ApiService.initFirebase();
          }
        }
      }
    } catch (_) {}
  }
})();
