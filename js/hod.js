/* ===================== AttendX HOD app ===================== */
(function () {
  const user = Auth.requireRole('hod');
  if (!user) { /* redirected to login/other dashboard by requireRole */ return; }
  Auth.wireSignOut(user);

  const main = document.getElementById('mainContent');
  const toastEl = document.getElementById('toast');
  let toastTimer = null;

  // transient UI state (not persisted)
  const ui = {
    editingSectionId: null,
    expandedSectionId: null,
    creatingSection: false
  };

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  function esc(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------------- routing ---------------- */
  function boot() {
    window.addEventListener('hashchange', render);
    if (!location.hash) location.hash = '#overview';
    render();
  }

  function currentRoute() {
    return (location.hash || '#overview').replace('#', '');
  }

  function render() {
    const route = currentRoute();
    document.querySelectorAll('.nav-link').forEach(a => {
      a.classList.toggle('active', a.dataset.route === route);
    });
    ui.editingSectionId = null;
    ui.creatingSection = false;

    if (route === 'sections') renderSections();
    else if (route === 'teachers') renderTeachers();
    else if (route === 'students') renderStudents();
    else renderOverview();
  }

  /* ================= OVERVIEW ================= */
  function renderOverview() {
    const sections = DB.sectionsInCollege(user.collegeId);
    const students = DB.studentsInCollege(user.collegeId);
    const teachers = DB.usersInCollege(user.collegeId).filter(u => u.role === 'teacher');
    const sessionsThisMonth = DB.sessionsThisMonthCount(user.collegeId);
    const recent = DB.allSessionsSorted(user.collegeId).slice(0, 4);

    main.innerHTML = `
      <div class="page-header">
        <h1>Overview</h1>
        <div class="sub">${esc(DB.formatDateWeekday(new Date()))}</div>
      </div>

      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Sections</div>
          <div class="stat-value">${sections.length}</div>
          <div class="stat-hint">Active this semester</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Students</div>
          <div class="stat-value">${students.length}</div>
          <div class="stat-hint">Enrolled</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Teachers</div>
          <div class="stat-value">${teachers.length}</div>
          <div class="stat-hint">Faculty members</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Sessions</div>
          <div class="stat-value">${sessionsThisMonth}</div>
          <div class="stat-hint">Recorded this month</div>
        </div>
      </div>

      <div class="card">
        <div style="padding:18px 22px; border-bottom:1px solid var(--border); font-weight:700;">Recent Sessions</div>
        <div>
          ${recent.length ? recent.map(s => recentSessionRow(s)).join('') : `<div class="empty-state">No sessions recorded yet.</div>`}
        </div>
      </div>
    `;
  }

  function recentSessionRow(session) {
    const subject = DB.subject(session.subjectId);
    const section = DB.section(session.sectionId);
    const teacher = DB.teacher(session.teacherId);
    const { present, total } = DB.sessionAttendanceCount(session);
    const badge = attendanceBadge(present, total);
    return `
      <div class="flex-between" style="padding:16px 22px; border-bottom:1px solid #f1f2f4;">
        <div>
          <div style="font-weight:600;">${esc(subject ? subject.name : 'Unknown subject')}</div>
          <div class="muted" style="font-size:13.5px; margin-top:2px;">${esc(DB.sectionLabel(section))} · ${esc(teacher ? teacher.name : 'Unassigned')}</div>
        </div>
        <div class="flex-center gap-12">
          <span class="muted" style="font-size:13.5px;">${esc(DB.formatDateLong(session.date))}, ${esc(session.slot)}</span>
          <span class="badge ${badge.cls}">${present}/${total}</span>
        </div>
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

  /* ================= SECTIONS ================= */
  function renderSections() {
    const sections = DB.sectionsInCollege(user.collegeId);

    main.innerHTML = `
      <div class="page-header-row">
        <div>
          <h1 style="margin-bottom:4px;">Sections</h1>
          <div class="sub">${sections.length} section${sections.length === 1 ? '' : 's'} · HOD only</div>
        </div>
        <button class="btn btn-primary" id="newSectionBtn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Section
        </button>
      </div>
      <div class="section-list" id="sectionList"></div>
    `;

    document.getElementById('newSectionBtn').addEventListener('click', () => {
      ui.creatingSection = true;
      paintSections();
    });

    paintSections();

    function paintSections() {
      const list = document.getElementById('sectionList');
      const sects = DB.sectionsInCollege(user.collegeId);
      let html = '';
      if (ui.creatingSection) html += sectionCreateRow();
      html += sects.map(sec => sectionRow(sec)).join('');
      if (!sects.length && !ui.creatingSection) {
        html = `<div class="card empty-state">No sections yet. Create your first one.</div>`;
      }
      list.innerHTML = html;
      wireSectionRows();
    }

    function sectionCreateRow() {
      return `
        <div class="card" style="padding:16px 22px;">
          <div class="inline-edit flex-center gap-10">
            <input type="text" id="newSecName" placeholder="e.g. CS-C">
            <input type="text" id="newSecSem" placeholder="e.g. Sem 3">
            <button class="btn-link" id="saveNewSection">Create</button>
            <button class="btn-link" style="color:var(--text-muted)" id="cancelNewSection">Cancel</button>
          </div>
        </div>
      `;
    }

    function sectionRow(sec) {
      const studentCount = DB.studentsInSection(sec.id).length;
      const subjects = DB.subjectsInSection(sec.id);
      const isEditing = ui.editingSectionId === sec.id;
      const isExpanded = ui.expandedSectionId === sec.id;
      const canDelete = studentCount === 0;
      const mentor = DB.mentorOfSection(sec.id);

      if (isEditing) {
        return `
          <div class="card" style="padding:16px 22px;">
            <div class="inline-edit flex-center gap-10">
              <input type="text" id="editSecName_${sec.id}" value="${esc(sec.name)}">
              <input type="text" id="editSecSem_${sec.id}" value="${esc(sec.sem)}">
              <button class="btn-link" data-save-sec="${sec.id}">Save</button>
              <button class="btn-link" style="color:var(--text-muted)" data-cancel-sec="${sec.id}">Cancel</button>
              <span style="flex:1"></span>
              <button class="btn-link danger" style="opacity:.35; cursor:not-allowed;" disabled>Delete</button>
            </div>
          </div>
        `;
      }

      return `
        <div class="card">
          <div class="flex-between" style="padding:16px 22px;">
            <div class="flex-center gap-12">
              <div class="class-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
              </div>
              <div>
                <div style="font-weight:700;">${esc(sec.name)} · ${esc(sec.sem)}</div>
                <div class="muted" style="font-size:13.5px; margin-top:2px;">${studentCount} students · ${subjects.length} subjects · Mentor: ${mentor ? esc(mentor.name) : 'Not set'}</div>
              </div>
            </div>
            <div class="flex-center gap-8">
              <button class="btn btn-outline btn-sm" data-edit-sec="${sec.id}">Edit</button>
              <button class="btn btn-outline btn-sm" data-delete-sec="${sec.id}" ${canDelete ? '' : 'disabled title="Cannot delete: section has enrolled students"'}>Delete</button>
              <button class="btn-icon" data-toggle-sec="${sec.id}" title="Show subjects">
                <svg class="chev ${isExpanded ? 'open' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
            </div>
          </div>
          ${isExpanded ? subjectPanel(sec, subjects) : ''}
        </div>
      `;
    }

    function subjectPanel(sec, subjects) {
      const teachers = DB.usersInCollege(user.collegeId).filter(u => u.role === 'teacher');
      return `
        <div class="subject-panel">
          <div class="mentor-row" style="display:flex; align-items:center; gap:10px; padding-bottom:14px; margin-bottom:14px; border-bottom:1px solid var(--border);">
            <span class="faint" style="font-size:13px; font-weight:600;">Mentor (approves this section's leave requests):</span>
            <select id="mentorSelect_${sec.id}" style="max-width:220px;">
              <option value="">Not set</option>
              ${teachers.map(t => `<option value="${t.id}" ${sec.mentorId === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
            </select>
            <button class="btn-link" data-save-mentor="${sec.id}">Save</button>
          </div>
          ${subjects.length ? subjects.map(sub => {
            const t = DB.teacher(sub.teacherId);
            return `
              <div class="subject-row">
                <span class="sname">${esc(sub.name)}</span>
                <span class="steacher">${t ? esc(t.name) : 'Unassigned'}
                  <button class="btn-link danger" style="margin-left:10px;" data-remove-subject="${sub.id}">Remove</button>
                </span>
              </div>`;
          }).join('') : `<div class="faint" style="font-size:13.5px;">No subjects added yet.</div>`}
          <div class="add-subject-form">
            <input type="text" placeholder="Subject name" id="newSubName_${sec.id}">
            <select id="newSubTeacher_${sec.id}">
              <option value="">Unassigned</option>
              ${teachers.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}
            </select>
            <button class="btn btn-outline btn-sm" data-add-subject="${sec.id}">+ Add Subject</button>
          </div>
        </div>
      `;
    }

    function wireSectionRows() {
      const list = document.getElementById('sectionList');

      const saveNew = document.getElementById('saveNewSection');
      if (saveNew) saveNew.addEventListener('click', () => {
        const name = document.getElementById('newSecName').value.trim();
        const sem = document.getElementById('newSecSem').value.trim();
        if (!name || !sem) { showToast('Please fill in both fields.'); return; }
        const sections = DB.getSections();
        sections.push({ id: DB.uid('s'), name, sem, collegeId: user.collegeId, mentorId: null });
        DB.saveSections(sections);
        ui.creatingSection = false;
        showToast('Section created.');
        paintSections();
        refreshHeaderCount();
      });
      const cancelNew = document.getElementById('cancelNewSection');
      if (cancelNew) cancelNew.addEventListener('click', () => { ui.creatingSection = false; paintSections(); });

      list.querySelectorAll('[data-edit-sec]').forEach(b => b.addEventListener('click', () => {
        ui.editingSectionId = b.dataset.editSec;
        paintSections();
      }));
      list.querySelectorAll('[data-cancel-sec]').forEach(b => b.addEventListener('click', () => {
        ui.editingSectionId = null;
        paintSections();
      }));
      list.querySelectorAll('[data-save-sec]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.saveSec;
        const name = document.getElementById(`editSecName_${id}`).value.trim();
        const sem = document.getElementById(`editSecSem_${id}`).value.trim();
        if (!name || !sem) { showToast('Please fill in both fields.'); return; }
        const sections = DB.getSections();
        const sec = sections.find(s => s.id === id);
        sec.name = name; sec.sem = sem;
        DB.saveSections(sections);
        ui.editingSectionId = null;
        showToast('Section updated.');
        paintSections();
      }));
      list.querySelectorAll('[data-delete-sec]:not([disabled])').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.deleteSec;
        if (!confirm('Delete this section? This also removes its subjects.')) return;
        DB.saveSections(DB.getSections().filter(s => s.id !== id));
        DB.saveSubjects(DB.getSubjects().filter(s => s.sectionId !== id));
        showToast('Section deleted.');
        paintSections();
        refreshHeaderCount();
      }));
      list.querySelectorAll('[data-toggle-sec]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.toggleSec;
        ui.expandedSectionId = ui.expandedSectionId === id ? null : id;
        paintSections();
      }));
      list.querySelectorAll('[data-save-mentor]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.saveMentor;
        const mentorId = document.getElementById(`mentorSelect_${id}`).value || null;
        const sections = DB.getSections();
        const sec = sections.find(s => s.id === id);
        sec.mentorId = mentorId;
        DB.saveSections(sections);
        showToast('Mentor updated.');
        paintSections();
      }));
      list.querySelectorAll('[data-remove-subject]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.removeSubject;
        if (!confirm('Remove this subject from the section?')) return;
        DB.saveSubjects(DB.getSubjects().filter(s => s.id !== id));
        showToast('Subject removed.');
        paintSections();
      }));
      list.querySelectorAll('[data-add-subject]').forEach(b => b.addEventListener('click', () => {
        const secId = b.dataset.addSubject;
        const nameInput = document.getElementById(`newSubName_${secId}`);
        const teacherSel = document.getElementById(`newSubTeacher_${secId}`);
        const name = nameInput.value.trim();
        if (!name) { showToast('Enter a subject name.'); return; }
        const subjects = DB.getSubjects();
        subjects.push({ id: DB.uid('sub'), name, sectionId: secId, teacherId: teacherSel.value || null, collegeId: user.collegeId });
        DB.saveSubjects(subjects);
        showToast('Subject added.');
        paintSections();
      }));
    }

    function refreshHeaderCount() {
      const sub = main.querySelector('.page-header-row .sub');
      const n = DB.sectionsInCollege(user.collegeId).length;
      if (sub) sub.textContent = `${n} section${n === 1 ? '' : 's'} · HOD only`;
    }
  }

  /* ================= TEACHERS ================= */
  function renderTeachers() {
    const teachers = DB.usersInCollege(user.collegeId).filter(u => u.role === 'teacher');

    main.innerHTML = `
      <div class="page-header-row">
        <div>
          <h1 style="margin-bottom:4px;">Teachers</h1>
          <div class="sub" id="teacherCountSub">${teachers.length} faculty member${teachers.length === 1 ? '' : 's'}</div>
        </div>
        <button class="btn btn-primary" id="addTeacherBtn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Teacher
        </button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Assigned to</th></tr></thead>
          <tbody id="teacherTbody"></tbody>
        </table>
      </div>
    `;

    document.getElementById('addTeacherBtn').addEventListener('click', openAddTeacherModal);
    paintTeacherTable();

    function paintTeacherTable() {
      const tbody = document.getElementById('teacherTbody');
      const teachers = DB.usersInCollege(user.collegeId).filter(u => u.role === 'teacher');
      document.getElementById('teacherCountSub').textContent = `${teachers.length} faculty member${teachers.length === 1 ? '' : 's'}`;

      if (!teachers.length) {
        tbody.innerHTML = `<tr><td colspan="3" class="empty-state">No teachers yet.</td></tr>`;
        return;
      }

      tbody.innerHTML = teachers.map(t => {
        const subs = DB.subjectsByTeacher(t.id);
        const badges = subs.map(sub => {
          const sec = DB.section(sub.sectionId);
          return `<span class="badge badge-blue">${esc(DB.sectionLabel(sec))} — ${esc(sub.name)}
            <span class="badge-remove badge-btn" data-unassign="${sub.id}" title="Unassign">✕</span>
          </span>`;
        }).join(' ');
        return `
          <tr>
            <td>
              <div class="flex-center gap-10">
                <div class="avatar" style="width:28px;height:28px;font-size:11px;">${esc(DB.initials(t.name))}</div>
                <span class="cell-strong">${esc(t.name)}</span>
              </div>
            </td>
            <td class="muted">${esc(t.email)}</td>
            <td>
              <div class="flex-center gap-8" style="flex-wrap:wrap;">
                ${badges}
                <span class="badge badge-gray badge-btn" data-assign="${t.id}">+ Assign</span>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      tbody.querySelectorAll('[data-unassign]').forEach(el => el.addEventListener('click', () => {
        const id = el.dataset.unassign;
        if (!confirm('Unassign this subject from the teacher?')) return;
        DB.saveSubjects(DB.getSubjects().filter(s => s.id !== id));
        showToast('Unassigned.');
        paintTeacherTable();
      }));
      tbody.querySelectorAll('[data-assign]').forEach(el => el.addEventListener('click', () => {
        openAssignModal(el.dataset.assign, paintTeacherTable);
      }));
    }

    function openAddTeacherModal() {
      openModal({
        title: 'Add Teacher',
        bodyHtml: `
          <div class="field"><label>Full name</label><input type="text" id="tName" placeholder="Dr. Jane Doe"></div>
          <div class="field"><label>Email</label><input type="email" id="tEmail" placeholder="j.doe@college.edu"></div>
          <div class="field"><label>Password <span class="faint">(for sign-in)</span></label><input type="password" id="tPass" placeholder="teacher123"></div>
        `,
        confirmText: 'Add Teacher',
        onConfirm: () => {
          const name = document.getElementById('tName').value.trim();
          const email = document.getElementById('tEmail').value.trim();
          const pass = document.getElementById('tPass').value.trim() || 'teacher123';
          if (!name || !email) { showToast('Please fill in name and email.'); return false; }
          if (DB.usersInCollege(user.collegeId).some(u => u.email.toLowerCase() === email.toLowerCase())) {
            showToast('A user with that email already exists.'); return false;
          }
          const users = DB.getUsers();
          users.push({ id: DB.uid('u'), name, email, password: pass, role: 'teacher', title: 'Faculty', collegeId: user.collegeId });
          DB.saveUsers(users);
          showToast('Teacher added.');
          paintTeacherTable();
          return true;
        }
      });
    }

    function openAssignModal(teacherId, onDone) {
      const sections = DB.sectionsInCollege(user.collegeId);
      openModal({
        title: 'Assign Subject',
        bodyHtml: `
          <div class="field">
            <label>Section</label>
            <select id="aSection">${sections.map(s => `<option value="${s.id}">${esc(DB.sectionLabel(s))}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Subject name</label><input type="text" id="aSubject" placeholder="e.g. Algorithms"></div>
        `,
        confirmText: 'Assign',
        onConfirm: () => {
          const sectionId = document.getElementById('aSection').value;
          const name = document.getElementById('aSubject').value.trim();
          if (!sectionId || !name) { showToast('Please fill in all fields.'); return false; }
          const subjects = DB.getSubjects();
          subjects.push({ id: DB.uid('sub'), name, sectionId, teacherId, collegeId: user.collegeId });
          DB.saveSubjects(subjects);
          showToast('Subject assigned.');
          onDone();
          return true;
        }
      });
    }
  }

  /* ================= STUDENTS ================= */
  function renderStudents() {
    const students = DB.studentsInCollege(user.collegeId);

    main.innerHTML = `
      <div class="page-header-row">
        <div>
          <h1 style="margin-bottom:4px;">Students</h1>
          <div class="sub" id="studentCountSub">${students.length} enrolled</div>
        </div>
        <button class="btn btn-primary" id="addStudentBtn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Student
        </button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Roll No</th><th>Name</th><th>Section</th><th>Attendance</th><th></th></tr></thead>
          <tbody id="studentTbody"></tbody>
        </table>
      </div>
    `;

    document.getElementById('addStudentBtn').addEventListener('click', () => openStudentModal());
    paintStudents();

    function paintStudents() {
      const tbody = document.getElementById('studentTbody');
      const students = DB.studentsInCollege(user.collegeId);
      document.getElementById('studentCountSub').textContent = `${students.length} enrolled`;

      if (!students.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No students yet.</td></tr>`;
        return;
      }

      tbody.innerHTML = students.map(st => {
        const sec = DB.section(st.sectionId);
        const pct = DB.studentAttendancePct(st.id, st.sectionId);
        const attendanceHtml = pct === null
          ? `<span class="faint" style="font-size:13.5px;">No data</span>`
          : `<div class="progress-wrap">
               <div class="progress-track"><div class="progress-fill ${pct === 100 ? 'green' : pct < 60 ? 'red' : 'blue'}" style="width:${pct}%;"></div></div>
               <span class="progress-pct">${pct}%</span>
             </div>`;
        return `
          <tr>
            <td class="roll">${esc(st.rollNo)}</td>
            <td class="cell-strong">${esc(st.name)}</td>
            <td>${sec ? `<span class="badge badge-gray">${esc(DB.sectionLabel(sec))}</span>` : '<span class="faint">—</span>'}</td>
            <td>${attendanceHtml}</td>
            <td>
              <div class="flex-center gap-8">
                <button class="btn-icon" data-edit-student="${st.id}" title="Edit">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                </button>
                <button class="btn-icon" data-delete-student="${st.id}" title="Delete">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      tbody.querySelectorAll('[data-edit-student]').forEach(b => b.addEventListener('click', () => {
        openStudentModal(DB.student(b.dataset.editStudent));
      }));
      tbody.querySelectorAll('[data-delete-student]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.deleteStudent;
        if (!confirm('Remove this student?')) return;
        DB.saveStudents(DB.getStudents().filter(s => s.id !== id));
        showToast('Student removed.');
        paintStudents();
      }));
    }

    function openStudentModal(existing) {
      const sections = DB.sectionsInCollege(user.collegeId);
      openModal({
        title: existing ? 'Edit Student' : 'Add Student',
        bodyHtml: `
          <div class="field-row">
            <div class="field"><label>Roll No</label><input type="text" id="sRoll" value="${existing ? esc(existing.rollNo) : ''}" placeholder="CS2111"></div>
            <div class="field"><label>Name</label><input type="text" id="sName" value="${existing ? esc(existing.name) : ''}" placeholder="Full name"></div>
          </div>
          <div class="field">
            <label>Section</label>
            <select id="sSection">${sections.map(s => `<option value="${s.id}" ${existing && existing.sectionId === s.id ? 'selected' : ''}>${esc(DB.sectionLabel(s))}</option>`).join('')}</select>
          </div>
        `,
        confirmText: existing ? 'Save Changes' : 'Add Student',
        onConfirm: () => {
          const rollNo = document.getElementById('sRoll').value.trim();
          const name = document.getElementById('sName').value.trim();
          const sectionId = document.getElementById('sSection').value;
          if (!rollNo || !name || !sectionId) { showToast('Please fill in all fields.'); return false; }
          const students = DB.getStudents();
          if (existing) {
            const st = students.find(s => s.id === existing.id);
            st.rollNo = rollNo; st.name = name; st.sectionId = sectionId;
          } else {
            students.push({ id: DB.uid('st'), rollNo, name, sectionId, collegeId: user.collegeId });
          }
          DB.saveStudents(students);
          showToast(existing ? 'Student updated.' : 'Student added.');
          paintStudents();
          return true;
        }
      });
    }
  }

  /* ================= modal helper ================= */
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