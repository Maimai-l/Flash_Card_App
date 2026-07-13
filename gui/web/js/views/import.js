/* ════════════════════════════════════════════════════════════════════════
   IMPORT PAGE (+ Manage tab)
   ════════════════════════════════════════════════════════════════════════ */
import { api } from '../core/api.js';
import { setTopBar, $content, escHtml, sfx } from '../core/dom.js';
import { showToast, showConfirm } from '../core/ui.js';

// Stores lookup results for the words-only tab
let _lookupResults = [];

export async function renderImport() {
  setTopBar('Import', true);
  const books = await api.get_book_names();
  const bookOpts = books.map(b => `<option value="${escHtml(b)}">${escHtml(b)}</option>`).join('');

  $content().innerHTML = `
    <div class="import-page">
      <div class="section-label" style="padding-left:0;padding-top:16px">Format</div>
      <div class="tab-bar">
        <button class="tab active" id="tab-words"  data-action="switchTab" data-tab="words">Words Only</button>
        <button class="tab"        id="tab-clip"   data-action="switchTab" data-tab="clip">Clipboard</button>
        <button class="tab"        id="tab-txt"    data-action="switchTab" data-tab="txt">TXT</button>
        <button class="tab"        id="tab-excel"  data-action="switchTab" data-tab="excel">Excel</button>
        <button class="tab"        id="tab-json"   data-action="switchTab" data-tab="json">JSON</button>
        <button class="tab"        id="tab-manage" data-action="switchTab" data-tab="manage">Manage</button>
      </div>

      <!-- Target book -->
      <div class="section-label" style="padding-left:0">Target Book</div>
      <div class="list-group" style="margin-bottom:16px">
        <div class="list-row" style="border:none;padding:0">
          <select class="styled-select" id="import-book">
            ${bookOpts}
            <option value="__new__">＋ Create new book…</option>
          </select>
        </div>
      </div>
      <div id="new-book-row" style="display:none;margin-bottom:16px">
        <div class="form-row">
          <label class="form-label">New book name</label>
          <input class="form-input" id="new-book-name" type="text" placeholder="e.g. IELTS Vocabulary">
        </div>
      </div>

      <div id="tab-content">${tabWords()}</div>
      <div id="import-result"></div>
    </div>`;

  document.getElementById('import-book').addEventListener('change', e => {
    document.getElementById('new-book-row').style.display =
      e.target.value === '__new__' ? 'block' : 'none';
  });
}

export function switchTab(tab) {
  ['words','clip','txt','excel','json','manage'].forEach(t => {
    const el = document.getElementById(`tab-${t}`);
    if (el) el.classList.toggle('active', t === tab);
  });
  if (tab === 'manage') {
    // Manage tab renders asynchronously — show book selector + empty list first, then load
    document.getElementById('tab-content').innerHTML = tabManageSkeleton();
    document.getElementById('import-result').innerHTML = '';
    _lookupResults = [];
    // Auto-load words for currently selected book
    loadManageWords();
    return;
  }
  const content = { words: tabWords, clip: tabClipboard, txt: tabTxt, excel: tabExcel, json: tabJson }[tab];
  document.getElementById('tab-content').innerHTML = content();
  document.getElementById('import-result').innerHTML = '';
  _lookupResults = [];
}

// ── Words Only tab ─────────────────────────────────────────────────────────
function tabWords() {
  return `
    <div>
      <div class="form-row">
        <label class="form-label">Paste words</label>
        <textarea class="form-textarea" id="words-text" style="min-height:140px"
          placeholder="apple&#10;banana&#10;ephemeral&#10;ubiquitous&#10;..."></textarea>
      </div>
      <div class="form-row" style="margin-bottom:12px">
        <label class="form-label">Word separator <span style="color:var(--text-sub);font-weight:400">(default: newline)</span></label>
        <input class="form-input" id="words-sep" type="text" value="&#10;"
               style="width:120px;font-family:monospace" placeholder="\\n">
      </div>
      <div style="margin-bottom:12px">
        <button class="btn-secondary" data-action="doLookup" id="lookup-btn">Look Up in Database</button>
      </div>
      <div id="lookup-preview"></div>
      <div id="lookup-actions" style="display:none;margin-top:16px;display:none">
        <button class="btn-primary" data-action="importLookupResults">Import Selected</button>
        <span id="lookup-count" style="font-size:13px;color:var(--text-sub);margin-left:12px"></span>
      </div>
    </div>`;
}

