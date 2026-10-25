import { api } from '../../api/client.js';
import { getCollegeCode } from '../../utils/store.js';

const form = document.getElementById('forgotForm');
const errorBox = document.getElementById('msgError');
const done = document.getElementById('msgDone');
const button = document.getElementById('sendBtn');

const code = getCollegeCode();
if (!code) location.replace('index.html');

form.addEventListener('submit', async event => {
  event.preventDefault();
  errorBox.classList.remove('show');
  const email = document.getElementById('email').value.trim();
  if (!email) { errorBox.textContent = 'Enter your email address.'; errorBox.classList.add('show'); return; }
  button.disabled = true;
  try {
    await api.post('/api/auth/forgot-password', { collegeCode: code, email });
    // The same answer is shown whether or not the address is registered.
    form.classList.add('hidden');
    done.classList.remove('hidden');
  } catch (err) {
    errorBox.textContent = err.status === 429 ? 'Too many requests. Please try again later.' : err.message;
    errorBox.classList.add('show');
    button.disabled = false;
  }
});
