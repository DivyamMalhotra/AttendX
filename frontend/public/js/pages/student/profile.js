import { html, mount, $ } from '../../utils/dom.js';
import { studentApi, authApi } from '../../api/endpoints.js';
import { pageHeader } from '../../components/ui.js';
import { readForm, requireFields, applyFieldErrors, clearFieldErrors } from '../../components/forms.js';
import { toast } from '../../components/toast.js';

export default async function render({ view, ctx }) {
  const p = await studentApi.profile();

  mount(view, html`
    ${pageHeader('Profile', 'Your details as recorded by the college')}
    <div class="grid-2">
      <div class="card card-pad">
        <h3 class="card-section-label">Student details</h3>
        <dl class="kv">
          <dt>Name</dt><dd>${p.name}</dd><dt>Email</dt><dd>${p.email}</dd><dt>Roll number</dt><dd>${p.rollNo}</dd>
          <dt>Course</dt><dd>${[p.section?.course, p.section?.specialization].filter(Boolean).join(' — ') || '—'}</dd>
          <dt>Section</dt><dd>${p.section ? `${p.section.name} · ${p.section.sem}` : '—'}</dd>
          <dt>Mentor</dt><dd>${p.mentor || 'Not assigned'}</dd>
        </dl>
        <p class="small faint mt-16">Your name, roll number and section are managed by the college office.</p>
        <form id="profileForm" class="mt-16" novalidate>
          <div class="field"><label for="phone">Phone number</label><input id="phone" name="phone" type="tel" value="${p.phone}" maxlength="20" autocomplete="tel"></div>
          <button type="submit" class="btn btn-primary">Save phone number</button>
        </form>
      </div>
      <div class="card card-pad">
        <h3 class="card-section-label">Change password</h3>
        <form id="pwForm" novalidate>
          <div class="field"><label for="cur">Current password</label><input id="cur" name="currentPassword" type="password" autocomplete="current-password"></div>
          <div class="field"><label for="new">New password</label><input id="new" name="newPassword" type="password" autocomplete="new-password">
            <div class="field-hint">At least 8 characters, with letters and a number.</div></div>
          <div class="field"><label for="rep">Repeat new password</label><input id="rep" name="repeat" type="password" autocomplete="new-password"></div>
          <div class="field-error hidden" id="pwError" role="alert"></div>
          <button type="submit" class="btn btn-primary">Update password</button>
        </form>
      </div>
    </div>`);

  $('#profileForm', view).addEventListener('submit', async e => {
    e.preventDefault();
    clearFieldErrors(view);
    try { await studentApi.updateProfile({ phone: readForm(e.target).phone }); toast('Profile updated.', 'success'); }
    catch (err) { toast(err.message, 'error'); applyFieldErrors(e.target, err.details); }
  });

  $('#pwForm', view).addEventListener('submit', async e => {
    e.preventDefault();
    const box = $('#pwError', view);
    const show = m => { box.textContent = m; box.classList.toggle('hidden', !m); };
    show('');
    const v = readForm(e.target);
    const missing = requireFields(e.target, ['currentPassword', 'newPassword', 'repeat']);
    if (missing) return show(missing);
    if (v.newPassword !== v.repeat) return show('The new passwords do not match.');
    try {
      await authApi.changePassword({ currentPassword: v.currentPassword, newPassword: v.newPassword });
      e.target.reset();
      toast('Password updated. Other devices have been signed out.', 'success');
    } catch (err) { show(err.message); }
  });
}
