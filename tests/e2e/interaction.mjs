/* Browser pass over every screen.
 *
 *   node tests/e2e/interaction.mjs [baseUrl]
 *
 * Needs Playwright and a running server (default http://127.0.0.1:8737).
 * It resets the database it talks to, so point it at a throwaway one:
 *
 *   KC_USER_DATA=/tmp/kc-e2e python main.py --no-browser &
 *   node tests/e2e/interaction.mjs
 */

import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://127.0.0.1:8737';
const failures = [];
let checks = 0;

function check(label, condition) {
  checks += 1;
  if (!condition) failures.push(label);
}

async function call(method, args = []) {
  const response = await fetch(`${BASE}/api`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args }),
  });
  return response.json();
}

const CARDS = {
  deck: 'Mathematics::Linear Algebra',
  cards: [
    { front: 'Define an eigenvector of $A$', back: 'A nonzero $v$ with $Av=\\lambda v$.' },
    { front: 'Rank-nullity theorem', back: '$\\operatorname{rank}(A)+\\operatorname{nullity}(A)=n$' },
    { front: 'What is a basis?', back: 'A linearly independent spanning set.' },
  ],
  quiz: {
    name: 'LA basics',
    subject: 'Mathematics',
    questions: [
      { type: 'mcq', prompt: 'Which is NOT an axiom?', options: ['Closure', 'Multiplicative inverse', 'Associativity'], answer: 1, explain: 'Additive, not multiplicative.' },
      { type: 'cloze', text: 'rank(A) + {{nullity(A)}} = {{n}}' },
      { type: 'short', prompt: 'Eigenvalue symbol?', answers: ['lambda', 'λ'] },
      { type: 'ordering', prompt: 'Order the steps', items: ['First', 'Second', 'Third'] },
    ],
  },
};

await call('reset_all');
await call('update_settings', [{ default_new_limit: '50', default_review_limit: '200', language: 'en' }]);
await call('import_commit', [JSON.stringify(CARDS)]);
await call('import_commit', [JSON.stringify({
  deck: 'Computer Science::Networks',
  cards: [{ front: 'What does ARP resolve?', back: 'IP to MAC on the local link.' }],
})]);

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium',
});
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
page.setDefaultTimeout(8000);

const consoleErrors = [];
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await page.waitForSelector('.due-card');

// ── Home ──────────────────────────────────────────────────────────────────
check('deck tree lists both subjects',
  await page.locator('.deck-item:has-text("Mathematics")').count() === 1
  && await page.locator('.deck-item:has-text("Computer Science")').count() === 1);
check('all four cards are offered',
  (await page.locator('.due-figure .value').first().textContent()).trim() === '4');
check('limits are described as per-subject, not summed',
  (await page.locator('.limit-line').textContent()).includes('Each subject'));
check('the state breakdown actually paints its bars',
  await page.locator('.states-card .bar-fill').first().evaluate((el) =>
    el.getBoundingClientRect().width) > 0);

// ── Review ────────────────────────────────────────────────────────────────
await page.click('.deck-item:has-text("Linear Algebra")');
await page.waitForTimeout(300);
await page.click('button:has-text("Study")');
await page.waitForSelector('.card-front');
check('maths renders on the front', await page.locator('.card-front .katex').count() > 0);
check('no rating buttons before the answer', await page.locator('.rating-btn').count() === 0);

await page.keyboard.press(' ');
await page.waitForSelector('.rating-btn');
check('four ratings, each with an interval',
  await page.locator('.rating-btn').count() === 4
  && (await page.locator('.rating-btn .interval').first().textContent()).trim().length > 0);

await page.keyboard.press('1');                       // Again
await page.waitForTimeout(300);
const afterAgain = await page.locator('.counter').textContent();
check('Again requeues the card into this sitting', afterAgain.includes('/ 4'));

await page.keyboard.press('z');                       // undo it
await page.waitForTimeout(400);
check('undo returns to an unanswered card',
  await page.locator('.rating-btn').count() === 0
  && (await page.locator('.counter').textContent()).startsWith('0'));

// edit the current card in place
await page.keyboard.press('e');
await page.waitForSelector('#edit-front');
await page.fill('#edit-back', 'Edited during review');
await page.click('button:has-text("Save")');
await page.waitForTimeout(400);
await page.keyboard.press(' ');
await page.waitForSelector('.card-back');
check('inline edit is visible immediately',
  (await page.locator('.card-back').textContent()).includes('Edited during review'));

