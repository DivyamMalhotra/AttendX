import { api } from '../../api/client.js';

// The token travels in the URL fragment, which browsers never send to servers. Remove it from the address bar
// straight away so it does not linger in history or screenshots.
const token = new URLSearchParams(location.hash.slice(1)).get('token');
history.replaceState(null, '', location.pathname);

const form = document.getElementById('resetForm');
const errorBox = document.getElementById('msgError');
const button = document.getElementById('saveBtn');
const fail = message => { errorBox.textContent = message; errorBox.classList.add('show'); };

if (!token) { fail('This reset link is incomplete. Request a new one from the sign-in page.'); form.classList.add('hidden'); }

form.addEventListener('submit', async event => {
  event.preventDefault();
  errorBox.classList.remove('show');
  const a = document.getElementById('pw1').value; const b = document.getElementById('pw2').value;
  if (a !== b) return fail('The two passwords do not match.');
  button.disabled = true;
  try {
    await api.post('/api/auth/reset-password', { token, newPassword: a });
    location.replace('login.html?reset=1');
  } catch (err) {
    fail(err.code === 'INVALID_RESET_TOKEN' ? 'This link is invalid or has expired. Request a new one.' : err.message);
    button.disabled = false;
  }
});
