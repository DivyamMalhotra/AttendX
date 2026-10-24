import { html, mount, $, $$ } from '../utils/dom.js';
import { ApiError } from '../api/client.js';
import { applyFieldErrors, clearFieldErrors } from './forms.js';

/**
 * Accessible modal dialog.
 *  onConfirm(el) may be async; return false (or throw) to keep the dialog open.
 *  An ApiError thrown inside is shown in the dialog and mapped onto form fields.
 */
export function openModal({ title, body, confirmText = 'Save', cancelText = 'Cancel', onConfirm, wide = false, footer = true, dismissable = true, onOpen }) {
  const previouslyFocused = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  mount(overlay, html`
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <div class="modal-header">
        <h3 id="modalTitle">${title}</h3>
        ${dismissable ? html`<button type="button" class="modal-close" data-close aria-label="Close dialog">&times;</button>` : ''}
      </div>
      <div class="modal-body">${body}<div class="field-error modal-error" role="alert" hidden></div></div>
      ${footer ? html`<div class="modal-footer">
        ${dismissable ? html`<button type="button" class="btn btn-ghost" data-close>${cancelText}</button>` : ''}
        ${onConfirm ? html`<button type="button" class="btn btn-primary" data-confirm>${confirmText}</button>` : ''}
      </div>` : ''}
    </div>`);
  document.body.appendChild(overlay);
  const dialog = $('.modal', overlay);
  const errorBox = $('.modal-error', overlay);

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
  };
  const focusables = () => $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', dialog).filter(e => !e.disabled && !e.hidden);
  function onKey(e) {
    if (e.key === 'Escape' && dismissable) close();
    if (e.key === 'Tab') {
      const items = focusables();
      if (!items.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', e => { if (e.target === overlay && dismissable) close(); });
  $$('[data-close]', overlay).forEach(b => b.addEventListener('click', close));

  const showError = message => { errorBox.textContent = message; errorBox.hidden = !message; };
  const confirmBtn = $('[data-confirm]', overlay);

  async function confirm() {
    showError('');
    clearFieldErrors(dialog);
    confirmBtn.disabled = true;
    const label = confirmBtn.textContent;
    confirmBtn.innerHTML = '<span class="spinner"></span>';
    try {
      const result = await onConfirm(dialog, { showError, close });
      if (result !== false) close();
    } catch (err) {
      if (err instanceof ApiError) {
        showError(err.message);
        applyFieldErrors(dialog, err.details);
      } else {
        showError('Something went wrong. Please try again.');
        console.error(err);
      }
    } finally {
      if (document.body.contains(overlay)) { confirmBtn.disabled = false; confirmBtn.textContent = label; }
    }
  }
  if (confirmBtn) confirmBtn.addEventListener('click', confirm);
  dialog.addEventListener('submit', e => { e.preventDefault(); if (confirmBtn) confirm(); });

  (focusables().find(e => e.matches('input, select, textarea')) || focusables()[0])?.focus();
  if (onOpen) onOpen(dialog, { close, showError });
  return { close, el: dialog, showError };
}

/** Promise based confirmation prompt. Resolves true when confirmed. */
export function confirmDialog({ title = 'Please confirm', message, confirmText = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    let settled = false;
    const done = value => { if (!settled) { settled = true; resolve(value); } };
    const modal = openModal({
      title, body: html`<p style="margin:0">${message}</p>`, confirmText,
      onConfirm: () => { done(true); }
    });
    if (danger) modal.el.querySelector('[data-confirm]').classList.replace('btn-primary', 'btn-danger-soft');
    const observer = new MutationObserver(() => { if (!document.body.contains(modal.el)) { done(false); observer.disconnect(); } });
    observer.observe(document.body, { childList: true });
  });
}
