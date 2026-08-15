/* Card and question text rendering.

   A deliberately small markdown subset — paragraphs, line breaks, bullet and
   numbered lists, bold, italic, inline code — plus TeX between $…$ (inline) and
   $$…$$ (display), rendered by the bundled KaTeX.

   Math is lifted out before anything else touches the string, so a formula full
   of braces and backslashes is never mangled by the markdown pass. */

import { esc } from './dom.js';

const MATH_PATTERN = /\$\$([\s\S]+?)\$\$|\$(?!\s)([^$\n]*?[^\s$])\$/g;
const TOKEN = (i) => `KCMATH${i}`;

function renderMath(tex, displayMode) {
  if (typeof katex === 'undefined') {
    return `<code>${esc(tex)}</code>`;
  }
  try {
    return katex.renderToString(tex, { displayMode, throwOnError: false, output: 'html' });
  } catch (err) {
    return `<code>${esc(tex)}</code>`;
  }
}

function inline(text) {
  return text
    .replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');
}

function block(lines) {
  const bullets = lines.every((line) => /^\s*[-*]\s+/.test(line));
  if (bullets) {
    const items = lines.map((line) => `<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`);
    return `<ul>${items.join('')}</ul>`;
  }
  const numbered = lines.every((line) => /^\s*\d+[.)]\s+/.test(line));
  if (numbered) {
    const items = lines.map((line) => `<li>${inline(line.replace(/^\s*\d+[.)]\s+/, ''))}</li>`);
    return `<ol>${items.join('')}</ol>`;
  }
  return `<p>${lines.map(inline).join('<br>')}</p>`;
}

/** Render card text to safe HTML. Input is escaped first; only our own tags survive. */
export function rich(text) {
  const source = String(text === null || text === undefined ? '' : text);
  if (!source.trim()) return '';

  const formulas = [];
  const withTokens = source.replace(MATH_PATTERN, (match, display, inlineTex) => {
    const tex = display !== undefined ? display : inlineTex;
    formulas.push({ tex, display: display !== undefined });
    return TOKEN(formulas.length - 1);
  });

  const blocks = esc(withTokens)
    .split(/\n\s*\n/)
    .map((chunk) => chunk.split('\n').filter((line) => line.trim() !== ''))
    .filter((lines) => lines.length)
    .map(block)
    .join('');

  return blocks.replace(/KCMATH(\d+)/g, (_, index) => {
    const formula = formulas[Number(index)];
    return formula ? renderMath(formula.tex, formula.display) : '';
  });
}

/** Same rendering, wrapped so the shared `.rich` styles apply. */
export function richBlock(text, extraClass = '') {
  return `<div class="rich ${extraClass}">${rich(text)}</div>`;
}

/** Plain-text flattening for table cells and result summaries.

    Formulas are unwrapped rather than dropped — a card whose back is nothing
    but maths would otherwise preview as an empty row. */
export function plain(text) {
  return String(text || '')
    .replace(/\$\$?([\s\S]*?)\$\$?/g, ' $1 ')
    .replace(/\\operatorname\s*\{([^{}]*)\}/g, '$1')
    .replace(/\\d?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')
    .replace(/\\[a-zA-Z]+/g, (command) => command.slice(1))
    .replace(/[{}*`_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
