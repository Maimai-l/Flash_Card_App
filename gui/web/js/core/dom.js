/* ════════════════════════════════════════════════════════════════════════
   DOM helpers, sound effects, and the event-delegation core
   ════════════════════════════════════════════════════════════════════════ */

// Strip leading "[N]" citation markers from example sentences (e.g. "[1]He left" → "He left")
export function stripCite(s) {
  return (s || '').replace(/^\[\d+\]\s*/, '');
}

// ── Sound effects ─────────────────────────────────────────────────────────
// Central stub for all UI sound events. Replace the body of each case with
// an Audio() play call (e.g. new Audio('sfx/flip.mp3').play()) when assets
// are ready. All interaction sounds route through here so nothing is missed.
export const SFX = {
  _sounds: {},  // cache: { name: HTMLAudioElement }
  _load(name) {
    if (!this._sounds[name]) {
      // Uncomment and set correct path once audio files are bundled:
      // this._sounds[name] = new Audio(`sfx/${name}.mp3`);
    }
    return this._sounds[name];
  },
  play(name) {
    const audio = this._load(name);
    if (!audio) return;  // no-op until files are added
    audio.currentTime = 0;
    audio.play().catch(() => {});
  },
};

export function sfx(event) {
  switch (event) {
    case 'flip':        SFX.play('flip');        break;  // flashcard flip
    case 'nav':         SFX.play('nav');         break;  // prev/next navigation
    case 'correct':     SFX.play('correct');     break;  // correct answer / Easy/Good
    case 'wrong':       SFX.play('wrong');       break;  // wrong answer / Again
    case 'hard':        SFX.play('hard');        break;  // Hard rating
    case 'tap':         SFX.play('tap');         break;  // generic button tap
    case 'success':     SFX.play('success');     break;  // session complete / import ok
  }
}

// ── DOM utilities ─────────────────────────────────────────────────────────
export function setTopBar(title, showBack, extraActions = '') {
  document.getElementById('topbar-title').textContent = title;
  document.getElementById('back-btn').style.display = showBack ? 'inline-flex' : 'none';
  document.getElementById('topbar-actions').innerHTML = extraActions;
}

export function $content() { return document.getElementById('content'); }

export function loading() {
  $content().innerHTML = '<div class="spinner"></div>';
}

export function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Event delegation ──────────────────────────────────────────────────────
const _actions = {};
export function registerActions(map) { Object.assign(_actions, map); }
export function bindDelegation(root) {
  root.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el || !root.contains(el)) return;
    const fn = _actions[el.dataset.action];
    if (fn) fn(el, e);
  });
  root.addEventListener('input', e => {
    const el = e.target.closest('[data-input]'); if (el && _actions[el.dataset.input]) _actions[el.dataset.input](el, e);
  });
  root.addEventListener('change', e => {
    const el = e.target.closest('[data-change]'); if (el && _actions[el.dataset.change]) _actions[el.dataset.change](el, e);
  });
}