async function doLookup() {
  const text = document.getElementById('words-text')?.value || '';
  if (!text.trim()) { showToast('Paste some words first'); return; }

  const btn = document.getElementById('lookup-btn');
  btn.disabled = true; btn.textContent = 'Looking up…';

  // Use custom separator (support \n, \t escape sequences)
  const sepRaw = document.getElementById('words-sep')?.value ?? '\n';
  const sep = sepRaw === '\\n' ? '\n' : sepRaw === '\\t' ? '\t' : sepRaw || '\n';
  // Replace separator with newlines so the API can split on newlines
  const normalised = sep === '\n' ? text : text.split(sep).join('\n');

  const results = await api.lookup_words(normalised);
  // Stash original DB values so importLookupResults can detect user edits
  results.forEach(r => {
    if (r.found) { r._origDef = r.definition; r._origEx = r.example; r._origCn = r.chinese; }
  });
  _lookupResults = results;

  btn.disabled = false; btn.textContent = 'Look Up in Database';

  if (!results || !results.length) {
    document.getElementById('lookup-preview').innerHTML =
      '<div style="color:var(--text-sub);font-size:14px">No words found.</div>';
    return;
  }

  const foundCount = results.filter(r => r.found).length;
  const rows = results.map((r, i) => {
    const methodBadge = r.method === 'fuzzy'
      ? `<span class="badge badge-warning" style="margin-left:6px">fuzzy</span>` : '';
    const matchedLabel = r.found
      ? `<span style="font-weight:600">${escHtml(r.matched)}</span>${methodBadge}`
      : `<span style="color:var(--text-sub)">— not found</span>`;
    const missingEx = r.found && !r.example;
    const exWarning = missingEx
      ? `<span style="color:var(--warning);font-size:11px;margin-left:6px" title="No example sentence — FIG practice may fall back to definition prompt">⚠ no example</span>`
      : '';
    const def = r.definition ? escHtml(r.definition.slice(0, 60)) + (r.definition.length > 60 ? '…' : '') : '';
    return `
      <div class="lookup-row" id="lrow-${i}" style="${!r.found ? 'opacity:.45' : ''}">
        <div style="display:flex;align-items:center;padding:8px 12px;gap:10px">
          <input type="checkbox" id="chk-${i}" ${r.found ? 'checked' : 'disabled'}
            data-change="updateLookupCount" style="flex-shrink:0;width:16px;height:16px;cursor:pointer">
          <div style="width:110px;flex-shrink:0;font-size:13px;color:var(--text-sub)">${escHtml(r.input)}</div>
          <div style="width:130px;flex-shrink:0;font-size:14px">${matchedLabel}${exWarning}</div>
          <div style="flex:1;font-size:13px;color:var(--text-sub);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${def}</div>
          ${r.found ? `<button class="btn-ghost" style="font-size:12px;padding:2px 8px;flex-shrink:0" data-action="toggleLookupEdit" data-idx="${i}">Edit</button>` : ''}
        </div>
        <div id="ledit-${i}" style="display:none;padding:0 12px 10px 38px;display:none">
          <div style="display:flex;flex-direction:column;gap:6px">
            <textarea class="form-textarea" id="ledit-def-${i}" style="min-height:48px;font-size:13px"
              placeholder="Definition (Chinese) *">${escHtml(r.definition || '')}</textarea>
            <input class="form-input" id="ledit-ex-${i}" type="text" style="font-size:13px"
              placeholder="Example sentence (English) — required for Fill-in-Gap"
              value="${escHtml(r.example || '')}">
            <input class="form-input" id="ledit-cn-${i}" type="text" style="font-size:13px"
              placeholder="Example sentence (Chinese translation)"
              value="${escHtml(r.chinese || '')}">
          </div>
        </div>
      </div>`;
  }).join('');

  document.getElementById('lookup-preview').innerHTML = `
    <div style="border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin-bottom:4px">
      <div style="display:flex;align-items:center;padding:8px 12px;background:var(--bg);font-size:11px;font-weight:600;color:var(--text-sub);text-transform:uppercase;gap:10px">
        <div style="width:16px"></div>
        <div style="width:110px">Input</div>
        <div style="width:130px">Matched · ${foundCount} found</div>
        <div style="flex:1">Definition preview</div>
        <div style="width:40px"></div>
      </div>
      ${rows}
    </div>`;

  const actionsEl = document.getElementById('lookup-actions');
  actionsEl.style.display = 'flex';
  actionsEl.style.alignItems = 'center';
  updateLookupCount();

  // Auto-expand rows that are missing an example sentence so the user notices
  results.forEach((r, i) => {
    if (r.found && !r.example) toggleLookupEdit(i, true);
  });
}

