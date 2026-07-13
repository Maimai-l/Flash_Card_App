/* ════════════════════════════════════════════════════════════════════════
   Toast + confirm modal / overlay
   ════════════════════════════════════════════════════════════════════════ */

let _toastTimer;
export function showToast(msg, duration = 2200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), duration);
}

export function showConfirm(title, body, confirmLabel, onConfirm, dangerous = true) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').textContent = body;
  const btn = document.getElementById('modal-confirm');
  btn.textContent = confirmLabel;
  btn.style.background = dangerous ? 'var(--danger)' : 'var(--text-main)';
  btn.onclick = () => { closeOverlay(); onConfirm(); };
  document.getElementById('overlay').style.display = 'flex';
}

export function closeOverlay(e) {
  if (e && e.target !== document.getElementById('overlay')) return;
  document.getElementById('overlay').style.display = 'none';
}

// ── Delegation adapters ───────────────────────────────────────────────────
export const actions = {
  // The overlay backdrop and the Cancel button share this action. When the
  // matched element is the overlay itself, only close on a direct backdrop
  // click (closeOverlay(e) guards on e.target). An explicit close button
  // (e.g. #modal-cancel) always closes.
  closeOverlay: (el, e) => { if (el.id === 'overlay') closeOverlay(e); else closeOverlay(); },
};
