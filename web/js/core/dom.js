/* DOM plumbing: escaping, one delegated event listener, the keyboard hook,
   toasts, tooltips and modals. Views build HTML strings and register actions;
   nothing binds listeners to individual elements. */

import { t } from './i18n.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const $content = () => document.getElementById('content');

export function esc(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function attr(value) {
  return esc(value);
}

export function clip(text, max = 90) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

export function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function loading() {
  $content().innerHTML = '<div class="spinner"></div>';
}

/* ── Action delegation ──────────────────────────────────────────────────── */

const actions = {};

export function registerActions(map) {
  Object.assign(actions, map);
}

function run(name, el, event) {
  const fn = actions[name];
  if (!fn) return;
  const result = fn(el, event);
  if (result && typeof result.catch === 'function') {
    result.catch((err) => {
      console.error(`action ${name} failed`, err);
      showToast(t('error'));
    });
  }
}

export function bindDelegation(root = document) {
  root.addEventListener('click', (event) => {
    const el = event.target.closest('[data-action]');
    if (!el || el.disabled) return;
    if (el.dataset.action === 'dismissModal' && event.target !== el) return;
    run(el.dataset.action, el, event);
  });
  root.addEventListener('change', (event) => {
    const el = event.target.closest('[data-change]');
    if (el) run(el.dataset.change, el, event);
  });
  root.addEventListener('input', (event) => {
    const el = event.target.closest('[data-input]');
    if (el) run(el.dataset.input, el, event);
  });
  root.addEventListener('submit', (event) => {
    const el = event.target.closest('[data-submit]');
    if (!el) return;
    event.preventDefault();
    run(el.dataset.submit, el, event);
  });
  root.addEventListener('mouseover', (event) => {
    const el = event.target.closest('[data-tip]');
    if (el) showTip(el, el.dataset.tip);
  });
  root.addEventListener('mouseout', (event) => {
    if (event.target.closest('[data-tip]')) hideTip();
  });
}

/* ── Keyboard ───────────────────────────────────────────────────────────── */

let keyHandler = null;

export function setKeys(handler) {
  keyHandler = handler;
}

export function clearKeys() {
  keyHandler = null;
}

export function typingInInput(event) {
  const el = event.target;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

export function bindKeyboard() {
  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === '?' && !typingInInput(event) && !modalIsOpen()) {
      event.preventDefault();
      return showShortcuts();
    }
    if (!keyHandler) return;
    keyHandler(event);
  });
}

/* Every shortcut in one place, on the one key everyone tries. */
function showShortcuts() {
  const row = (keys, label) => `
    <div class="shortcut-row">
      <span class="keys">${keys.map((k) => `<span class="kbd">${esc(k)}</span>`).join('')}</span>
      <span>${esc(label)}</span>
    </div>`;
  const section = (label, rows) => `
    <div class="shortcut-section">
      <div class="section-label" style="margin-bottom:6px">${esc(label)}</div>
      ${rows.join('')}
    </div>`;
  showModal(`
    <h2>${esc(t('shortcuts'))}</h2>
    <div class="shortcut-grid">
      ${section(t('sc_review'), [
        row(['Space'], t('show_answer')),
        row(['1', '2', '3', '4'], t('sc_rate')),
        row(['E'], t('edit_card')),
        row(['Z'], t('undo')),
        row(['H'], t('hint')),
      ])}
      ${section(t('sc_browsing'), [
        row(['Space'], t('sc_flip')),
        row(['\u2190', '\u2192'], `${t('prev')} / ${t('next')}`),
      ])}
      ${section(t('sc_quiz'), [
        row(['1', '\u2026', '9'], t('sc_pick')),
        row(['Enter'], t('sc_check_advance')),
      ])}
      ${section(t('sc_anywhere'), [
        row(['Esc'], t('sc_leave')),
        row(['?'], t('sc_help')),
      ])}
    </div>`);
}

/* ── Toast ──────────────────────────────────────────────────────────────── */

let toastTimer = null;

