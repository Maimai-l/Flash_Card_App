/* ════════════════════════════════════════════════════════════════════════
   DEBUG PAGE
   ════════════════════════════════════════════════════════════════════════ */
import { S, store } from '../core/state.js';
import { api } from '../core/api.js';
import { setTopBar, $content, escHtml, shuffle, stripCite } from '../core/dom.js';
import { showToast } from '../core/ui.js';
import { navigate } from '../core/router.js';

export async function renderDebug() {
  setTopBar('🐛 Debug Inspector', true);
  $content().innerHTML = '<div class="spinner"></div>';

  const stats = await api.get_db_stats();
  if (stats.error) {
    $content().innerHTML = `<div class="result-msg err">Error: ${escHtml(stats.error)}</div>`;
    return;
  }

  const stateRows = Object.entries(stats.fsrs_states || {}).map(([label, cnt]) => `
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:13px;color:var(--text-sub)">${escHtml(label)}</span>
      <span style="font-size:13px;font-weight:600">${cnt}</span>
    </div>`).join('');

  const bookRows = (stats.books || []).map(b => `
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:13px">${escHtml(b.name)}</span>
      <span style="font-size:13px;font-weight:600;color:var(--text-sub)">${b.count} words</span>
    </div>`).join('');

  $content().innerHTML = `
    <div style="padding:0 0 40px">

      <!-- Schema & word counts -->
      <div class="section-label">Database Overview</div>
      <div class="list-group" style="margin-bottom:20px">
        <div style="padding:0 16px">
          ${[
            ['Schema Version', stats.schema_version],
            ['Total Words', stats.total_words],
            ['Words w/ Definition', stats.words_with_definition],
            ['Never Seen (new)', stats.never_seen],
            ['Due Now', stats.due_now],
          ].map(([label, val]) => `
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
              <span style="font-size:13px;color:var(--text-sub)">${label}</span>
              <span style="font-size:13px;font-weight:600">${val}</span>
            </div>`).join('')}
        </div>
      </div>

      <!-- FSRS state distribution -->
      <div class="section-label">FSRS State Distribution</div>
      <div class="list-group" style="margin-bottom:20px">
        <div style="padding:0 16px">${stateRows || '<div style="padding:8px 0;font-size:13px;color:var(--text-sub)">No data</div>'}</div>
      </div>

      <!-- Books -->
      <div class="section-label">Books</div>
      <div class="list-group" style="margin-bottom:20px">
        <div style="padding:0 16px">${bookRows || '<div style="padding:8px 0;font-size:13px;color:var(--text-sub)">No books</div>'}</div>
      </div>

      <!-- FSRS Scheduler Tester -->
      <div class="section-label">FSRS Scheduler Tester</div>
      <div class="list-group" style="margin-bottom:20px;padding:16px">
        <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
          <div style="flex:1;min-width:120px">
            <div style="font-size:11px;color:var(--text-sub);margin-bottom:4px;text-transform:uppercase;font-weight:600">Word</div>
            <input class="form-input" id="dbg-word" type="text" placeholder="e.g. apple" style="margin:0">
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-sub);margin-bottom:4px;text-transform:uppercase;font-weight:600">Rating</div>
            <select class="styled-select" id="dbg-rating" style="width:130px">
              <option value="1">1 — Again</option>
              <option value="2">2 — Hard</option>
              <option value="3" selected>3 — Good</option>
              <option value="4">4 — Easy</option>
            </select>
          </div>
          <button class="btn-primary" data-action="debugTestFSRS" style="height:40px;padding:0 20px">Test</button>
        </div>
        <div id="dbg-fsrs-result" style="margin-top:12px;font-size:13px;font-family:monospace;color:var(--text-sub)"></div>
      </div>

      <!-- Force load session -->
      <div class="section-label">Force Load Session</div>
      <div class="list-group" style="margin-bottom:20px;padding:16px">
        <div style="display:flex;gap:10px;align-items:flex-end">
          <div style="flex:1">
            <div style="font-size:11px;color:var(--text-sub);margin-bottom:4px;text-transform:uppercase;font-weight:600">Word count</div>
            <input class="form-input" id="dbg-count" type="number" value="10" min="1" max="50" style="margin:0">
          </div>
          <button class="btn-primary" data-action="debugForceSession" style="height:40px;padding:0 20px">Load Session</button>
        </div>
        <div style="font-size:11px;color:var(--text-sub);margin-top:8px">
          Loads N random words from "${escHtml(S.bookName || 'All')}" ignoring FSRS — great for testing GUI.
        </div>
      </div>

      <button class="btn-ghost w100" data-action="goBack">← Back to Home</button>
    </div>`;
}

async function debugTestFSRS() {
  const word = document.getElementById('dbg-word')?.value?.trim();
  const rating = parseInt(document.getElementById('dbg-rating')?.value || '3');
  const resultEl = document.getElementById('dbg-fsrs-result');
  if (!word) { if (resultEl) resultEl.textContent = 'Enter a word first.'; return; }
  if (resultEl) resultEl.textContent = 'Running…';
  const res = await api.record_answer(word, rating);
  if (resultEl) {
    if (res && res.error) {
      resultEl.innerHTML = `<span style="color:var(--danger)">Error: ${escHtml(res.error)}</span>`;
    } else if (res) {
      resultEl.innerHTML = [
        `due_date: <b>${res.due_date || '—'}</b>`,
        `stability: ${res.stability?.toFixed(4) ?? '—'}`,
        `difficulty: ${res.difficulty?.toFixed(4) ?? '—'}`,
        `state: ${res.state ?? '—'}`,
        `step: ${res.step ?? '—'}`,
      ].join('&nbsp;&nbsp;|&nbsp;&nbsp;');
    }
  }
}

async function debugForceSession() {
  const count = parseInt(document.getElementById('dbg-count')?.value || '10');
  const words = await api.get_debug_words(S.bookName, count);
  if (!words || words.error || !words.length) {
    showToast('No words found', 2000);
    return;
  }
  const normalised = words.map(w => ({
    word: w.word, def: w.definition || '', ex: stripCite(w.example || ''), cn: w.chinese || ''
  }));
  store.PS = {
    words:       normalised,
    queue:       shuffle([...normalised]),
    phase:       'flashcard',
    fcIdx:       0,
    flipped:     false,
    current:     null,
    mode:        'fig',
    locked:      false,
    startTime:   0,
    stats:       { answers: 0, correct: 0, again: 0, hard: 0, good: 0, easy: 0 },
    wordResults: new Map(),
    mcqType:     null,
    mcqCorrect:  null,
  };
  showToast(`🐛 Loaded ${normalised.length} words (FSRS bypassed)`, 2000);
  navigate('session');
}

// ── Delegation adapters ───────────────────────────────────────────────────
export const actions = {
  debugTestFSRS: () => debugTestFSRS(),
  debugForceSession: () => debugForceSession(),
};