function toggleLookupEdit(idx, forceOpen) {
  const el = document.getElementById(`ledit-${idx}`);
  if (!el) return;
  const isOpen = el.style.display !== 'none';
  el.style.display = (forceOpen || !isOpen) ? 'block' : 'none';
}

function updateLookupCount() {
  const checked = document.querySelectorAll('[id^="chk-"]:checked').length;
  const el = document.getElementById('lookup-count');
  if (el) el.textContent = `${checked} word${checked !== 1 ? 's' : ''} selected`;
}

async function importLookupResults() {
  const bookSel = document.getElementById('import-book').value;
  const newBook = bookSel === '__new__';
  const bookname = newBook ? (document.getElementById('new-book-name')?.value?.trim() || '') : bookSel;
  if (!bookname) { showToast('Choose or create a target book'); return; }

  // Merge any inline edits back into _lookupResults before sending
  _lookupResults.forEach((r, i) => {
    if (!r.found) return;
    const defEl = document.getElementById(`ledit-def-${i}`);
    const exEl  = document.getElementById(`ledit-ex-${i}`);
    const cnEl  = document.getElementById(`ledit-cn-${i}`);
    if (defEl) r.definition = defEl.value.trim() || r.definition;
    if (exEl)  r.example    = exEl.value.trim();
    if (cnEl)  r.chinese    = cnEl.value.trim();
  });

  const selected = _lookupResults.filter((r, i) => {
    const chk = document.getElementById(`chk-${i}`);
    return chk && chk.checked && r.found;
  });
  if (!selected.length) { showToast('Nothing selected'); return; }

  const result = await api.import_word_matches(selected, bookname, newBook);
  const ok = typeof result === 'string' && result.startsWith('Successfully');
  if (ok) {
    sfx('success');
    // Write any user-edited fields to Word_Overrides (non-destructive — never modifies Words table)
    const overrides = {};
    selected.forEach(r => {
      const orig = _lookupResults.find(x => x.matched === r.matched);
      if (!orig) return;
      // Only store as override if the user actually changed something vs DB value
      const defChanged = r.definition !== (orig._origDef ?? r.definition);
      const exChanged  = r.example    !== (orig._origEx  ?? r.example);
      const cnChanged  = r.chinese    !== (orig._origCn  ?? r.chinese);
      if (defChanged || exChanged || cnChanged) {
        overrides[r.matched] = { definition: r.definition, example: r.example, chinese: r.chinese };
      }
    });
    if (Object.keys(overrides).length) await api.apply_word_overrides(overrides);
  }
  document.getElementById('import-result').innerHTML =
    `<div class="result-msg ${ok ? 'ok' : 'err'}">${escHtml(String(result))}</div>`;
}

// ── Other tabs ─────────────────────────────────────────────────────────────
function tabClipboard() {
  return `
    <div>
      <div class="form-row">
        <label class="form-label">Paste content (word = definition format)</label>
        <textarea class="form-textarea" id="clip-text" placeholder="apple = a round fruit&#10;banana = a long yellow fruit&#10;..."></textarea>
      </div>
      <div style="display:flex;gap:16px">
        <div class="form-row" style="flex:1">
          <label class="form-label">Field separator</label>
          <input class="form-input" id="clip-field-sep" type="text" value=" = ">
        </div>
        <div class="form-row" style="flex:1">
          <label class="form-label">Entry separator</label>
          <input class="form-input" id="clip-entry-sep" type="text" value="&#10;">
        </div>
      </div>
      <div style="margin-bottom:10px">
        <div style="font-size:13px;color:var(--text-sub);margin-bottom:6px">Optional fields (leave unchecked to omit from each entry)</div>
        <label style="display:inline-flex;align-items:center;gap:6px;margin-right:16px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="clip-inc-ex" checked> English example (field 3)
        </label>
        <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="clip-inc-cn" checked> Chinese example (field 4)
        </label>
      </div>
      <div style="margin-top:4px">
        <button class="btn-primary" data-action="doImport">Import</button>
      </div>
    </div>`;
}