export function showToast(message, ms = 2000) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ── Tooltip ────────────────────────────────────────────────────────────── */

export function showTip(target, text) {
  const tip = document.getElementById('tooltip');
  tip.textContent = text;
  tip.classList.add('show');
  const box = target.getBoundingClientRect();
  const own = tip.getBoundingClientRect();
  const left = Math.min(
    Math.max(6, box.left + box.width / 2 - own.width / 2),
    window.innerWidth - own.width - 6,
  );
  const above = box.top - own.height - 8;
  tip.style.left = `${left}px`;
  tip.style.top = `${above > 6 ? above : box.bottom + 8}px`;
}

export function hideTip() {
  document.getElementById('tooltip').classList.remove('show');
}

/* ── Modal ──────────────────────────────────────────────────────────────── */

let modalCleanup = null;
let modalReturnFocus = null;

export function showModal(innerHtml, { wide = false, onMount } = {}) {
  const overlay = document.getElementById('overlay');
  modalReturnFocus = document.activeElement;
  overlay.innerHTML = `<div class="modal${wide ? ' wide' : ''}">${innerHtml}</div>`;
  overlay.hidden = false;
  const escClose = (event) => { if (event.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', escClose);
  modalCleanup = () => document.removeEventListener('keydown', escClose);
  if (onMount) onMount(overlay.firstElementChild);
  // Keyboard users land inside the dialog, not on whatever was behind it.
  if (!overlay.contains(document.activeElement)) {
    const target = overlay.querySelector('input, textarea, select, button');
    if (target) target.focus();
  }
}

export function closeModal() {
  const overlay = document.getElementById('overlay');
  const wasOpen = !overlay.hidden;
  overlay.hidden = true;
  overlay.innerHTML = '';
  if (modalCleanup) { modalCleanup(); modalCleanup = null; }
  // ...and are put back where they were when the dialog closes.
  if (wasOpen && modalReturnFocus && document.contains(modalReturnFocus)) {
    modalReturnFocus.focus();
  }
  modalReturnFocus = null;
}

export function modalIsOpen() {
  return !document.getElementById('overlay').hidden;
}

export function confirmDialog({ title, body = '', confirmLabel, danger = false }) {
  return new Promise((resolve) => {
    const label = confirmLabel || t('confirm');
    showModal(`
      <h2>${esc(title)}</h2>
      ${body ? `<p class="sub" style="font-size:13.5px;line-height:1.6">${esc(body)}</p>` : ''}
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" data-confirm="0">${esc(t('cancel'))}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-sm" data-confirm="1">${esc(label)}</button>
      </div>`, {
      onMount(modal) {
        modal.addEventListener('click', (event) => {
          const btn = event.target.closest('[data-confirm]');
          if (!btn) return;
          closeModal();
          resolve(btn.dataset.confirm === '1');
        });
        const primary = modal.querySelector('[data-confirm="1"]');
        if (primary) primary.focus();
      },
    });
  });
}

export function promptDialog({ title, label = '', value = '', placeholder = '' }) {
  return new Promise((resolve) => {
    showModal(`
      <h2>${esc(title)}</h2>
      <div class="field">
        ${label ? `<label class="field-label">${esc(label)}</label>` : ''}
        <input class="input" id="prompt-input" value="${attr(value)}" placeholder="${attr(placeholder)}">
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" data-prompt="cancel">${esc(t('cancel'))}</button>
        <button class="btn btn-primary btn-sm" data-prompt="ok">${esc(t('save'))}</button>
      </div>`, {
      onMount(modal) {
        const input = modal.querySelector('#prompt-input');
        input.focus();
        input.select();
        const submit = () => { const v = input.value.trim(); closeModal(); resolve(v || null); };
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') submit();
        });
        modal.addEventListener('click', (event) => {
          const btn = event.target.closest('[data-prompt]');
          if (!btn) return;
          if (btn.dataset.prompt === 'ok') return submit();
          closeModal();
          resolve(null);
        });
      },
    });
  });
}

registerActions({
  dismissModal: () => closeModal(),
  closeModal: () => closeModal(),
});
