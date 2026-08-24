/* ===================== AttendX auth helpers ===================== */
(function (global) {
  // single place that maps a role to its dashboard page — every other
  // file (index.html, login.html, auth.js) calls this instead of
  // repeating the same if/else chain
  function dashboardFor(user) {
    if (user.role === 'hod') return 'hod.html';
    if (user.role === 'teacher') return 'teacher.html';
    return 'student.html';
  }

  function requireRole(role) {
    DB.init();
    const user = DB.getCurrentUser();
    if (!user) {
      // login.html already redirects to index.html itself if no college
      // has been picked yet, so this is safe even on a first-ever visit
      window.location.href = 'login.html';
      return null;
    }
    if (user.role !== role) {
      window.location.href = dashboardFor(user);
      return null;
    }
    return user;
  }

  function wireSignOut(user) {
    // sign out should land back on THIS college's login screen, not force
    // the person to re-type the college code. Changing college is still
    // possible manually via the "Change college" link on login.html.
    const btn = document.getElementById('signOutBtn');
    if (btn) {
      btn.addEventListener('click', () => {
        DB.clearCurrentUser();
        window.location.href = 'login.html';
      });
    }

    const nameEl = document.getElementById('sidebarUserName');
    const roleEl = document.getElementById('sidebarUserRole');
    const avatarEl = document.getElementById('sidebarAvatar');
    const collegeEl = document.getElementById('sidebarCollege');

    if (nameEl) nameEl.textContent = user.name;
    if (roleEl) roleEl.textContent = user.title;
    if (avatarEl) avatarEl.textContent = DB.initials(user.name);

    // keep "selected college" in sync with whoever is actually logged in,
    // and show the college name in the sidebar if that element exists
    if (user.collegeId) {
      DB.setSelectedCollege(user.collegeId);
      const college = DB.college(user.collegeId);
      if (collegeEl && college) collegeEl.textContent = college.name;
    }
  }

  global.Auth = { requireRole, wireSignOut, dashboardFor };
})(window);