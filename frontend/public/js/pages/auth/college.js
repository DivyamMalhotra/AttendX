import { registerServiceWorker } from '../../services/pwa.js';
registerServiceWorker();
import { authApi } from '../../api/endpoints.js';
import { dashboardFor } from '../../services/app.js';
import { setCollegeCode, getCollegeCode } from '../../utils/store.js';

const form = document.getElementById('collegeForm');
const input = document.getElementById('collegeCode');
const errorBox = document.getElementById('collegeError');
const button = document.getElementById('continueBtn');

// Already signed in? Go straight to the right dashboard.
authApi.me().then(data => { location.replace(dashboardFor(data.user.role)); }).catch(() => {});
input.value = getCollegeCode();

form.addEventListener('submit', async event => {
  event.preventDefault();
  const code = input.value.trim().toUpperCase();
  errorBox.classList.remove('show');
  if (!code) { errorBox.textContent = 'Enter your college code.'; errorBox.classList.add('show'); return; }
  button.disabled = true;
  try {
    await authApi.college(code);
    setCollegeCode(code);
    location.href = 'login.html';
  } catch (err) {
    errorBox.textContent = err.status === 404 ? 'College code not recognized.' : err.message;
    errorBox.classList.add('show');
    button.disabled = false;
  }
});
