/* Handing data to an AI.

   The app does not explain, coach or generate; the conversation does. What the
   app owes that conversation is a block it can read cold: one plain sentence of
   framing, then versioned JSON. No instructions to the model ride along, and
   what to do with it is decided by whoever pastes it. */

import { showToast, showModal, esc } from './dom.js';
import { t } from './i18n.js';

export async function copyForAI(intro, payload) {
  const text = `${intro}\n\n\`\`\`json\n${JSON.stringify(payload, null, 1)}\n\`\`\`\n`;
  try {
    await navigator.clipboard.writeText(text);
    showToast(t('copied_for_ai'), 2400);
  } catch (err) {
    showModal(`<h2>${esc(t('copy_for_ai'))}</h2>
      <textarea class="textarea code" style="min-height:280px">${esc(text)}</textarea>
      <div class="modal-actions">
        <button class="btn btn-quiet btn-sm" data-action="closeModal">${esc(t('close'))}</button>
      </div>`);
  }
}