function tabTxt() {
  return `
    <div>
      <div class="form-row">
        <label class="form-label">File path</label>
        <div style="display:flex;gap:8px">
          <input class="form-input" id="txt-path" type="text" placeholder="/path/to/file.txt" style="flex:1">
          <button class="btn-secondary" style="padding:10px 16px;white-space:nowrap" data-action="pickFile" data-input-id="txt-path" data-file-types='["Text files (*.txt)","All files (*.*)"]'>Browse…</button>
        </div>
      </div>
      <div style="display:flex;gap:16px">
        <div class="form-row" style="flex:1">
          <label class="form-label">Field separator</label>
          <input class="form-input" id="txt-field-sep" type="text" value=" = ">
        </div>
        <div class="form-row" style="flex:1">
          <label class="form-label">Entry separator</label>
          <input class="form-input" id="txt-entry-sep" type="text" value="&#10;">
        </div>
      </div>
      <div style="margin-bottom:10px">
        <div style="font-size:13px;color:var(--text-sub);margin-bottom:6px">Optional fields (leave unchecked to omit from each entry)</div>
        <label style="display:inline-flex;align-items:center;gap:6px;margin-right:16px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="txt-inc-ex" checked> English example (field 3)
        </label>
        <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="txt-inc-cn" checked> Chinese example (field 4)
        </label>
      </div>
    </div>`;
}

function tabExcel() {
  return `
    <div>
      <div class="form-row">
        <label class="form-label">File path</label>
        <div style="display:flex;gap:8px">
          <input class="form-input" id="xl-path" type="text" placeholder="/path/to/file.xlsx" style="flex:1">
          <button class="btn-secondary" style="padding:10px 16px;white-space:nowrap" data-action="pickFile" data-input-id="xl-path" data-file-types='["Excel files (*.xlsx *.xls)","All files (*.*)"]'>Browse…</button>
        </div>
      </div>
      <div style="display:flex;gap:16px">
        <div class="form-row" style="flex:1">
          <label class="form-label">Sheet name</label>
          <input class="form-input" id="xl-sheet" type="text" placeholder="Sheet1">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-row"><label class="form-label">Word column</label><input class="form-input" id="xl-word" type="text" value="word"></div>
        <div class="form-row"><label class="form-label">Definition column</label><input class="form-input" id="xl-def" type="text" value="definition"></div>
        <div class="form-row">
          <label class="form-label" style="display:flex;align-items:center;gap:6px">
            <input type="checkbox" id="xl-inc-ex" checked> English example column
          </label>
          <input class="form-input" id="xl-ex" type="text" value="example">
        </div>
        <div class="form-row">
          <label class="form-label" style="display:flex;align-items:center;gap:6px">
            <input type="checkbox" id="xl-inc-cn" checked> Chinese example column
          </label>
          <input class="form-input" id="xl-cn" type="text" value="chinese">
        </div>
      </div>
    </div>`;
}

function tabJson() {
  return `
    <div>
      <div class="form-row">
        <label class="form-label">File path</label>
        <div style="display:flex;gap:8px">
          <input class="form-input" id="json-path" type="text" placeholder="/path/to/file.json" style="flex:1">
          <button class="btn-secondary" style="padding:10px 16px;white-space:nowrap" data-action="pickFile" data-input-id="json-path" data-file-types='["JSON files (*.json)","All files (*.*)"]'>Browse…</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-row"><label class="form-label">Vocab key</label><input class="form-input" id="json-vocab" type="text" value="word"></div>
        <div class="form-row"><label class="form-label">Definition key</label><input class="form-input" id="json-def" type="text" value="definition"></div>
        <div class="form-row">
          <label class="form-label" style="display:flex;align-items:center;gap:6px">
            <input type="checkbox" id="json-inc-ex" checked> English example key
          </label>
          <input class="form-input" id="json-ex" type="text" value="example">
        </div>
        <div class="form-row">
          <label class="form-label" style="display:flex;align-items:center;gap:6px">
            <input type="checkbox" id="json-inc-cn" checked> Chinese example key
          </label>
          <input class="form-input" id="json-cn" type="text" value="chinese">
        </div>
      </div>
    </div>`;
}

