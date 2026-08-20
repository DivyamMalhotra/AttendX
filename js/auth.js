/* ===================== AttendX auth helpers ===================== */
(function (global) {
  function requireRole(role) {
    DB.init();
    const user = DB.getCurrentUser();
    if (!user) {
      window.location.href = 'index.html';
      return null;
    }
    if (user.role !== role) {
      window.location.href = user.role === 'hod' ? 'hod.html' : 'teacher.html';
      return null;
    }
    return user;
  }

  function wireSignOut(user) {
    // sign out should also forget which college was selected, so the
    // next visitor lands back on the college-code screen
    const btn = document.getElementById('signOutBtn');
    if (btn) {
      btn.addEventListener('click', () => {
        DB.clearCurrentUser();
        DB.clearSelectedCollege();
        window.location.href = 'index.html';
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

  global.Auth = { requireRole, wireSignOut };
})(window);