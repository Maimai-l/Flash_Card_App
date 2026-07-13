/* ════════════════════════════════════════════════════════════════════════
   API wrapper
   ════════════════════════════════════════════════════════════════════════ */

// Primary transport is pywebview's injected bridge. When pywebview is absent
// (browser-based dev / Playwright e2e), fall back to the HTTP JSON bridge
// served by gui/dev_bridge.py at POST /api.
export const api = new Proxy({}, {
  get(_, method) {
    return (...args) => {
      if (window.pywebview && window.pywebview.api) {
        return window.pywebview.api[method](...args);
      }
      return fetch('/api', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ method, args }),
      }).then(r => r.json());
    };
  }
});
