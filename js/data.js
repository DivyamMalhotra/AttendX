/* ===================== AttendX data layer ===================== */
/* Pure localStorage-backed "database" so the whole app works standalone
   without any server. Swap this file out later for real API calls if
   this gets wired up to a backend — every other page only talks to the
   functions in the `DB` object below, never to localStorage directly. */

(function (global) {
  const KEYS = {
    users: 'attendx_users',
    sections: 'attendx_sections',
    subjects: 'attendx_subjects',
    students: 'attendx_students',
    sessions: 'attendx_sessions',
    currentUser: 'attendx_current_user',
    seeded: 'attendx_seeded_v1'
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
  function seedIfNeeded() {
    if (read(KEYS.seeded)) return;

    const users = [
      { id: 'u1', name: 'Dr. Anjali Verma', email: 'anjali.verma@college.edu', password: 'hod123', role: 'hod', title: 'Head of Department' },
      { id: 'u2', name: 'Dr. Reema Mathur', email: 'r.mathur@college.edu', password: 'teacher123', role: 'teacher', title: 'Faculty' },
      { id: 'u3', name: 'Prof. Sameer Khanna', email: 's.khanna@college.edu', password: 'teacher123', role: 'teacher', title: 'Faculty' },
      { id: 'u4', name: 'Dr. Lakshmi Venkat', email: 'l.venkat@college.edu', password: 'teacher123', role: 'teacher', title: 'Faculty' }
    ];

    const sections = [
      { id: 's1', name: 'CS-B', sem: 'Sem 3' },
      { id: 's2', name: 'CS-A', sem: 'Sem 3' }
    ];

    const subjects = [
      { id: 'sub1', name: 'Data Structures', sectionId: 's1', teacherId: 'u2' },
      { id: 'sub2', name: 'Operating Systems', sectionId: 's1', teacherId: 'u3' },
      { id: 'sub3', name: 'DBMS', sectionId: 's1', teacherId: 'u4' },
      { id: 'sub4', name: 'Data Structures', sectionId: 's2', teacherId: 'u2' },
      { id: 'sub5', name: 'Computer Networks', sectionId: 's2', teacherId: 'u3' }
    ];

    const students = [
      { id: 'st1', rollNo: 'CS2101', name: 'Aditya Sharma', sectionId: 's1' },
      { id: 'st2', rollNo: 'CS2102', name: 'Priya Nair', sectionId: 's1' },
      { id: 'st3', rollNo: 'CS2103', name: 'Rohan Mehta', sectionId: 's1' },
      { id: 'st4', rollNo: 'CS2104', name: 'Sneha Kulkarni', sectionId: 's1' },
      { id: 'st5', rollNo: 'CS2105', name: 'Arjun Patel', sectionId: 's1' },
      { id: 'st6', rollNo: 'CS2106', name: 'Diya Iyer', sectionId: 's2' },
      { id: 'st7', rollNo: 'CS2107', name: 'Kabir Singh', sectionId: 's2' },
      { id: 'st8', rollNo: 'CS2108', name: 'Meera Joshi', sectionId: 's2' },
      { id: 'st9', rollNo: 'CS2109', name: 'Vikram Rao', sectionId: 's2' },
      { id: 'st10', rollNo: 'CS2110', name: 'Ananya Desai', sectionId: 's2' }
    ];

    // seed sessions in the current month so "recorded this month" stats work
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const pad = n => String(n).padStart(2, '0');
    const dateA = `${y}-${pad(m + 1)}-06`;
    const dateB = `${y}-${pad(m + 1)}-13`;

    const sessions = [
      {
        id: 'sess1', subjectId: 'sub1', sectionId: 's1', teacherId: 'u2',
        date: dateA, slot: TIME_SLOTS[1],
        attendance: { st1: 'P', st2: 'P', st3: 'P', st4: 'A', st5: 'P' }
      },
      {
        id: 'sess2', subjectId: 'sub1', sectionId: 's1', teacherId: 'u2',
        date: dateB, slot: TIME_SLOTS[1],
        attendance: { st1: 'P', st2: 'A', st3: 'A', st4: 'P', st5: 'P' }
      },
      {
        id: 'sess3', subjectId: 'sub4', sectionId: 's2', teacherId: 'u2',
        date: dateA, slot: TIME_SLOTS[3],
        attendance: { st6: 'P', st7: 'P', st8: 'P', st9: 'P', st10: 'A' }
      },
      {
        id: 'sess4', subjectId: 'sub4', sectionId: 's2', teacherId: 'u2',
        date: dateB, slot: TIME_SLOTS[1],
        attendance: { st6: 'P', st7: 'P', st8: 'P', st9: 'P', st10: 'P' }
      }
    ];

    write(KEYS.users, users);
    write(KEYS.sections, sections);
    write(KEYS.subjects, subjects);
    write(KEYS.students, students);
    write(KEYS.sessions, sessions);
    write(KEYS.seeded, true);
  }

  /* ---------------- generic getters/setters ---------------- */
  const DB = {
    TIME_SLOTS,
    uid,
    init() { seedIfNeeded(); },

    getUsers() { return read(KEYS.users) || []; },
    saveUsers(v) { write(KEYS.users, v); },

    getSections() { return read(KEYS.sections) || []; },
    saveSections(v) { write(KEYS.sections, v); },

    getSubjects() { return read(KEYS.subjects) || []; },
    saveSubjects(v) { write(KEYS.subjects, v); },

    getStudents() { return read(KEYS.students) || []; },
    saveStudents(v) { write(KEYS.students, v); },

    getSessions() { return read(KEYS.sessions) || []; },
    saveSessions(v) { write(KEYS.sessions, v); },

    getCurrentUser() { return read(KEYS.currentUser); },
    setCurrentUser(u) { write(KEYS.currentUser, u); },
    clearCurrentUser() { localStorage.removeItem(KEYS.currentUser); },

    /* ---------------- derived helpers ---------------- */
    section(id) { return this.getSections().find(s => s.id === id); },
    subject(id) { return this.getSubjects().find(s => s.id === id); },
    teacher(id) { return this.getUsers().find(u => u.id === id); },
    student(id) { return this.getStudents().find(s => s.id === id); },

    sectionLabel(section) { return section ? `${section.name} · ${section.sem}` : ''; },

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
    allSessionsSorted() {
      return this.getSessions()
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
    sessionsThisMonthCount() {
      const now = new Date();
      const y = now.getFullYear(), m = now.getMonth();
      return this.getSessions().filter(s => {
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
