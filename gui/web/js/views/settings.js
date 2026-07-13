/* ════════════════════════════════════════════════════════════════════════
   SETTINGS PAGE
   ════════════════════════════════════════════════════════════════════════ */
import { S, store } from '../core/state.js';
import { api } from '../core/api.js';
import { setTopBar, $content, escHtml } from '../core/dom.js';
import { showToast, showConfirm } from '../core/ui.js';
import { clearSession } from '../core/session_store.js';
import { renderHome } from './home.js';

export async function renderSettings() {
  setTopBar('Settings', true);
  const appInfo = await api.get_app_info();
  const count = appInfo.daily_new_limit || 20;

  $content().innerHTML = `
    <div class="settings-page">
      <!-- Daily Goals -->
      <div class="section-label" style="padding-left:0;padding-top:16px">Daily Goals</div>
      <div class="list-group">
        <div class="list-row">
          <span class="list-row-label">New Cards / Day</span>
          <span id="slider-val" style="font-size:15px;font-weight:500;color:var(--text-main)">${count}</span>
        </div>
        <div style="padding:8px 16px 12px;background:var(--card)">
          <input type="range" id="count-slider" min="10" max="50" step="5" value="${count}"
            data-input="updateSliderVal">
        </div>
      </div>
      <div style="font-size:12px;color:var(--text-sub);padding:6px 16px 0">Drag the slider to adjust cards per session.</div>

      <!-- Data Management -->
      <div class="section-label" style="padding-left:0;padding-top:20px">Data Management</div>
      <div class="list-group">
        <div class="list-row" style="cursor:pointer" data-action="exportData">
          <span class="list-row-label">Export Data Backup</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               style="color:var(--text-sub)">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </div>
        <div class="list-row" style="cursor:pointer" data-action="importData">
          <span class="list-row-label">Import Data Backup</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               style="color:var(--text-sub)">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>
        <div class="list-row" style="border:none;cursor:pointer;border-top:1px solid var(--border)" data-action="confirmReset">
          <span class="list-row-label" style="color:var(--danger);text-align:center">Reset Progress &amp; Imported Books</span>
        </div>
        ${S.debug ? `<div class="list-row" style="border:none;cursor:pointer;border-top:1px solid var(--border)" data-action="confirmFactoryReset">
          <span class="list-row-label" style="color:var(--danger);text-align:center;opacity:.6">Factory Reset (Dev)</span>
        </div>` : ''}
      </div>
      <div id="data-backup-result" style="font-size:12px;padding:4px 16px 0;min-height:18px"></div>
      <div style="font-size:12px;color:var(--text-sub);padding:4px 16px 0">Export saves all your books, progress, and edits to a file. Import restores from a backup — <b>existing data will be overwritten</b>.</div>

      <!-- Updates -->
      <div class="section-label" style="padding-left:0;padding-top:20px">Updates</div>
      <div class="list-group" style="margin-bottom:4px">
        <div class="list-row" style="cursor:pointer" data-action="checkForUpdates">
          <span class="list-row-label">Check for Updates</span>
          <span id="update-badge" style="font-size:12px;color:var(--text-sub)">v${appInfo.app_version || '—'}</span>
        </div>
      </div>
      <div id="update-result" style="margin:0 0 4px"></div>

      <!-- Diagnostics -->
      <div class="section-label" style="padding-left:0;padding-top:20px">Diagnostics</div>
      <div class="list-group" style="margin-bottom:4px">
        <div class="list-row" style="border:none;cursor:pointer" data-action="exportLog">
          <span class="list-row-label">Export Log File</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               style="color:var(--text-sub)">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </div>
      </div>
      <div style="font-size:12px;color:var(--text-sub);padding:4px 16px 0">Save the app log to diagnose issues.</div>

      <!-- Acknowledgements -->
      <div class="section-label" style="padding-left:0;padding-top:20px">Acknowledgements</div>
      <div class="list-group">
        <div style="padding:16px;font-size:13px;color:var(--text-sub);line-height:1.7">
          <b>Resources &amp; Acknowledgements</b><br><br>
          · Mahavivo – English Wordlists<br>
          · Kaleofeng – Definition &amp; Example Generator (Bing Scraper)<br>
          · Dyeeee – English-Chinese Dictionary<br>
          · COCA bilingual examples and form lists<br>
          · Changhongzi – BNC_COCA_EN2CN Word Bank<br><br>
          We are grateful to all authors and contributors.
        </div>
      </div>

      <div style="margin-top:32px;text-align:center;padding-bottom:32px">
        <button class="btn-primary" data-action="saveSettings">Save Changes</button>
        <div style="margin-top:14px;font-size:12px;color:var(--border)">
          FlashCard App v${appInfo.app_version || '—'}
        </div>
      </div>
    </div>`;
}

