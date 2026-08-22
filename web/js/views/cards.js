/* The card library: search, edit, move, suspend, delete. */

import { S } from '../core/state.js';
import { api } from '../core/api.js';
import { $content, esc, attr, showToast, showModal, closeModal, confirmDialog } from '../core/dom.js';
import { plain } from '../core/render.js';
import { t } from '../core/i18n.js';
import { render } from '../core/router.js';

const PAGE_SIZE = 50;

function view() {
  if (!S.cardsView) S.cardsView = { search: '', offset: 0, selected: new Set() };
  return S.cardsView;
}

export async function renderCards() {
  const state = view();

  const result = await api.list_cards(S.deck, state.search, state.offset, PAGE_SIZE);
  if (result.error) {
    $content().innerHTML = `<div class="page"><div class="empty">${esc(result.error)}</div></div>`;
    return;
  }

  const selectedCount = state.selected.size;
  const rows = result.cards.map((card) => `
    <tr class="${state.selected.has(card.card_id) ? 'selected' : ''}">
      <td style="width:26px">
        <input type="checkbox" data-change="toggleCardSelect" data-id="${card.card_id}"
               ${state.selected.has(card.card_id) ? 'checked' : ''}>
      </td>
      <td class="cell-front"><div class="cell-clip">${esc(plain(card.front))}</div></td>
      <td class="cell-back"><div class="cell-clip">${esc(plain(card.back))}</div></td>
      <td class="sub small nowrap">${esc(card.deck.split('::').pop())}</td>
      <td class="nowrap">${stateBadge(card)}</td>
      <td style="width:52px" class="nowrap">
        <button class="btn-text" data-action="editCardRow" data-id="${card.card_id}">${esc(t('edit'))}</button>
      </td>
    </tr>`).join('');

  const from = result.total ? state.offset + 1 : 0;
  const to = Math.min(state.offset + PAGE_SIZE, result.total);

  $content().innerHTML = `
    <div class="page">
      <div class="page-head">
        <h1>${esc(S.deck ? S.deck.split('::').pop() : t('all_decks'))}</h1>
        <span class="sub small">${result.total} ${esc(t(result.total === 1 ? 'card' : 'cards'))}</span>
      </div>

      <div class="table-toolbar">
        <input class="input" style="max-width:260px" id="card-search" data-input="searchCards"
               placeholder="${attr(t('search'))}" value="${attr(state.search)}">
        <span class="grow"></span>
        ${selectedCount ? `
          <span class="sub small">${esc(t('selected_n', { n: selectedCount }))}</span>
          <button class="btn btn-secondary btn-sm" data-action="moveSelected">${esc(t('move_to'))}</button>
          <button class="btn btn-secondary btn-sm" data-action="suspendSelected">${esc(t('suspend'))}</button>
          <button class="btn btn-danger btn-sm" data-action="deleteSelected">${esc(t('delete'))}</button>
        ` : `
          <button class="btn btn-secondary btn-sm" data-action="exportDeck">${esc(t('export_cards'))}</button>
          <button class="btn btn-primary btn-sm" data-action="newCard">${esc(t('new_card'))}</button>
        `}
      </div>

      ${result.cards.length ? `
        <div class="card" style="padding:14px 8px 8px">
          <table class="card-table">
            <thead><tr>
              <th></th><th>${esc(t('front'))}</th><th>${esc(t('back'))}</th>
              <th>${esc(t('deck'))}</th><th></th><th></th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ${result.total > PAGE_SIZE ? `
          <div class="pager">
            <button class="btn btn-secondary btn-sm" data-action="pageCards" data-dir="-1"
                    ${state.offset === 0 ? 'disabled' : ''}>${esc(t('prev'))}</button>
            <span class="num">${esc(t('showing_range', { from, to, total: result.total }))}</span>
            <button class="btn btn-secondary btn-sm" data-action="pageCards" data-dir="1"
                    ${to >= result.total ? 'disabled' : ''}>${esc(t('next'))}</button>
          </div>` : ''}
      ` : `<div class="card"><div class="empty">${esc(t('no_cards_found'))}</div></div>`}
    </div>`;

  const search = document.getElementById('card-search');
  if (search && state.focusSearch) {
    search.focus();
    search.setSelectionRange(search.value.length, search.value.length);
  }
}

function stateBadge(card) {
  if (card.suspended) return `<span class="badge">${esc(t('suspend'))}</span>`;
  if (!card.last_review) return `<span class="badge badge-blue">${esc(t('state_new'))}</span>`;
  if (card.fsrs_state === 2) return `<span class="badge badge-green">${esc(t('state_review'))}</span>`;
  return `<span class="badge badge-orange">${esc(t('state_learning'))}</span>`;
}

/* ── Editor ─────────────────────────────────────────────────────────────── */

function deckOptions(selected) {
  const paths = S.decks.map((d) => d.path);
  if (selected && !paths.includes(selected)) paths.unshift(selected);
  return paths.map((path) =>
    `<option value="${attr(path)}" ${path === selected ? 'selected' : ''}>${esc(path)}</option>`).join('');
}