async function pickFile(inputId, fileTypes) {
  const path = await api.open_file_dialog(fileTypes);
  if (path) {
    const el = document.getElementById(inputId);
    if (el) el.value = path;
  }
}

async function doImport() {
  const bookSel = document.getElementById('import-book').value;
  const newBook = bookSel === '__new__';
  let bookname = newBook ? (document.getElementById('new-book-name')?.value?.trim() || '') : bookSel;
  if (!bookname) { showToast('Please enter a book name'); return; }

  const resultEl = document.getElementById('import-result');
  resultEl.innerHTML = '<div style="color:var(--text-sub);font-size:14px;margin-top:8px">Importing…</div>';

  let result;
  const activeTab = document.querySelector('.tab.active')?.id?.replace('tab-','') || 'clip';

  // Helper: compute positional field indices for text-based imports ("a,b\n" mode)
  function _textFieldIndices(incEx, incCn) {
    let next = 2; // word=0, def=1
    const exIdx = incEx ? next++ : 9999;
    const cnIdx = incCn ? next++ : 9999;
    return { exIdx, cnIdx };
  }

  if (activeTab === 'clip') {
    const text = document.getElementById('clip-text')?.value || '';
    const fs = document.getElementById('clip-field-sep')?.value || ' = ';
    const es = document.getElementById('clip-entry-sep')?.value || '\n';
    const incEx = document.getElementById('clip-inc-ex')?.checked ?? true;
    const incCn = document.getElementById('clip-inc-cn')?.checked ?? true;
    const { exIdx, cnIdx } = _textFieldIndices(incEx, incCn);
    result = await api.import_clipboard(text, bookname, fs, es, newBook, exIdx, cnIdx);
  } else if (activeTab === 'txt') {
    const path = document.getElementById('txt-path')?.value?.trim() || '';
    if (!path) { resultEl.innerHTML = '<div class="result-msg err">Please select a file.</div>'; return; }
    const fs = document.getElementById('txt-field-sep')?.value || ' = ';
    const es = document.getElementById('txt-entry-sep')?.value || '\n';
    const incEx = document.getElementById('txt-inc-ex')?.checked ?? true;
    const incCn = document.getElementById('txt-inc-cn')?.checked ?? true;
    const { exIdx, cnIdx } = _textFieldIndices(incEx, incCn);
    result = await api.import_txt(path, bookname, fs, es, newBook, exIdx, cnIdx);
  } else if (activeTab === 'excel') {
    const path = document.getElementById('xl-path')?.value?.trim() || '';
    if (!path) { resultEl.innerHTML = '<div class="result-msg err">Please select a file.</div>'; return; }
    const incEx = document.getElementById('xl-inc-ex')?.checked ?? true;
    const incCn = document.getElementById('xl-inc-cn')?.checked ?? true;
    result = await api.import_excel(
      path, bookname,
      document.getElementById('xl-sheet')?.value || 'Sheet1',
      document.getElementById('xl-word')?.value || 'word',
      document.getElementById('xl-def')?.value || 'definition',
      incEx ? (document.getElementById('xl-ex')?.value || 'example') : '',
      incCn ? (document.getElementById('xl-cn')?.value || 'chinese') : '',
      newBook
    );
  } else if (activeTab === 'json') {
    const path = document.getElementById('json-path')?.value?.trim() || '';
    if (!path) { resultEl.innerHTML = '<div class="result-msg err">Please select a file.</div>'; return; }
    const incEx = document.getElementById('json-inc-ex')?.checked ?? true;
    const incCn = document.getElementById('json-inc-cn')?.checked ?? true;
    result = await api.import_json(
      path, bookname,
      document.getElementById('json-vocab')?.value || 'word',
      document.getElementById('json-def')?.value || 'definition',
      incEx ? (document.getElementById('json-ex')?.value || 'example') : '',
      incCn ? (document.getElementById('json-cn')?.value || 'chinese') : '',
      newBook
    );
  }

  const ok = typeof result === 'string' && result.startsWith('Successfully');
  resultEl.innerHTML = `<div class="result-msg ${ok ? 'ok' : 'err'}">${escHtml(String(result))}</div>`;
}