for (let i = 0; i < 60; i++) {
  if (await page.locator('.result-score').count()) break;
  if (await page.locator('.rating-btn').count()) await page.keyboard.press('3');
  else if (await page.locator('button:has-text("Show answer")').count()) await page.keyboard.press(' ');
  await page.waitForTimeout(180);
}
check('the session reaches a summary', await page.locator('.result-score').count() === 1);
check('summary offers more study without obligation',
  await page.locator('button:has-text("Study more")').count() === 1);
await page.click('button:has-text("Done")');
await page.waitForSelector('.due-card');

// ── Quiz ──────────────────────────────────────────────────────────────────
await page.click('.nav-link:has-text("Quiz")');
await page.waitForSelector('.quiz-row-name');
check('quiz says it has never been taken',
  (await page.locator('.quiz-row-meta').first().textContent()).includes('never taken'));

await page.click('button:has-text("Start")');
await page.waitForSelector('.opt');
await page.click('.opt >> nth=2');                    // wrong on purpose
await page.waitForTimeout(300);
check('a wrong choice is marked wrong', await page.locator('.opt.wrong').count() === 1);
check('the right choice is shown', await page.locator('.opt.correct').count() === 1);
check('the explanation appears', await page.locator('.q-explain').count() === 1);
check('quizzes never ask you to self-rate', await page.locator('.rating-btn').count() === 0);

await page.keyboard.press('Enter');
await page.waitForSelector('.cloze-blank');
await page.fill('.cloze-blank >> nth=0', 'NULLITY(a)');   // loose matching
await page.fill('.cloze-blank >> nth=1', 'n');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
check('cloze is graded, not advanced, by one Enter',
  await page.locator('.cloze-blank.correct').count() === 2);

await page.keyboard.press('Enter');
await page.waitForSelector('#short-input');
await page.fill('#short-input', '  Lambda ');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
check('short answer ignores case and padding', await page.locator('.opt.correct').count() === 1);

await page.keyboard.press('Enter');
await page.waitForSelector('.order-item');
check('ordering shuffles the items',
  (await page.locator('.order-item .order-body').allTextContents()).join('|') !== 'First|Second|Third');
await page.click('button:has-text("Check")');
await page.waitForTimeout(300);
await page.keyboard.press('Enter');
await page.waitForSelector('.result-score');
check('results show a score out of four',
  (await page.locator('.result-score').textContent()).includes('/ 4'));
check('wrong answers can be retried alone',
  await page.locator('button:has-text("Retry wrong")').count() === 1);
await page.click('button:has-text("Done")');
await page.waitForSelector('.quiz-row-name');
check('the attempt is recorded',
  !(await page.locator('.quiz-row-meta').first().textContent()).includes('never taken'));

// ── A quiz left half-finished ─────────────────────────────────────────────
// Card reviews write on every rating; quizzes used to hold the run in the tab,
// so one Escape threw away every answered question.
await page.click('button:has-text("Start")');
await page.waitForSelector('.opt');
await page.click('.opt >> nth=0');
await page.waitForTimeout(250);
await page.keyboard.press('Enter');
await page.waitForTimeout(250);
await page.keyboard.press('Escape');
await page.waitForSelector('.quiz-row-name');
check('the list shows a half-finished run',
  (await page.locator('.quiz-row-meta').first().textContent()).includes('in progress'));

await page.click('button:has-text("Resume")');
await page.waitForSelector('.q-card');
check('resuming lands where it stopped',
  (await page.locator('.counter').textContent()).trim().startsWith('2'));

// and it is on the server, not in the tab
await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await page.click('.nav-link:has-text("Quiz")');
await page.waitForSelector('.quiz-row-name');
await page.click('button:has-text("Resume")');
await page.waitForSelector('.q-card');
check('the run survives a full page reload',
  (await page.locator('.counter').textContent()).trim().startsWith('2'));

await page.keyboard.press('Escape');
await page.waitForSelector('.quiz-row-name');
await page.click('button:has-text("Start over")');
await page.waitForSelector('.modal');
await page.click('.modal .btn-danger');
await page.waitForSelector('.q-card');
check('starting over rewinds to the first question',
  (await page.locator('.counter').textContent()).trim().startsWith('1'));
