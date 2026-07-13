/* ════════════════════════════════════════════════════════════════════════
   Shared application state
   ════════════════════════════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────────────────────────────
// S is a const object mutated in place (S.page=…, Object.assign(S, params)).
export const S = {
  history:  [],      // page stack for back navigation
  page:     'home',
  bookName: null,    // currently selected book
  calMonth: null,    // {year, month} for calendar display
  debug:    false,   // debug mode toggle
};

// Practice sub-state (reset each session). PS is reassigned, so it lives on a
// mutable holder: use store.PS everywhere.
export const store = { PS: null };
