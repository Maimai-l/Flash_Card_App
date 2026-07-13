/* ════════════════════════════════════════════════════════════════════════
   Practice-session persistence (localStorage)
   ════════════════════════════════════════════════════════════════════════ */
import { S, store } from './state.js';
import { navigate } from './router.js';
import { startSession } from '../views/home.js';

const SESSION_STORE_KEY = 'flashcard_session_v1';

export function saveSession() {
  const PS = store.PS;
  if (!PS || !S.bookName) return;
  // Put the word currently being shown back at front so it's re-presented on continue
  const queueToSave = (PS.phase === 'practice' && PS.current)
    ? [PS.current, ...PS.queue]
    : [...PS.queue];
  try {
    localStorage.setItem(SESSION_STORE_KEY, JSON.stringify({
      bookName:    S.bookName,
      words:       PS.words,
      queue:       queueToSave,
      phase:       PS.phase,
      fcIdx:       PS.fcIdx,
      stats:       PS.stats,
      wordResults: [...PS.wordResults.entries()],
      savedAt:     Date.now(),
    }));
  } catch (_) {}
}

export function loadSession(bookName) {
  try {
    const raw = localStorage.getItem(SESSION_STORE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.bookName !== bookName) return null;
    // Expire sessions from previous calendar days
    if (new Date(data.savedAt).toLocaleDateString() !== new Date().toLocaleDateString()) {
      clearSession(); return null;
    }
    return data;
  } catch (_) { return null; }
}

export function clearSession() {
  try { localStorage.removeItem(SESSION_STORE_KEY); } catch (_) {}
}

export function continueSession() {
  const saved = loadSession(S.bookName);
  if (!saved) { startSession(); return; }
  store.PS = {
    words:       saved.words,
    queue:       saved.queue,
    phase:       saved.phase,
    fcIdx:       saved.fcIdx || 0,
    flipped:     false,
    current:     null,
    mode:        'fig',
    locked:      false,
    startTime:   0,
    stats:       saved.stats || { answers: 0, correct: 0, again: 0, hard: 0, good: 0, easy: 0 },
    wordResults: new Map(saved.wordResults || []),
    mcqType:     null,
    mcqCorrect:  null,
  };
  navigate('session');
}
