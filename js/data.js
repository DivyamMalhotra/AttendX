

(function (global) {
  const KEYS = {
    colleges: 'attendx_colleges',
    users: 'attendx_users',
    sections: 'attendx_sections',
    subjects: 'attendx_subjects',
    students: 'attendx_students',
    sessions: 'attendx_sessions',
    leaveRequests: 'attendx_leave_requests',
    currentUser: 'attendx_current_user',
    selectedCollege: 'attendx_selected_college',
    seeded: 'attendx_seeded_v3'
  };

  const TIME_SLOTS = [
    '8:00 AM – 9:00 AM',
    '9:00 AM – 10:00 AM',
    '10:00 AM – 11:00 AM',
    '11:00 AM – 12:00 PM',
    '12:00 PM – 1:00 PM',
    '1:00 PM – 2:00 PM',
    '2:00 PM – 3:00 PM',
    '3:00 PM – 4:00 PM',
    '4:00 PM – 5:00 PM'
  ];

  function uid(prefix) {
    return prefix + '_' + Math.random().toString(36).slice(2, 9);
  }

  function read(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  /* ---------------- seed ---------------- */
  /* One config block per demo college. Everything below (users, section,
     subjects, students, sessions) is generated from this list in a loop,
     so adding a 4th demo college later is just adding one more entry here. */
  function seedIfNeeded() {
    if (read(KEYS.seeded)) return;

    const collegeSeeds = [
      {
        code: 'GEC24',
        name: 'Government Engineering College',
        hod: { name: 'Dr. Anjali Verma', email: 'hod@gec.edu' },
        teachers: [
          { name: 'Dr. Reema Mathur', email: 'r.mathur@gec.edu' },
          { name: 'Prof. Sameer Khanna', email: 's.khanna@gec.edu' }
        ],
        section: { name: 'CS-B', sem: 'Sem 3' },
        subjectNames: ['Data Structures', 'Operating Systems'],
        students: [
          'Aditya Sharma', 'Priya Nair', 'Rohan Mehta', 'Sneha Kulkarni', 'Arjun Patel'
        ],
        rollPrefix: 'GEC21'
      },
      {
        code: 'ABC24',
        name: 'ABC Institute of Technology',
        hod: { name: 'Dr. Karan Malhotra', email: 'hod@abcinstitute.edu' },
        teachers: [
          { name: 'Prof. Neha Kapoor', email: 'n.kapoor@abcinstitute.edu' },
          { name: 'Dr. Vikas Choudhary', email: 'v.choudhary@abcinstitute.edu' }
        ],
        section: { name: 'IT-A', sem: 'Sem 5' },
        subjectNames: ['Database Systems', 'Computer Networks'],
        students: [
          'Diya Iyer', 'Kabir Singh', 'Meera Joshi', 'Vikram Rao', 'Ananya Desai'
        ],
        rollPrefix: 'ABC23'
      },
      {
        code: 'STM24',
        name: "St. Mary's College of Engineering",
        hod: { name: 'Dr. Lakshmi Venkat', email: 'hod@stmarys.edu' },
        teachers: [
          { name: 'Prof. Farhan Ali', email: 'f.ali@stmarys.edu' },
          { name: 'Dr. Ritu Bansal', email: 'r.bansal@stmarys.edu' }
        ],
        section: { name: 'EC-A', sem: 'Sem 4' },
        subjectNames: ['Digital Electronics', 'Signals & Systems'],
        students: [
          'Ishaan Verma', 'Tanvi Rao', 'Yash Thakur', 'Pooja Menon', 'Rahul Bose'
        ],
        rollPrefix: 'STM22'
      }
    ];

    const colleges = [];
    const users = [];
    const sections = [];
    const subjects = [];
    const students = [];
    const sessions = [];

    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const pad = n => String(n).padStart(2, '0');
    const dateA = `${y}-${pad(m + 1)}-06`;
    const dateB = `${y}-${pad(m + 1)}-13`;

    collegeSeeds.forEach((seed, i) => {
      const collegeId = 'col' + (i + 1);
      colleges.push({ id: collegeId, code: seed.code, name: seed.name });

      // ---- HOD ----
      const hodId = 'u_hod_' + collegeId;
      users.push({
        id: hodId, name: seed.hod.name, email: seed.hod.email,
        password: 'hod123', role: 'hod', title: 'Head of Department', collegeId
      });

      // ---- Teachers ----
      const teacherIds = seed.teachers.map((t, ti) => {
        const tid = 'u_t' + (ti + 1) + '_' + collegeId;
        users.push({
          id: tid, name: t.name, email: t.email,
          password: 'teacher123', role: 'teacher', title: 'Faculty', collegeId
        });
        return tid;
      });

      // ---- Section (first teacher doubles as the mentor by default) ----
      const sectionId = 'sec_' + collegeId;
      sections.push({
        id: sectionId, name: seed.section.name, sem: seed.section.sem,
        collegeId, mentorId: teacherIds[0]
      });

      // ---- Subjects (one per teacher) ----
      const subjectIds = seed.subjectNames.map((subName, si) => {
        const subId = 'sub_' + collegeId + '_' + (si + 1);
        subjects.push({
          id: subId, name: subName, sectionId,
          teacherId: teacherIds[si % teacherIds.length], collegeId
        });
        return subId;
      });

      // ---- Students (each gets a login email + password too) ----
      const collegeDomain = seed.hod.email.split('@')[1];
      const studentIds = seed.students.map((name, sti) => {
        const stId = 'st_' + collegeId + '_' + (sti + 1);
        const emailSlug = name.toLowerCase().replace(/[^a-z]+/g, '.');
        students.push({
          id: stId, rollNo: seed.rollPrefix + (100 + sti + 1), name, sectionId, collegeId,
          email: emailSlug + '@student.' + collegeDomain,
          password: 'student123'
        });
        return stId;
      });

      // ---- Two sample sessions on the first subject, so stats aren't empty ----
      const firstSubjectId = subjectIds[0];
      const attendanceA = {}, attendanceB = {};
      studentIds.forEach((stId, idx) => {
        attendanceA[stId] = idx === 3 ? 'A' : 'P'; // one absent in session A
        attendanceB[stId] = idx === 1 || idx === 2 ? 'A' : 'P'; // two absent in session B
      });
      sessions.push({
        id: 'sess_' + collegeId + '_1', subjectId: firstSubjectId, sectionId,
        teacherId: teacherIds[0], date: dateA, slot: TIME_SLOTS[1], attendance: attendanceA
      });
      sessions.push({
        id: 'sess_' + collegeId + '_2', subjectId: firstSubjectId, sectionId,
        teacherId: teacherIds[0], date: dateB, slot: TIME_SLOTS[1], attendance: attendanceB
      });
    });

    write(KEYS.colleges, colleges);
    write(KEYS.users, users);
    write(KEYS.sections, sections);
    write(KEYS.subjects, subjects);
    write(KEYS.students, students);
    write(KEYS.sessions, sessions);
    write(KEYS.leaveRequests, []);
    write(KEYS.seeded, true);
  }

  /* ---------------- generic getters/setters ---------------- */
  const DB = {
    TIME_SLOTS,
    uid,
    init() { seedIfNeeded(); },

    getColleges() { return read(KEYS.colleges) || []; },
    college(id) { return this.getColleges().find(c => c.id === id); },
    collegeByCode(code) {
      const norm = String(code || '').trim().toUpperCase();
      return this.getColleges().find(c => c.code.toUpperCase() === norm);
    },

    getUsers() { return read(KEYS.users) || []; },
    saveUsers(v) { write(KEYS.users, v); },
    usersInCollege(collegeId) { return this.getUsers().filter(u => u.collegeId === collegeId); },

    getSections() { return read(KEYS.sections) || []; },
    saveSections(v) { write(KEYS.sections, v); },
    sectionsInCollege(collegeId) { return this.getSections().filter(s => s.collegeId === collegeId); },

    getSubjects() { return read(KEYS.subjects) || []; },
    saveSubjects(v) { write(KEYS.subjects, v); },
    subjectsInCollege(collegeId) { return this.getSubjects().filter(s => s.collegeId === collegeId); },

    getStudents() { return read(KEYS.students) || []; },
    saveStudents(v) { write(KEYS.students, v); },
    studentsInCollege(collegeId) { return this.getStudents().filter(s => s.collegeId === collegeId); },

    getLeaveRequests() { return read(KEYS.leaveRequests) || []; },
    saveLeaveRequests(v) { write(KEYS.leaveRequests, v); },
    leaveRequestsForStudent(studentId) {
      return this.getLeaveRequests()
        .filter(r => r.studentId === studentId)
        .sort((a, b) => b.requestedAt - a.requestedAt);
    },
    leaveRequestsForMentor(teacherId) {
      return this.getLeaveRequests()
        .filter(r => r.mentorId === teacherId)
        .sort((a, b) => b.requestedAt - a.requestedAt);
    },

    getSessions() { return read(KEYS.sessions) || []; },
    saveSessions(v) { write(KEYS.sessions, v); },

    getCurrentUser() { return read(KEYS.currentUser); },
    setCurrentUser(u) { write(KEYS.currentUser, u); },
    clearCurrentUser() { localStorage.removeItem(KEYS.currentUser); },

    /* ---------------- selected college (step 1 of login) ---------------- */
    getSelectedCollege() {
      const id = localStorage.getItem(KEYS.selectedCollege);
      return id ? this.college(id) : null;
    },
    setSelectedCollege(collegeId) { localStorage.setItem(KEYS.selectedCollege, collegeId); },
    clearSelectedCollege() { localStorage.removeItem(KEYS.selectedCollege); },

    /* ---------------- derived helpers ---------------- */
    section(id) { return this.getSections().find(s => s.id === id); },
    subject(id) { return this.getSubjects().find(s => s.id === id); },
    teacher(id) { return this.getUsers().find(u => u.id === id); },
    student(id) { return this.getStudents().find(s => s.id === id); },

    sectionLabel(section) { return section ? `${section.name} · ${section.sem}` : ''; },

    mentorOfSection(sectionId) {
      const sec = this.section(sectionId);
      if (!sec || !sec.mentorId) return null;
      return this.teacher(sec.mentorId);
    },

    /* per-subject attendance breakdown for one student, used on their dashboard */
    studentAttendanceBySubject(studentId, sectionId) {
      const subjects = this.subjectsInSection(sectionId);
      return subjects.map(sub => {
        const sessions = this.sessionsForSubject(sub.id);
        let present = 0, total = 0;
        sessions.forEach(s => {
          if (Object.prototype.hasOwnProperty.call(s.attendance, studentId)) {
            total++;
            if (s.attendance[studentId] === 'P') present++;
          }
        });
        const teacher = this.teacher(sub.teacherId);
        return {
          subject: sub, teacher, present, total,
          pct: total === 0 ? null : Math.round((present / total) * 100)
        };
      });
    },

    studentsInSection(sectionId) {
      return this.getStudents().filter(s => s.sectionId === sectionId);
    },
    subjectsInSection(sectionId) {
      return this.getSubjects().filter(s => s.sectionId === sectionId);
    },
    subjectsByTeacher(teacherId) {
      return this.getSubjects().filter(s => s.teacherId === teacherId);
    },
    sessionsForSubject(subjectId) {
      return this.getSessions()
        .filter(s => s.subjectId === subjectId)
        .sort((a, b) => (a.date + a.slot) < (b.date + b.slot) ? 1 : -1);
    },
    allSessionsSorted(collegeId) {
      return this.getSessions()
        .filter(s => {
          if (!collegeId) return true;
          const sec = this.section(s.sectionId);
          return sec && sec.collegeId === collegeId;
        })
        .slice()
        .sort((a, b) => (a.date + a.slot) < (b.date + b.slot) ? 1 : -1);
    },
    sessionAttendanceCount(session) {
      const vals = Object.values(session.attendance || {});
      const present = vals.filter(v => v === 'P').length;
      const total = vals.length;
      return { present, total };
    },
    /* attendance % for one student across all sessions of their section's subjects */
    studentAttendancePct(studentId, sectionId) {
      const sessions = this.getSessions().filter(s => s.sectionId === sectionId);
      let present = 0, total = 0;
      sessions.forEach(s => {
        if (Object.prototype.hasOwnProperty.call(s.attendance, studentId)) {
          total++;
          if (s.attendance[studentId] === 'P') present++;
        }
      });
      if (total === 0) return null;
      return Math.round((present / total) * 100);
    },
    sessionsThisMonthCount(collegeId) {
      const now = new Date();
      const y = now.getFullYear(), m = now.getMonth();
      return this.getSessions().filter(s => {
        if (collegeId) {
          const sec = this.section(s.sectionId);
          if (!sec || sec.collegeId !== collegeId) return false;
        }
        const d = new Date(s.date + 'T00:00:00');
        return d.getFullYear() === y && d.getMonth() === m;
      }).length;
    },

    formatDateLong(dateStr) {
      const d = new Date(dateStr + 'T00:00:00');
      return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
    },
    formatDateWeekday(date) {
      return date.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    },
    initials(name) {
      return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
    }
  };

  global.DB = DB;
})(window);