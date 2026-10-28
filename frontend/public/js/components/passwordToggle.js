/**
 * Show / Hide control for password fields. One shared helper: every <input type="password"> on the page, including
 * fields drawn later (modals, forms), gets a small button that reveals or hides the text. The button is a real
 * <button type="button"> (keyboard and screen-reader friendly, never submits the form) and only password fields get it.
 */
const MARK = 'pwToggle';

function enhance(input) {
  if (input.dataset[MARK] || input.type !== 'password') return;
  input.dataset[MARK] = '1';
  const wrap = document.createElement('span');
  wrap.className = 'pw-wrap';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pw-toggle';
  button.textContent = 'Show';
  button.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-label', 'Show password');
  button.addEventListener('click', () => {
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    button.textContent = reveal ? 'Hide' : 'Show';
    button.setAttribute('aria-pressed', String(reveal));
    button.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
  });
  wrap.appendChild(button);
}

export function enhancePasswordFields(root = document) {
  root.querySelectorAll('input[type="password"]').forEach(enhance);
}

let watching = false;
/** Enhances the fields on the page now and every password field added later. */
export function watchPasswordFields() {
  enhancePasswordFields();
  if (watching || typeof MutationObserver === 'undefined') return;
  watching = true;
  new MutationObserver(() => enhancePasswordFields()).observe(document.body, { childList: true, subtree: true });
}
