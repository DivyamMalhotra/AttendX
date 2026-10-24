import { registerServiceWorker } from '../../services/pwa.js';
registerServiceWorker();
import { authApi } from '../../api/endpoints.js';
import { dashboardFor } from '../../services/app.js';
import { getCollegeCode, clearCollegeCode } from '../../utils/store.js';

const code = getCollegeCode();
if (!code) location.replace('index.html');

const form = document.getElementById('loginForm');
const errorBox = document.getElementById('loginError');
const button = document.getElementById('signInBtn');
const sub = document.getElementById('collegeSub');

const showError = message => { errorBox.textContent = message; errorBox.classList.add('show'); };

authApi.me().then(data => { location.replace(dashboardFor(data.user.role)); }).catch(() => {});
authApi.college(code).then(c => { sub.textContent = `Sign in to ${c.name}`; }).catch(() => { clearCollegeCode(); location.replace('index.html'); });

if (new URLSearchParams(location.search).has('reset')) document.getElementById('resetDone').classList.remove('hidden');
if (new URLSearchParams(location.search).has('expired')) showError('Your session ended. Please sign in again.');

form.addEventListener('submit', async event => {
  event.preventDefault();
  errorBox.classList.remove('show');
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  if (!email || !password) { showError('Enter your email and password.'); return; }
  button.disabled = true;
  button.innerHTML = '<span class="spinner"></span>';
  try {
    const data = await authApi.login({ collegeCode: code, email, password });
    location.replace(dashboardFor(data.user.role));
  } catch (err) {
    showError(err.status === 401 ? 'Invalid email or password.' : err.message);
    button.disabled = false;
    button.textContent = 'Sign in';
  }
});

document.getElementById('changeCollegeBtn').addEventListener('click', () => {
  clearCollegeCode();
  location.href = 'index.html';
});
