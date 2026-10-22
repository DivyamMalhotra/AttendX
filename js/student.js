/* ===================== AttendX Student app ===================== */
(function () {
  const user = Auth.requireRole('student');
  if (!user) { /* redirected to login/other dashboard by requireRole */ return; }
  Auth.wireSignOut(user);

  const main = document.getElementById('mainContent');
  const toastEl = document.getElementById('toast');
  let toastTimer = null;

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }
  function esc(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function boot() {
    window.addEventListener('hashchange', render);
    if (!location.hash) location.hash = '#attendance';
    render();
  }

  function render() {
    const route = (location.hash || '#attendance').replace('#', '');
    document.querySelectorAll('.nav-link').forEach(a => a.classList.toggle('active', a.dataset.route === route));

    if (route === 'leaves') renderLeaves();
    else renderAttendance();
  }

  /* ================= MY ATTENDANCE ================= */
  function renderAttendance() {
    const section = DB.section(user.sectionId);
    const breakdown = DB.studentAttendanceBySubject(user.id, user.sectionId);
    const approvedLeaves = DB.leaveRequestsForStudent(user.id).filter(r => r.status === 'approved').length;

    // roll every subject's present/total together for one overall percentage
    let overallPresent = 0, overallTotal = 0;
    breakdown.forEach(row => { overallPresent += row.present; overallTotal += row.total; });
    const overallPct = overallTotal === 0 ? null : Math.round((overallPresent / overallTotal) * 100);
    const requiredPct = 75;
    const maxBunkable = overallTotal === 0
      ? 0
      : Math.max(0, Math.floor((overallPresent * 100) / requiredPct - overallTotal));

    main.innerHTML = `
      <div class="page-header">
        <h1>My Attendance</h1>
        <div class="sub">${esc(user.rollNo)} · ${esc(DB.sectionLabel(section))}</div>
      </div>

      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Overall Attendance</div>
          <div class="stat-value" style="color:${overallPct === null ? 'inherit' : overallPct < 75 ? 'var(--red)' : 'var(--green)'};">
            ${overallPct === null ? '—' : overallPct + '%'}
          </div>
          <div class="stat-hint">${overallTotal} session${overallTotal === 1 ? '' : 's'} recorded</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Classes Summary</div>
          <div class="stat-value" style="font-size:19px;">${overallPresent}/${overallTotal}</div>
          <div class="stat-hint">Attended / Total classes</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Can Bunk (75% rule)</div>
          <div class="stat-value" style="color:${overallPct !== null && overallPct < requiredPct ? 'var(--red)' : 'inherit'};">
            ${maxBunkable}
          </div>
          <div class="stat-hint">${overallPct !== null && overallPct < requiredPct ? 'Below 75%: no bunk allowed' : 'Without dropping below 75%'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Leaves Approved</div>
          <div class="stat-value" style="font-size:29px;">${approvedLeaves}</div>
          <div class="stat-hint">Approved leave requests</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Section</div>
          <div class="stat-value" style="font-size:19px;">${esc(section ? section.name : '—')}</div>
          <div class="stat-hint">${esc(section ? section.sem : '')}</div>
        </div>
      </div>

      <div class="card">
        <div style="padding:18px 22px; border-bottom:1px solid var(--border); font-weight:700;">By Subject</div>
        <div id="subjectBreakdown"></div>
      </div>
    `;

    const listEl = document.getElementById('subjectBreakdown');
    if (!breakdown.length) {
      listEl.innerHTML = `<div class="empty-state">No subjects have been set up for your section yet.</div>`;
      return;
    }

    listEl.innerHTML = breakdown.map(row => {
      const pct = row.pct;
      const pctClass = pct === null ? '' : pct === 100 ? 'green' : pct < 60 ? 'red' : 'blue';
      const pctHtml = pct === null
        ? `<span class="faint" style="font-size:13.5px;">No sessions yet</span>`
        : `<div class="progress-wrap">
             <div class="progress-track"><div class="progress-fill ${pctClass}" style="width:${pct}%;"></div></div>
             <span class="progress-pct">${pct}%</span>
           </div>`;
      return `
        <div class="flex-between" style="padding:16px 22px; border-bottom:1px solid #f1f2f4;">
          <div>
            <div style="font-weight:600;">${esc(row.subject.name)}</div>
            <div class="muted" style="font-size:13.5px; margin-top:2px;">${row.teacher ? esc(row.teacher.name) : 'Unassigned'} · ${row.present}/${row.total} present</div>
          </div>
          <div style="width:160px;">${pctHtml}</div>
        </div>
      `;
    }).join('');
  }

  /* ================= LEAVE REQUESTS ================= */
  function renderLeaves() {
    const mentor = DB.mentorOfSection(user.sectionId);

    main.innerHTML = `
      <div class="page-header-row">
        <div>
          <h1 style="margin-bottom:4px;">Leave Requests</h1>
          <div class="sub">${mentor ? 'Reviewed by your mentor, ' + esc(mentor.name) : 'No mentor has been assigned to your section yet'}</div>
        </div>
        <button class="btn btn-primary" id="newLeaveBtn" ${mentor ? '' : 'disabled title="No mentor assigned yet"'}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Request Leave
        </button>
      </div>
      <div id="myLeaveList"></div>
    `;

    if (mentor) {
      document.getElementById('newLeaveBtn').addEventListener('click', () => openLeaveModal(mentor));
    }

    paintMyLeaves();

    function paintMyLeaves() {
      const listEl = document.getElementById('myLeaveList');
      const requests = DB.leaveRequestsForStudent(user.id);

      if (!requests.length) {
        listEl.innerHTML = `<div class="card empty-state">You haven't requested any leave yet.</div>`;
        return;
      }

      listEl.innerHTML = requests.map(r => {
        const statusBadge = r.status === 'approved' ? 'badge-green'
          : r.status === 'declined' ? 'badge-red'
          : r.status === 'cancelled' ? 'badge-gray'
          : 'badge-gray';
        return `
          <div class="card" style="padding:16px 22px; margin-bottom:12px;">
            <div class="flex-between">
              <div>
                <div style="font-weight:700;">${esc(r.fromDate)} to ${esc(r.toDate)}</div>
                <div class="muted" style="font-size:13.5px; margin-top:2px;">${esc(r.reason)}</div>
              </div>
              <span class="badge ${statusBadge}">${r.status}</span>
            </div>
            ${r.status === 'pending' ? `
              <div style="margin-top:12px;">
                <button class="btn btn-ghost btn-sm" data-cancel-leave="${r.id}">Cancel Request</button>
              </div>` : ''}
          </div>
        `;
      }).join('');

      listEl.querySelectorAll('[data-cancel-leave]').forEach(b => b.addEventListener('click', () => {
        if (!confirm('Cancel this leave request?')) return;
        const requests = DB.getLeaveRequests();
        const req = requests.find(r => r.id === b.dataset.cancelLeave);
        if (!req) return;
        req.status = 'cancelled';
        req.respondedAt = Date.now();
        DB.saveLeaveRequests(requests);
        showToast('Leave request cancelled.');
        paintMyLeaves();
      }));
    }

    function openLeaveModal(mentor) {
      openModal({
        title: 'Request Leave',
        bodyHtml: `
          <div class="field-hint" style="margin-bottom:14px;">This request goes to your mentor, ${esc(mentor.name)}.</div>
          <div class="field-row">
            <div class="field"><label>From</label><input type="date" id="lvFrom"></div>
            <div class="field"><label>To</label><input type="date" id="lvTo"></div>
          </div>
          <div class="field"><label>Reason</label><input type="text" id="lvReason" placeholder="e.g. Medical appointment"></div>
        `,
        confirmText: 'Submit Request',
        onConfirm: () => {
          const fromDate = document.getElementById('lvFrom').value;
          const toDate = document.getElementById('lvTo').value;
          const reason = document.getElementById('lvReason').value.trim();

          if (!fromDate || !toDate || !reason) { showToast('Please fill in all fields.'); return false; }
          if (toDate < fromDate) { showToast('"To" date cannot be before "From" date.'); return false; }

          // block a duplicate/overlapping request — only "pending" and
          // "approved" requests count as active; declined/cancelled ones
          // don't block a fresh request for the same dates
          const activeRequests = DB.leaveRequestsForStudent(user.id)
            .filter(r => r.status === 'pending' || r.status === 'approved');
          const overlaps = activeRequests.some(r => fromDate <= r.toDate && toDate >= r.fromDate);
          if (overlaps) {
            showToast('You already have a leave request covering some of these dates.');
            return false;
          }

          const requests = DB.getLeaveRequests();
          requests.push({
            id: DB.uid('lv'),
            studentId: user.id,
            sectionId: user.sectionId,
            mentorId: mentor.id,
            collegeId: user.collegeId,
            fromDate, toDate, reason,
            status: 'pending',
            requestedAt: Date.now(),
            respondedAt: null
          });
          DB.saveLeaveRequests(requests);
          showToast('Leave request sent to ' + mentor.name + '.');
          paintMyLeaves();
          return true;
        }
      });
    }
  }

  /* ================= modal helper (same pattern as hod.js) ================= */
  function openModal({ title, bodyHtml, confirmText, onConfirm }) {
    let overlay = document.getElementById('appModal');
    if (overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'appModal';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>${esc(title)}</h3>
          <button class="modal-close" id="modalCloseBtn">&times;</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="modalCancelBtn">Cancel</button>
          <button class="btn btn-primary" id="modalConfirmBtn">${esc(confirmText)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.getElementById('modalCloseBtn').addEventListener('click', close);
    document.getElementById('modalCancelBtn').addEventListener('click', close);
    document.getElementById('modalConfirmBtn').addEventListener('click', () => {
      const ok = onConfirm();
      if (ok !== false) close();
    });
  }

  boot();
})();