async function saveSettings() {
  const count = parseInt(document.getElementById('count-slider').value);
  const appInfo = await api.get_app_info();
  appInfo.daily_new_limit = count;
  await api.update_app_info(appInfo);

  showToast('Settings saved.');
}

async function checkForUpdates() {
  const badge  = document.getElementById('update-badge');
  const result = document.getElementById('update-result');
  if (!result) return;

  if (badge) badge.textContent = 'Checking…';
  result.innerHTML = '';

  const res = await api.check_for_updates();

  if (res.error) {
    if (badge) badge.textContent = '';
    result.innerHTML = `
      <div style="margin:6px 16px;padding:10px 14px;border-radius:8px;background:rgba(255,59,48,.08);
                  font-size:13px;color:var(--danger)">
        Unable to check for updates. Please verify your internet connection.<br>
        <span style="font-size:11px;color:var(--text-sub)">${escHtml(res.error)}</span>
      </div>`;
    return;
  }

  if (badge) badge.textContent = `v${res.current}`;

  if (res.up_to_date) {
    result.innerHTML = `
      <div style="margin:6px 16px;padding:10px 14px;border-radius:8px;background:rgba(52,199,89,.08);
                  font-size:13px;color:var(--success);display:flex;align-items:center;gap:8px">
        <span style="font-size:16px">✓</span>
        You're up to date — v${escHtml(res.current)} is the latest version.
      </div>`;
  } else {
    const notes = res.release_notes
      ? `<div style="margin-top:8px;font-size:12px;color:var(--text-sub);white-space:pre-wrap;line-height:1.5">${escHtml(res.release_notes)}</div>`
      : '';
    const hasAsset = !!res.asset_url;
    const installBtn = hasAsset
      ? `<button class="btn-primary" id="install-update-btn" style="font-size:13px;flex-shrink:0"
                 data-action="startAutoUpdate" data-asset-url="${escHtml(res.asset_url)}">
           Install &amp; Restart
         </button>`
      : `<button class="btn-primary" style="font-size:13px;flex-shrink:0"
                 data-action="openUrl" data-url="${escHtml(res.download_url)}">
           Download →
         </button>`;
    result.innerHTML = `
      <div style="margin:6px 16px;padding:12px 14px;border-radius:8px;background:rgba(0,122,255,.08);
                  font-size:13px;border:1px solid rgba(0,122,255,.2)">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
          <div>
            <span style="color:var(--accent);font-weight:600">New version available: v${escHtml(res.latest)}</span>
            <span style="color:var(--text-sub);margin-left:8px">(current: v${escHtml(res.current)})</span>
          </div>
          ${installBtn}
        </div>
        ${notes}
        <div id="update-progress-wrap" style="display:none;margin-top:12px">
          <div style="background:var(--border);border-radius:4px;height:6px;overflow:hidden">
            <div id="update-progress-bar" style="height:100%;width:0%;background:var(--accent);transition:width .3s"></div>
          </div>
          <div id="update-progress-label" style="margin-top:6px;font-size:12px;color:var(--text-sub)"></div>
        </div>
      </div>`;
  }
}

