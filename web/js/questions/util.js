/* Shared helpers for question types.

   Answer matching is intentionally forgiving by default: you are testing recall
   of an idea, not of punctuation. `match: "exact"` on a question turns that off
   when the exact string is the point. */

/* Sentinel for a decimal point while the punctuation sweep runs. A real answer
   cannot contain it: there is no way to type NUL into a text input. */
const DECIMAL = '\u0000';

export function normalise(value, mode = 'loose') {
  const text = String(value === null || value === undefined ? '' : value).trim();
  if (mode === 'exact') return text;
  return text
    .toLowerCase()
    .replace(/[\s　]+/g, ' ')
    // ".5" and "0.5" are the same number written two ways.
    .replace(/(^|[\s(])\.(\d)/g, '$10.$2')
    // A decimal point is part of the number, not punctuation. Sweeping it away
    // with the full stops turned 1.5 into 15, so answering 15 was marked
    // correct. The thousands comma is swept, deliberately: 1,024 and 1024 are
    // the same answer, and decimal commas are not a convention this app sees.
    .replace(/(\d)\.(\d)/g, `$1${DECIMAL}$2`)
    .replace(/[.,;:!?'"“”‘’`()[\]{}。，；：！？（）【】]/g, '')
    .split(DECIMAL).join('.')
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
