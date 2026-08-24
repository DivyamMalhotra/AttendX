/* ===================== AttendX Teacher app ===================== */
(function () {
  const user = Auth.requireRole('teacher');
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
  function todayISO() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function boot() {
    window.addEventListener('hashchange', render);
    if (!location.hash) location.hash = '#classes';
    render();
  }

  function render() {
    const parts = (location.hash || '#classes').replace('#', '').split('/');
    const route = parts[0];
    // the session-marking screen belongs to the "My Classes" flow, so keep
    // that nav item highlighted while on it; "leaves" gets its own item
    const activeRoute = route === 'session' ? 'classes' : route;
    document.querySelectorAll('.nav-link').forEach(a => a.classList.toggle('active', a.dataset.route === activeRoute));

    if (route === 'session' && parts[1] === 'new') renderSession({ mode: 'new', subjectId: parts[2] });
    else if (route === 'session' && parts[1] === 'edit') renderSession({ mode: 'edit', sessionId: parts[2] });
    else if (route === 'leaves') renderLeaves();
    else renderClasses();
  }

  /* ================= MY CLASSES ================= */
  function renderClasses() {
    const subjects = DB.subjectsByTeacher(user.id);

    main.innerHTML = `
      <div class="page-header">
        <h1>My Classes</h1>
        <div class="sub">${esc(DB.formatDateWeekday(new Date()))}</div>
      </div>
      <div id="classList"></div>
    `;

    const list = document.getElementById('classList');
    if (!subjects.length) {
      list.innerHTML = `<div class="card empty-state">You have no classes assigned yet. Contact your HOD.</div>`;
      return;
    }

    list.innerHTML = subjects.map(sub => classCard(sub)).join('');

    list.querySelectorAll('[data-new-session]').forEach(b => b.addEventListener('click', () => {
      location.hash = `#session/new/${b.dataset.newSession}`;
    }));
    list.querySelectorAll('[data-edit-last]:not([disabled])').forEach(b => b.addEventListener('click', () => {
      location.hash = `#session/edit/${b.dataset.editLast}`;
    }));
    list.querySelectorAll('[data-edit-session]').forEach(b => b.addEventListener('click', () => {
      location.hash = `#session/edit/${b.dataset.editSession}`;
    }));
  }

  function classCard(sub) {
    const section = DB.section(sub.sectionId);
    const studentCount = DB.studentsInSection(sub.sectionId).length;
    const sessions = DB.sessionsForSubject(sub.id); // sorted desc
    const last = sessions[0];

    return `
      <div class="card class-card">
        <div class="class-card-top">
          <div class="class-title-row">
            <div class="class-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 9h18"/><path d="M9 13l2 2 4-4"/></svg>
            </div>
            <div class="class-title">
              <h3>${esc(sub.name)}</h3>
              <div class="sub">${esc(DB.sectionLabel(section))}</div>
            </div>
          </div>
          <div class="class-actions">
            <button class="btn btn-outline" data-edit-last="${last ? last.id : ''}" ${last ? '' : 'disabled'}>Edit Last</button>
            <button class="btn btn-primary" data-new-session="${sub.id}">New Session</button>
          </div>
        </div>
        <div class="class-meta">
          <span class="badge badge-gray">${studentCount} students</span>
          <span class="muted" style="font-size:13.5px;">Last: ${last ? esc(DB.formatDateLong(last.date)) : '—'}</span>
        </div>
        ${sessions.length ? `
          <div class="past-sessions">
            <div class="ps-label">Past sessions</div>
            ${sessions.map(s => pastSessionRow(s)).join('')}
          </div>` : ''}
      </div>
    `;
  }

  function pastSessionRow(session) {
    const { present, total } = DB.sessionAttendanceCount(session);
    const badge = attendanceBadge(present, total);
    return `
      <div class="ps-row">
        <span class="ps-date">${esc(DB.formatDateLong(session.date))}, ${esc(session.slot)}</span>
        <span class="ps-right">
          <span class="badge ${badge.cls}">${present}/${total}</span>
          <button class="btn-link ps-edit" data-edit-session="${session.id}">Edit</button>
        </span>
      </div>
    `;
  }

  function attendanceBadge(present, total) {
    if (total === 0) return { cls: 'badge-gray' };
    const pct = present / total;
    if (pct === 1) return { cls: 'badge-green' };
    if (pct >= 0.75) return { cls: 'badge-blue' };
    return { cls: 'badge-red' };
  }

  /* ================= SESSION MARKING ================= */
  function renderSession({ mode, subjectId, sessionId }) {
    let session = null, subject, section, students, dateVal, slotVal, attendance;

    if (mode === 'edit') {
      session = DB.getSessions().find(s => s.id === sessionId);
      if (!session) { location.hash = '#classes'; return; }
      subject = DB.subject(session.subjectId);
      section = DB.section(session.sectionId);
      dateVal = session.date;
      slotVal = session.slot;
      attendance = Object.assign({}, session.attendance);
    } else {
      subject = DB.subject(subjectId);
      if (!subject) { location.hash = '#classes'; return; }
      section = DB.section(subject.sectionId);
      dateVal = todayISO();
      slotVal = DB.TIME_SLOTS[1];
      attendance = {};
    }
    students = DB.studentsInSection(section.id);

    main.innerHTML = `
      <a href="#classes" class="back-link">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
        Back
      </a>
      <div class="page-header" style="margin-bottom:18px;">
        <h1>${esc(subject.name)}</h1>
        <div class="sub">${esc(DB.sectionLabel(section))}</div>
      </div>

      <div class="card session-card">
        <h4>Session Schedule</h4>
        <div class="field-row">
          <div class="field">
            <label>Date</label>
            <input type="date" id="sessDate" value="${esc(dateVal)}">
          </div>
          <div class="field">
            <label>Time Slot</label>
            <select id="sessSlot">
              ${DB.TIME_SLOTS.map(t => `<option value="${esc(t)}" ${t === slotVal ? 'selected' : ''}>${esc(t)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="session-summary" id="sessSummary"></div>
      </div>

      <div class="card stat-strip">
        <div class="counts">
          <div><div class="num present" id="cntPresent">0</div><div class="lbl">Present</div></div>
          <div><div class="num absent" id="cntAbsent">0</div><div class="lbl">Absent</div></div>
          <div><div class="num unmarked" id="cntUnmarked">0</div><div class="lbl">Unmarked</div></div>
        </div>
        <div class="flex-center gap-10">
          <button class="btn btn-success-soft" id="allPresentBtn">All Present</button>
          <button class="btn btn-danger-soft" id="allAbsentBtn">All Absent</button>
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead><tr><th>Roll No</th><th>Name</th><th style="width:60px;">P</th><th style="width:60px;">A</th></tr></thead>
          <tbody id="studentRows"></tbody>
        </table>
      </div>

      <div class="submit-row">
        <button class="btn btn-primary" id="submitBtn" style="padding:11px 26px;">Submit Attendance</button>
      </div>
    `;

    const dateInput = document.getElementById('sessDate');
    const slotSelect = document.getElementById('sessSlot');
    const summaryEl = document.getElementById('sessSummary');
    const tbody = document.getElementById('studentRows');

    function updateSummary() {
      const d = dateInput.value ? DB.formatDateLong(dateInput.value) : '—';
      summaryEl.textContent = `Session: ${d} · ${slotSelect.value}`;
    }
    dateInput.addEventListener('change', updateSummary);
    slotSelect.addEventListener('change', updateSummary);
    updateSummary();

    function paintRows() {
      tbody.innerHTML = students.map(st => {
        const status = attendance[st.id];
        const rowClass = status === 'P' ? 'row-present' : status === 'A' ? 'row-absent' : '';
        return `
          <tr class="${rowClass}">
            <td class="roll">${esc(st.rollNo)}</td>
            <td class="cell-strong">${esc(st.name)}</td>
            <td>
              <button class="pa-btn p-btn ${status === 'P' ? 'active' : ''}" data-p="${st.id}" title="Present">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
              </button>
            </td>
            <td>
              <button class="pa-btn a-btn ${status === 'A' ? 'active' : ''}" data-a="${st.id}" title="Absent">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </td>
          </tr>
        `;
      }).join('');

      tbody.querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.p;
        attendance[id] = attendance[id] === 'P' ? undefined : 'P';
        if (attendance[id] === undefined) delete attendance[id];
        refresh();
      }));
      tbody.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.a;
        attendance[id] = attendance[id] === 'A' ? undefined : 'A';
        if (attendance[id] === undefined) delete attendance[id];
        refresh();
      }));
    }

    function updateCounts() {
      let present = 0, absent = 0;
      students.forEach(st => {
        if (attendance[st.id] === 'P') present++;
        else if (attendance[st.id] === 'A') absent++;
      });
      const unmarked = students.length - present - absent;
      document.getElementById('cntPresent').textContent = present;
      document.getElementById('cntAbsent').textContent = absent;
      document.getElementById('cntUnmarked').textContent = unmarked;
      document.getElementById('submitBtn').disabled = unmarked > 0;
    }

    function refresh() {
      paintRows();
      updateCounts();
    }
    refresh();

    document.getElementById('allPresentBtn').addEventListener('click', () => {
      students.forEach(st => attendance[st.id] = 'P');
      refresh();
    });
    document.getElementById('allAbsentBtn').addEventListener('click', () => {
      students.forEach(st => attendance[st.id] = 'A');
      refresh();
    });

    document.getElementById('submitBtn').addEventListener('click', () => {
      const unmarked = students.length - Object.keys(attendance).length;
      if (unmarked > 0) { showToast('Mark every student before submitting.'); return; }
      const date = dateInput.value;
      const slot = slotSelect.value;
      if (!date) { showToast('Please choose a date.'); return; }

      const sessions = DB.getSessions();
      if (mode === 'edit') {
        const s = sessions.find(s => s.id === session.id);
        s.date = date; s.slot = slot; s.attendance = Object.assign({}, attendance);
      } else {
        sessions.push({
          id: DB.uid('sess'),
          subjectId: subject.id,
          sectionId: section.id,
          teacherId: user.id,
          date, slot,
          attendance: Object.assign({}, attendance)
        });
      }
      DB.saveSessions(sessions);

      let present = 0, absent = 0;
      students.forEach(st => attendance[st.id] === 'P' ? present++ : absent++);
      renderConfirmation(present, absent);
    });
  }

  function renderConfirmation(present, absent) {
    main.innerHTML = `
      <div class="confirm-screen">
        <div class="confirm-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <h2>Attendance submitted</h2>
        <p>${present} present, ${absent} absent</p>
        <a href="#classes" class="btn-link" style="font-size:14.5px;">Back to Home</a>
      </div>
    `;
  }

  /* ================= LEAVE REQUESTS (mentor only) ================= */
  function renderLeaves() {
    // a teacher is only a mentor if some section's mentorId points at them
    const mentoredSections = DB.getSections().filter(s => s.mentorId === user.id);

    main.innerHTML = `
      <div class="page-header">
        <h1>Leave Requests</h1>
        <div class="sub">${mentoredSections.length
          ? 'Requests from students in the section(s) you mentor'
          : 'You are not set as a mentor for any section yet'}</div>
      </div>
      <div id="leaveList"></div>
    `;

    if (!mentoredSections.length) {
      document.getElementById('leaveList').innerHTML = `
        <div class="card empty-state">Ask your HOD to set you as the mentor for a section — mentors are the ones who approve or decline their students' leave requests.</div>
      `;
      return;
    }

    paintLeaveList();

    function paintLeaveList() {
      const listEl = document.getElementById('leaveList');
      const requests = DB.leaveRequestsForMentor(user.id);

      if (!requests.length) {
        listEl.innerHTML = `<div class="card empty-state">No leave requests yet.</div>`;
        return;
      }

      listEl.innerHTML = requests.map(r => leaveRow(r)).join('');

      listEl.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', () => {
        respondToLeave(b.dataset.approve, 'approved');
      }));
      listEl.querySelectorAll('[data-decline]').forEach(b => b.addEventListener('click', () => {
        respondToLeave(b.dataset.decline, 'declined');
      }));
    }

    function respondToLeave(requestId, status) {
      const requests = DB.getLeaveRequests();
      const req = requests.find(r => r.id === requestId);
      if (!req) return;
      req.status = status;
      req.respondedAt = Date.now();
      DB.saveLeaveRequests(requests);
      showToast('Leave request ' + status + '.');
      paintLeaveList();
    }
  }

  function leaveRow(req) {
    const student = DB.student(req.studentId);
    const statusBadge = req.status === 'approved' ? 'badge-green'
      : req.status === 'declined' ? 'badge-red' : 'badge-gray';

    return `
      <div class="card" style="padding:16px 22px; margin-bottom:12px;">
        <div class="flex-between">
          <div>
            <div style="font-weight:700;">${esc(student ? student.name : 'Unknown student')}</div>
            <div class="muted" style="font-size:13.5px; margin-top:2px;">${esc(student ? student.rollNo : '')} · ${esc(req.fromDate)} to ${esc(req.toDate)}</div>
          </div>
          <span class="badge ${statusBadge}">${req.status}</span>
        </div>
        <div style="margin-top:10px; font-size:13.5px;">${esc(req.reason)}</div>
        ${req.status === 'pending' ? `
          <div class="flex-center gap-10" style="margin-top:14px;">
            <button class="btn btn-success-soft btn-sm" data-approve="${req.id}">Approve</button>
            <button class="btn btn-danger-soft btn-sm" data-decline="${req.id}">Decline</button>
          </div>` : ''}
      </div>
    `;
  }

  boot();
})();