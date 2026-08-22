/* Shared UI state. Only the few things worth surviving a reload are persisted;
   everything else is rebuilt from the server on each render. */

const PREFS_KEY = 'kc.prefs';

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch (err) {
    return {};
  }
}

const prefs = loadPrefs();

export const S = {
  page: 'home',
  deck: prefs.deck || '',
  lang: prefs.lang || 'en',
  collapsed: new Set(prefs.collapsed || []),
  settings: {},
  decks: [],
  version: '',

  // Transient per-view state. Views own their own slot and clear it on exit.
  session: null,
  browse: null,
  quiz: null,
  quizStart: null,
  cardsView: null,
  importView: null,
  quizSubjects: [],
  quizSubject: null,
};

export function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      deck: S.deck,
      lang: S.lang,
      collapsed: [...S.collapsed],
    }));
  } catch (err) {
    /* private mode or a full quota: preferences just won't stick */
  }
}