let _updatePollTimer = null;
async function startAutoUpdate(assetUrl) {
  const btn = document.getElementById('install-update-btn');
  if (btn) btn.disabled = true;

  const wrap  = document.getElementById('update-progress-wrap');
  const bar   = document.getElementById('update-progress-bar');
  const label = document.getElementById('update-progress-label');
  if (wrap) wrap.style.display = 'block';

  await api.download_and_install_update(assetUrl);

  // Poll progress every 400ms
  _updatePollTimer = setInterval(async () => {
    const p = await api.get_update_progress();
    if (!p) return;

    if (bar)   bar.style.width = (p.pct || 0) + '%';

    const msgs = {
      downloading: `Downloading… ${p.pct || 0}%`,
      extracting:  'Verifying…',
      launching:   'Launching updater…',
      done:        'Restarting…',
      error:       `Error: ${p.error || 'unknown'}`,
    };
    if (label) label.textContent = msgs[p.state] || '';

    if (p.state === 'done' || p.state === 'error') {
      clearInterval(_updatePollTimer);
      if (p.state === 'error' && btn) btn.disabled = false;
    }
  }, 400);
}

async function exportLog() {
  const res = await api.export_log();
  if (!res || res.cancelled) return;
  if (res.error) { showToast('Error: ' + res.error, 3000); return; }
  showToast('Log saved to: ' + res.path, 4000);
}

async function exportData() {
  const statusEl = document.getElementById('data-backup-result');
  if (statusEl) statusEl.innerHTML = '<span style="color:var(--text-sub)">Saving…</span>';
  const res = await api.export_data();
  if (!res || res.cancelled) { if (statusEl) statusEl.innerHTML = ''; return; }
  if (res.error) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger)">${escHtml(res.error)}</span>`;
    return;
  }
  if (statusEl) statusEl.innerHTML = `<span style="color:#34C759">Backup saved.</span>`;
  showToast('Backup saved to: ' + res.path, 4000);
}

async function importData() {
  showConfirm(
    'Import Data Backup',
    'This will OVERWRITE all your current books, progress, and word edits with the backup file. This cannot be undone. The app will need to restart after import.',
    'Choose File & Overwrite',
    async () => {
      const path = await api.open_file_dialog(['Database files (*.db)', 'All files (*.*)']);
      if (!path) return;
      const statusEl = document.getElementById('data-backup-result');
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--text-sub)">Importing…</span>';
      const res = await api.import_data(path);
      if (res && res.error) {
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger)">${escHtml(res.error)}</span>`;
        return;
      }
      if (statusEl) statusEl.innerHTML = '<span style="color:#34C759">Import complete. Please restart the app.</span>';
      showToast('Data imported. Please restart the app to apply changes.', 6000);
    }
  );
}

function confirmReset() {
  showConfirm(
    'Reset Progress & Imported Books',
    'This will reset all FSRS learning progress to zero and remove any books you imported. ' +
    'Preset word lists (CET 4+6, TOEFL, GRE) and their words are kept. Cannot be undone.',
    'Reset',
    async () => {
      const res = await api.soft_reset();
      if (res && res.error) { showToast('Error: ' + res.error, 3000); return; }
      clearSession();
      store.PS = null;
      S.bookName = null;
      S.history = [];
      S.page = 'home';
      showToast('Progress reset. Preset books preserved.', 3000);
      renderHome();
    }
  );
}

function confirmFactoryReset() {
  showConfirm(
    'Factory Reset (Dev)',
    'Wipes the entire database and rebuilds from scratch. All words and progress deleted.',
    'Wipe Everything',
    async () => {
      await api.reset_data();
      clearSession();
      store.PS = null;
      S.bookName = null;
      S.history = [];
      S.page = 'home';
      showToast('Full factory reset complete.', 3000);
      renderHome();
    }
  );
}

// ── Delegation adapters ───────────────────────────────────────────────────
export const actions = {
  exportData: () => exportData(),
  importData: () => importData(),
  confirmReset: () => confirmReset(),
  confirmFactoryReset: () => confirmFactoryReset(),
  checkForUpdates: () => checkForUpdates(),
  exportLog: () => exportLog(),
  saveSettings: () => saveSettings(),
  startAutoUpdate: (el) => startAutoUpdate(el.dataset.assetUrl),
  openUrl: (el) => api.open_url(el.dataset.url),
  updateSliderVal: (el) => { document.getElementById('slider-val').textContent = el.value; },
};
