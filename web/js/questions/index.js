/* Question type registry.

   Adding a type is one file plus one line here. Every type implements:

     autoSubmit(question)        submit as soon as an answer is picked?
     initialResponse(question)   the blank response to start from
     render(question, state)     HTML for the answer area, prompt excluded
     mount(root, q, state, ctx)  wire up inputs; ctx = {setResponse, submit}
     canSubmit(question, state)  is there enough of an answer to grade?
     grade(question, response)   true / false
     summary(question, response) {given, correct} for the results page
     onKey(event, ...)           optional; return true if the key was handled
     label(question)             optional; short text for the results list

   An imported question whose type is not listed here is dropped at import time
   with a warning, so nothing here has to handle an unknown type at runtime. */

import mcq from './mcq.js';
import cloze from './cloze.js';
import short from './short.js';
import ordering from './ordering.js';

const TYPES = { mcq, cloze, short, ordering };

export function questionType(name) {
  return TYPES[name] || null;
}

/* The prompt is drawn by the runner, above the answer area, so every question
   type gets the same heading treatment and none of them repeats it. */
export function questionPrompt(question) {
  if (question.prompt) return question.prompt;
  return question.type === 'cloze' ? '' : (question.text || '');
}

export function questionLabel(question) {
  const type = questionType(question.type);
  if (type && type.label) return type.label(question);
  return question.prompt || question.text || '';
}

export const SUPPORTED_TYPES = Object.keys(TYPES);
