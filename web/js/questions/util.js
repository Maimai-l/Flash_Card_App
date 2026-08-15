/* Shared helpers for question types.

   Answer matching is intentionally forgiving by default: you are testing recall
   of an idea, not of punctuation. `match: "exact"` on a question turns that off
   when the exact string is the point. */

export function normalise(value, mode = 'loose') {
  const text = String(value === null || value === undefined ? '' : value).trim();
  if (mode === 'exact') return text;
  return text
    .toLowerCase()
    .replace(/[\s　]+/g, ' ')
    .replace(/[.,;:!?'"“”‘’`()[\]{}。，；：！？（）【】]/g, '')
    .trim();
}

export function matchesAny(given, accepted, mode = 'loose') {
  const target = normalise(given, mode);
  if (!target) return false;
  return accepted.some((candidate) => normalise(candidate, mode) === target);
}

/** Split cloze text into literal segments and {{blank}} placeholders. */
export function parseCloze(text) {
  const parts = [];
  const pattern = /\{\{(.+?)\}\}/gs;
  let last = 0;
  let match = pattern.exec(text);
  let index = 0;
  while (match) {
    if (match.index > last) parts.push({ literal: text.slice(last, match.index) });
    const answers = match[1].split('|').map((s) => s.trim()).filter(Boolean);
    parts.push({ blank: index++, answers: answers.length ? answers : [''] });
    last = match.index + match[0].length;
    match = pattern.exec(text);
  }
  if (last < text.length) parts.push({ literal: text.slice(last) });
  return parts;
}

export const OPTION_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
