/* Transport to the local Python server. Every property access becomes a
   POST /api call, so `api.get_overview(deck)` mirrors `Api.get_overview`. */

async function call(method, args) {
  let response;
  try {
    response = await fetch('/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, args }),
    });
  } catch (err) {
    return { error: 'Cannot reach the local server. Is it still running?' };
  }
  if (!response.ok) return { error: `Server error ${response.status}` };
  try {
    return await response.json();
  } catch (err) {
    return { error: 'Server sent a malformed response' };
  }
}

export const api = new Proxy({}, {
  get: (_, method) => (...args) => call(method, args),
});