// Leaving a run in which nothing has been graded yet leaves nothing behind.
await page.keyboard.press('Escape');
await page.waitForSelector('.quiz-row-name');
check('an untouched run does not linger in the list',
  !(await page.locator('.quiz-row-meta').first().textContent()).includes('in progress'));

// ── Cards ─────────────────────────────────────────────────────────────────
await page.click('.nav-link:has-text("Cards")');
await page.waitForSelector('.card-table');
const rows = await page.locator('.card-table tbody tr').count();
check('the table lists the deck', rows === 3);
await page.fill('#card-search', 'basis');
await page.waitForTimeout(500);
check('search narrows the table', await page.locator('.card-table tbody tr').count() === 1);
await page.fill('#card-search', '');
await page.waitForTimeout(500);

await page.click('button:has-text("New card")');
await page.waitForSelector('#card-front');
await page.fill('#card-front', 'Added from the UI');
await page.fill('#card-back', 'It saved');
await page.click('.modal button:has-text("Save")');
await page.waitForTimeout(600);
check('a new card appears in the table',
  await page.locator('.card-table tbody tr').count() === rows + 1);

// ── Import ────────────────────────────────────────────────────────────────
await page.click('.nav-link:has-text("Import")');
await page.waitForSelector('#import-text');
await page.fill('#import-text', JSON.stringify({
  deck: 'Exams::TMUA',
  cards: [{ front: 'Change of base', back: '$\\log_a b = \\frac{\\log_c b}{\\log_c a}$' }, { front: 'no back here' }],
}));
await page.click('button:has-text("Validate")');
await page.waitForSelector('.preview-figures');
check('the preview counts what would be created',
  (await page.locator('.preview-figure .value').first().textContent()).trim() === '1');
check('the bad entry is reported, not fatal',
  await page.locator('.issue.error').count() === 1);
// Not `button:has-text("Import")` — that also matches the nav link.
await page.click('[data-action="commitImport"]');
await page.waitForTimeout(900);
const decksAfterImport = (await call('get_decks')).map((deck) => deck.path);
check('importing creates the new subject', decksAfterImport.includes('Exams::TMUA'));
check('importing writes only the good card',
  (await call('get_overview', ['Exams'])).total_cards === 1);

// ── Stats ─────────────────────────────────────────────────────────────────
await page.click('.nav-link:has-text("Stats")');
await page.waitForSelector('.stat-grid');
check('stats report the reviews just made',
  Number((await page.locator('.stat-tile .value').nth(1).textContent()).trim()) > 0);

// ── Settings and language ─────────────────────────────────────────────────
await page.click('.nav-link:has-text("Settings")');
await page.waitForSelector('.setting-row');
check('each subject can carry its own limits',
  await page.locator('[data-change="setDeckLimit"]').count() >= 4);
await page.selectOption('select[data-change="setLanguage"]', 'zh');
await page.waitForTimeout(600);
check('the interface switches to Chinese',
  (await page.locator('#brand').textContent()).trim() === '知识卡片');
await page.selectOption('select[data-change="setLanguage"]', 'en');
await page.waitForTimeout(600);

// ── Browse leaves the schedule alone ──────────────────────────────────────
await page.click('.nav-link:has-text("Home")');
await page.waitForSelector('.due-card');
const beforeBrowse = JSON.stringify(await call('get_overview', ['']));
await page.click('button:has-text("Browse")');
await page.waitForSelector('.card-front');
await page.keyboard.press(' ');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(300);
await page.keyboard.press('Escape');
await page.waitForSelector('.due-card');
check('browsing changes nothing', JSON.stringify(await call('get_overview', [''])) === beforeBrowse);