// ── Manage tab ─────────────────────────────────────────────────────────────
// Lets the user browse, edit (definition/example/chinese), and remove words
// from a book. Uses the import page's book selector so no extra UI is needed.

let _manageState = { offset: 0, limit: 50, total: 0, search: '' };

function tabManageSkeleton() {
  return `
    <div id="manage-container">
      <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
        <input class="form-input" id="manage-search" type="text" placeholder="Search words…"
               style="flex:1" data-input="onManageSearch" />
        <button class="btn-secondary" data-action="loadManageWords">Refresh</button>
      </div>
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-sub);margin-bottom:10px;cursor:pointer">
        <input type="checkbox" id="manage-missing-only" data-change="loadManageWords" data-offset="0">
        Show only words missing example sentence (⚠)
      </label>
      <div id="manage-list"><div class="spinner"></div></div>
      <div id="manage-pager" style="display:flex;gap:8px;justify-content:center;margin-top:10px"></div>
    </div>`;
}

async function loadManageWords(offset = 0) {
  const bookSel = document.getElementById('import-book')?.value;
  if (!bookSel || bookSel === '__new__') {
    document.getElementById('manage-list').innerHTML =
      '<div style="color:var(--text-sub);font-size:14px;padding:12px 0">Select a book above.</div>';
    return;
  }
  _manageState.offset = offset;
  _manageState.search = document.getElementById('manage-search')?.value?.trim() || '';
  const listEl  = document.getElementById('manage-list');
  const pagerEl = document.getElementById('manage-pager');
  if (!listEl) return;
  listEl.innerHTML = '<div class="spinner"></div>';

  const missingOnly = document.getElementById('manage-missing-only')?.checked || false;
  const data = await api.get_book_words(bookSel, offset, _manageState.limit, _manageState.search, missingOnly);
  if (data.error) {
    listEl.innerHTML = `<div style="color:var(--danger);font-size:14px">${escHtml(data.error)}</div>`;
    return;
  }
  _manageState.total = data.total;

  if (!data.words.length) {
    listEl.innerHTML = '<div style="color:var(--text-sub);font-size:14px;padding:12px 0">No words found.</div>';
    if (pagerEl) pagerEl.innerHTML = '';
    return;
  }

  // Store word data on window so openWordEditor can pre-fill without extra API call
  window._manageWordData = {};
  data.words.forEach(w => { window._manageWordData[w.id] = w; });

  const rows = data.words.map(w => {
    const missingEx = !w.example;
    const warn = missingEx
      ? `<span title="Missing example sentence — Fill-in-Gap will fall back to definition prompt"
               style="color:var(--warning);font-size:13px;flex-shrink:0">⚠</span>` : '';
    return `
    <div class="manage-word-row" id="mwr-${w.id}">
      <div class="manage-word-vocab">${escHtml(w.vocab)}</div>
      <div class="manage-word-def" id="mwd-${w.id}">${escHtml(w.definition)}</div>
      ${warn}
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn-ghost manage-edit-btn" data-action="openWordEditor" data-word-id="${w.id}" data-vocab="${escHtml(w.vocab)}">Edit</button>
        <button class="btn-ghost manage-del-btn"  data-action="removeWordFromBook" data-word-id="${w.id}" data-book="${escHtml(bookSel)}" data-vocab="${escHtml(w.vocab)}">✕</button>
      </div>
    </div>`;
  }).join('');

  listEl.innerHTML = `
    <div style="font-size:12px;color:var(--text-sub);margin-bottom:6px">
      ${data.total} word${data.total !== 1 ? 's' : ''}${_manageState.search ? ' matching "' + escHtml(_manageState.search) + '"' : ''}
    </div>
    <div style="border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
      ${rows}
    </div>`;

  // Pagination
  const pages = Math.ceil(data.total / _manageState.limit);
  const cur   = Math.floor(offset / _manageState.limit);
  if (pagerEl) {
    pagerEl.innerHTML = pages <= 1 ? '' : `
      <button class="btn-ghost" ${cur === 0 ? 'disabled' : ''} data-action="loadManageWords" data-offset="${(cur-1)*_manageState.limit}">‹ Prev</button>
      <span style="font-size:13px;color:var(--text-sub);align-self:center">Page ${cur+1} / ${pages}</span>
      <button class="btn-ghost" ${cur >= pages-1 ? 'disabled' : ''} data-action="loadManageWords" data-offset="${(cur+1)*_manageState.limit}">Next ›</button>`;
  }
}

