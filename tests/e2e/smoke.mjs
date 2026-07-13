// Playwright smoke test for the SPA, driven through the dev HTTP bridge.
// Usage: node smoke.mjs  (expects the app running at BASE_URL with FLASHCARD_DEV_BRIDGE=1)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { execSync } = require('child_process');

const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = require(globalRoot + '/playwright');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:18765';
const CHROMIUM = process.env.PW_CHROMIUM ||
  execSync("ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1").toString().trim();

function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } }

const browser = await chromium.launch({ executablePath: CHROMIUM });
const page = await browser.newPage();
const errors = [];
// Ignore the browser's automatic favicon.ico request (no favicon is bundled).
page.on('console', m => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/favicon/.test(t) || /Failed to load resource.*404/.test(t)) return;
  errors.push(t);
});
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle' });
await page.waitForSelector('.home-layout', { timeout: 8000 });
await page.waitForTimeout(400);

const home = await page.textContent('#content');
assert(/Start Session|Start New Session/.test(home), 'home shows Start Session');
assert(!/Mini Games/.test(home), 'Mini Games button is gone');

// Settings page
await page.click('#settings-btn');
await page.waitForTimeout(500);
const settings = await page.textContent('#content');
assert(/Daily Goals/.test(settings), 'settings shows Daily Goals');
assert(!/Game FSRS Boundaries/.test(settings), 'game FSRS boundaries removed');

// Import page reachable from home (go back first)
await page.click('#back-btn');
await page.waitForTimeout(400);
await page.click('text=Import');
await page.waitForTimeout(500);
const imp = await page.textContent('#content');
assert(/Words Only|Clipboard|Format/.test(imp), 'import page renders');

assert(errors.length === 0, 'no console errors: ' + JSON.stringify(errors));

await browser.close();
console.log(process.exitCode ? '✗ e2e smoke FAILED' : '✓ e2e smoke passed');