function openEditor(card) {
  const isNew = !card;
  const data = card || { front: '', back: '', hint: '', tags: [], deck: S.deck || (S.decks[0] || {}).path || '' };
  showModal(`
    <h2>${esc(isNew ? t('new_card') : t('edit_card'))}</h2>
    <div class="field">
      <label class="field-label">${esc(t('deck'))}</label>
      <select class="select" id="card-deck">${deckOptions(data.deck)}</select>
    </div>
    <div class="field">
      <label class="field-label">${esc(t('front'))}</label>
      <textarea class="textarea" id="card-front" style="min-height:70px">${esc(data.front)}</textarea>
    </div>
    <div class="field">
      <label class="field-label">${esc(t('back'))}</label>
      <textarea class="textarea" id="card-back">${esc(data.back)}</textarea>
    </div>
    <div class="field">
      <label class="field-label">${esc(t('hint_field'))}</label>
      <input class="input" id="card-hint" value="${attr(data.hint || '')}">
    </div>
    <div class="field">
      <label class="field-label">${esc(t('tags'))}</label>
      <input class="input" id="card-tags" value="${attr((data.tags || []).join(', '))}">
    </div>
    <div class="modal-actions">
      ${isNew ? '' : `<button class="btn btn-danger btn-sm" data-action="deleteOneCard"
        data-id="${data.card_id}">${esc(t('delete'))}</button>`}
      <span class="grow"></span>
      <button class="btn btn-secondary btn-sm" data-action="closeModal">${esc(t('cancel'))}</button>
      <button class="btn btn-primary btn-sm" data-action="saveCard"
              data-id="${isNew ? '' : data.card_id}">${esc(t('save'))}</button>
    </div>`, {
    wide: true,
    onMount(modal) { modal.querySelector('#card-front').focus(); },
  });
}

function readEditor() {
  return {
    deck: document.getElementById('card-deck').value,
    front: document.getElementById('card-front').value,
    back: document.getElementById('card-back').value,
    hint: document.getElementById('card-hint').value,
    tags: document.getElementById('card-tags').value.split(',').map((s) => s.trim()).filter(Boolean),
  };
}

/* ── Actions ────────────────────────────────────────────────────────────── */

let searchTimer = null;

export const actions = {
  searchCards: (el) => {
    const state = view();
    state.search = el.value;
    state.offset = 0;
    state.focusSearch = true;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => render({ silent: true }), 220);
  },

  pageCards: (el) => {
    const state = view();
    state.offset = Math.max(0, state.offset + Number(el.dataset.dir) * PAGE_SIZE);
    state.focusSearch = false;
    return render({ silent: true });
  },

  toggleCardSelect: (el) => {
    const state = view();
    const id = Number(el.dataset.id);
    if (el.checked) state.selected.add(id); else state.selected.delete(id);
    return render({ silent: true });
  },

  newCard: () => openEditor(null),

  editCardRow: async (el) => {
    const card = await api.get_card(Number(el.dataset.id));
    if (card.error) return showToast(card.error, 3200);
    openEditor({
      card_id: card.card_id,
      front: card.front,
      back: card.back,
      hint: card.hint,
      tags: (card.tags || '').split(',').filter(Boolean),
      deck: card.deck,
    });
  },

  saveCard: async (el) => {
    const payload = readEditor();
    if (!payload.front.trim() || !payload.back.trim()) {
      return showToast(t('front_back_required'), 3000);
    }
    const id = el.dataset.id;
    const result = id
      ? await api.update_card(Number(id), payload)
      : await api.create_card(payload);
    if (result.error) return showToast(result.error, 3200);
    closeModal();
    showToast(t('card_saved'), 1400);
    view().focusSearch = false;
    await render({ silent: true });
  },

  deleteOneCard: async (el) => {
    const ok = await confirmDialog({
      title: t('delete_confirm', { n: 1 }), confirmLabel: t('delete'), danger: true,
    });
    if (!ok) return;
    await api.delete_cards([Number(el.dataset.id)]);
    closeModal();
    showToast(t('card_deleted'), 1400);
    await render({ silent: true });
  },

  deleteSelected: async () => {
    const state = view();
    const ids = [...state.selected];
    const ok = await confirmDialog({
      title: t('delete_confirm', { n: ids.length }), confirmLabel: t('delete'), danger: true,
    });
    if (!ok) return;
    await api.delete_cards(ids);
    state.selected.clear();
    showToast(t('card_deleted'), 1400);
    await render({ silent: true });
  },

  suspendSelected: async () => {
    const state = view();
    await api.suspend_cards([...state.selected], true);
    state.selected.clear();
    await render({ silent: true });
  },

  moveSelected: () => {
    showModal(`
      <h2>${esc(t('move_to'))}</h2>
      <div class="field">
        <select class="select" id="move-deck">${deckOptions(S.deck)}</select>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" data-action="closeModal">${esc(t('cancel'))}</button>
        <button class="btn btn-primary btn-sm" data-action="confirmMove">${esc(t('save'))}</button>
      </div>`);
  },

  confirmMove: async () => {
    const state = view();
    const deck = document.getElementById('move-deck').value;
    closeModal();
    const result = await api.move_cards([...state.selected], deck);
    if (result.error) return showToast(result.error, 3200);
    state.selected.clear();
    await render({ silent: true });
  },

  exportDeck: async () => {
    const payload = await api.export_cards(S.deck);
    if (payload.error) return showToast(payload.error, 3200);
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      showToast(t('export_copied'));
    } catch (err) {
      showModal(`<h2>${esc(t('export_title'))}</h2>
        <textarea class="textarea code" style="min-height:340px">${esc(text)}</textarea>
        <div class="modal-actions">
          <button class="btn btn-secondary btn-sm" data-action="closeModal">${esc(t('close'))}</button>
        </div>`, { wide: true });
    }
  },
};