let _manageSearchTimer;
function onManageSearch() {
  clearTimeout(_manageSearchTimer);
  _manageSearchTimer = setTimeout(() => loadManageWords(0), 350);
}

// Inline word editor — replaces the row with an edit form
function openWordEditor(wordId, vocab) {
  const row = document.getElementById(`mwr-${wordId}`);
  if (!row) return;
  const w = (window._manageWordData || {})[wordId] || {};
  const missingEx = !w.example;
  row.innerHTML = `
    <div style="flex:1;display:flex;flex-direction:column;gap:6px">
      <div style="font-weight:600;font-size:14px">${escHtml(vocab)}</div>
      <textarea class="form-textarea" id="edit-def-${wordId}" style="min-height:56px;font-size:13px"
                placeholder="Definition (Chinese)">${escHtml(w.definition || '')}</textarea>
      <div>
        <input class="form-input" id="edit-ex-${wordId}" type="text" style="font-size:13px"
          placeholder="Example sentence (English) — required for Fill-in-Gap ✱"
          value="${escHtml(w.example || '')}">
        ${missingEx ? `<div style="font-size:11px;color:var(--warning);margin-top:3px">⚠ No example — Fill-in-Gap practice will show the definition as a fallback instead of a sentence.</div>` : ''}
      </div>
      <input class="form-input" id="edit-cn-${wordId}" type="text" style="font-size:13px"
        placeholder="Chinese translation of example"
        value="${escHtml(w.chinese || '')}">
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
      <button class="btn-primary" style="font-size:13px" data-action="saveWordEdit" data-word-id="${wordId}">Save</button>
      <button class="btn-ghost"   style="font-size:13px" data-action="loadManageWords" data-offset="${_manageState.offset}">Cancel</button>
    </div>`;
}

async function saveWordEdit(wordId) {
  const def = document.getElementById(`edit-def-${wordId}`)?.value?.trim() || '';
  const ex  = document.getElementById(`edit-ex-${wordId}`)?.value?.trim()  || '';
  const cn  = document.getElementById(`edit-cn-${wordId}`)?.value?.trim()  || '';
  const res = await api.update_word(wordId, def, ex, cn);
  if (res.error) { showToast('Error: ' + res.error); return; }
  sfx('tap');
  showToast('Saved');
  loadManageWords(_manageState.offset);
}

async function removeWordFromBook(wordId, bookName, vocab) {
  showConfirm(
    `Remove "${vocab}"?`,
    `This removes "${vocab}" from the book "${bookName}". The word data itself is kept.`,
    'Remove',
    async () => {
      const res = await api.remove_word_from_book(wordId, bookName);
      if (res.error) { showToast('Error: ' + res.error); return; }
      sfx('tap');
      showToast(`Removed "${vocab}"`);
      loadManageWords(_manageState.offset);
    },
    true
  );
}

// ── Delegation adapters ───────────────────────────────────────────────────
export const actions = {
  switchTab: (el) => switchTab(el.dataset.tab),
  doLookup: () => doLookup(),
  importLookupResults: () => importLookupResults(),
  toggleLookupEdit: (el) => toggleLookupEdit(Number(el.dataset.idx)),
  updateLookupCount: () => updateLookupCount(),
  doImport: () => doImport(),
  pickFile: (el) => pickFile(el.dataset.inputId, JSON.parse(el.dataset.fileTypes)),
  loadManageWords: (el) => loadManageWords(el.dataset.offset != null ? Number(el.dataset.offset) : 0),
  onManageSearch: () => onManageSearch(),
  openWordEditor: (el) => openWordEditor(Number(el.dataset.wordId), el.dataset.vocab),
  saveWordEdit: (el) => saveWordEdit(Number(el.dataset.wordId)),
  removeWordFromBook: (el) => removeWordFromBook(Number(el.dataset.wordId), el.dataset.book, el.dataset.vocab),
};
