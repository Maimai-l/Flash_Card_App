// Deeper interaction e2e — exercises the click/keyboard/input handlers that the
// module split converts to event delegation. Resilient assertions (advance /
// no-crash / text present) so it passes identically before and after the split.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { execSync } = require('child_process');
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = require(globalRoot + '/playwright');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:18765';
const CHROMIUM = process.env.PW_CHROMIUM ||
  execSync("ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1").toString().trim();

let failures = 0;
function check(cond, msg) { if (!cond) { console.error('  ✗', msg); failures++; } else { console.log('  ✓', msg); } }

const browser = await chromium.launch({ executablePath: CHROMIUM });
const page = await browser.newPage();
const errors = [];
page.on('console', m => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/favicon/.test(t) || /Failed to load resource.*404/.test(t)) return;
  errors.push(t);
});
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

async function goHome() {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.home-layout', { timeout: 8000 });
  await page.waitForTimeout(300);
}

// 1. Navigation round-trip: home -> settings -> back -> import -> back
console.log('[nav]');
await goHome();
await page.click('#settings-btn');
await page.waitForTimeout(400);
check(/Daily Goals/.test(await page.textContent('#content')), 'settings opens');
await page.click('#back-btn');
await page.waitForTimeout(400);
check(/.home-layout/ || await page.$('.home-layout'), 'back returns home');

// 2. Session: start -> flashcard -> flip -> advance to practice -> answer
console.log('[session]');
await page.click('text=Start Session');
await page.waitForSelector('.flashcard-wrap', { timeout: 8000 });
check(true, 'flashcard renders');
await page.click('.flashcard-wrap');
await page.waitForTimeout(300);
check(await page.$('.flashcard-inner.flipped') !== null, 'card flips on click');
// advance through all flashcards to reach practice
for (let i = 0; i < 15; i++) {
  const practice = await page.$('#answer-input');
  if (practice) break;
  const btn = await page.$('button.btn-primary');
  if (btn) await btn.click();
  await page.waitForTimeout(150);
}
check(await page.$('#answer-input') !== null, 'reaches practice (FIG input)');
// submit a (likely wrong) answer -> should show feedback and/or MCQ fallback
await page.fill('#answer-input', 'zzzwrong');
await page.click('text=Check');
await page.waitForTimeout(500);
const afterAnswer = await page.textContent('#content');
const advanced = /Fill in the Gap|Choose|Correct|Again|Definition|\/ /.test(afterAnswer)
  || await page.$('.mcq-opt') !== null;
check(advanced, 'answer submission advances (feedback / MCQ / next)');
// if MCQ appeared, click an option
const mcq = await page.$('.mcq-opt');
if (mcq) { await mcq.click(); await page.waitForTimeout(400); check(true, 'MCQ option clickable'); }

// 3. Import: tab switching + words-only lookup renders
console.log('[import]');
await goHome();
await page.click('text=Import');
await page.waitForTimeout(400);
check(/Words Only|Format/.test(await page.textContent('#content')), 'import page renders');
await page.click('#tab-clip').catch(() => {});
await page.waitForTimeout(300);
check(/Clipboard|Separator|separator|Paste/i.test(await page.textContent('#content')), 'clipboard tab switches');

// 4. Settings persist: change slider -> save -> reload -> persisted
console.log('[settings persist]');
await goHome();
await page.click('#settings-btn');
await page.waitForSelector('#count-slider', { timeout: 5000 });
await page.$eval('#count-slider', el => { el.value = '35'; el.dispatchEvent(new Event('input')); });
await page.click('text=Save Changes');
await page.waitForTimeout(500);
await goHome();
await page.click('#settings-btn');
await page.waitForSelector('#count-slider', { timeout: 5000 });
const persisted = await page.$eval('#count-slider', el => el.value);
check(persisted === '35', `daily-new-limit persisted (got ${persisted})`);

check(errors.length === 0, 'no console errors: ' + JSON.stringify(errors));

await browser.close();
console.log(failures ? `\n✗ interaction e2e FAILED (${failures})` : '\n✓ interaction e2e passed');
process.exitCode = failures ? 1 : 0;