// ── Chrome alignment ──────────────────────────────────────────────────────
// Controls used to move sideways as you navigated: the sidebar appeared beside
// only two of six pages, the container had two different widths, and the
// scrollbar took space only on pages long enough to scroll.
const geometry = [];
for (const nav of ['Home', 'Quiz', 'Cards', 'Import', 'Stats', 'Settings']) {
  await page.click(`.nav-link:has-text("${nav}")`);
  await page.waitForSelector('h1');
  await page.waitForTimeout(200);
  geometry.push(await page.evaluate((name) => {
    const h1 = document.querySelector('h1').getBoundingClientRect();
    const content = document.getElementById('content');
    const de = document.documentElement;
    let node = document.getElementById('topbar').parentElement;
    let scrollingAncestors = 0;
    while (node) {
      if (node.scrollHeight > node.clientHeight + 1) scrollingAncestors += 1;
      node = node.parentElement;
    }
    return {
      name,
      x: Math.round(h1.left),
      y: Math.round(h1.top),
      width: Math.round(content.getBoundingClientRect().width),
      topbar: Math.round(document.getElementById('topbar').getBoundingClientRect().width),
      docScrolls: de.scrollHeight > de.clientHeight,
      paneScrolls: content.scrollHeight > content.clientHeight,
      scrollingAncestors,
    };
  }, nav));
}
const distinct = (key) => new Set(geometry.map((g) => g[key]));
check('every page puts its heading at the same x', distinct('x').size === 1);
check('every page puts its heading at the same y', distinct('y').size === 1);
check('every page has the same content width', distinct('width').size === 1);
check('the top bar is the same width on every page', distinct('topbar').size === 1);
// The chrome cannot be pushed by a scrollbar it does not live inside. Checking
// the structure rather than the pixels, because whether a scrollbar takes
// layout space depends on the platform and cannot be reproduced headless.
check('the document never scrolls', [...distinct('docScrolls')].every((v) => v === false));
check('the top bar has no scrolling ancestor',
  [...distinct('scrollingAncestors')].every((v) => v === 0));
check('a long page scrolls the content pane instead',
  geometry.some((g) => g.paneScrolls) && distinct('width').size === 1);
check('the sidebar stays mounted across the chrome',
  await page.evaluate(() => !document.getElementById('sidebar').hidden));

// Mounted everywhere is not a licence to show the same thing everywhere.
await page.click('.nav-link:has-text("Settings")');
await page.waitForSelector('.setting-row');
const settingsPanel = await page.locator('#sidebar').textContent();
check('Settings lists its own sections, not decks',
  settingsPanel.includes('Daily limits') && !settingsPanel.includes('All decks'));

await page.click('.nav-link:has-text("Quiz")');
await page.waitForSelector('.quiz-row-name');
check('Quiz lists subjects, not decks',
  (await page.locator('#sidebar').textContent()).includes('All quizzes'));

await page.click('.nav-link:has-text("Home")');
await page.waitForSelector('.due-card');
check('a deck-scoped page still lists decks',
  (await page.locator('#sidebar').textContent()).includes('All decks'));

// ── Cards: one list you keep scrolling ────────────────────────────────────
await call('import_commit', [JSON.stringify({
  deck: 'Computer Science::Bulk',
  cards: Array.from({ length: 70 }, (_, i) => ({
    id: `bulk.${i}`, front: `What is bulk term ${i}?`, back: `Answer ${i}.` })),
})]);
await page.click('.nav-link:has-text("Cards")');
await page.waitForSelector('.card-table');
// An earlier step scoped the sidebar to one chapter; the bulk deck is elsewhere.
await page.click('.deck-item:has-text("All decks")');
await page.waitForSelector('.card-table');
await page.waitForTimeout(300);
const firstPage = await page.locator('#cards-body tr').count();
check('the first slice is one page long', firstPage === 50);
check('there is no pager', await page.locator('.pager').count() === 0);
for (let i = 0; i < 4; i += 1) {
  await page.evaluate(() => {
    const pane = document.getElementById('content');
    pane.scrollTop = pane.scrollHeight;
  });
  await page.waitForTimeout(400);
}
const afterScroll = await page.locator('#cards-body tr').count();
check('scrolling appends the rest', afterScroll > firstPage);
check('the list says when it has run out',
  (await page.locator('#cards-footer').textContent()).includes('all of them'));

check('no console errors anywhere', consoleErrors.length === 0);

await browser.close();

if (failures.length || consoleErrors.length) {
  console.error(`FAIL — ${failures.length} of ${checks} checks failed`);
  failures.forEach((label) => console.error(`  ✗ ${label}`));
  consoleErrors.forEach((line) => console.error(`  ! ${line}`));
  process.exit(1);
}
console.log(`OK — ${checks} checks passed`);
