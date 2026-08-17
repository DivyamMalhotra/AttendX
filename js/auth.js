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
    const btn = document.getElementById('signOutBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      DB.clearCurrentUser();
      window.location.href = 'index.html';
    });
    const nameEl = document.getElementById('sidebarUserName');
    const roleEl = document.getElementById('sidebarUserRole');
    const avatarEl = document.getElementById('sidebarAvatar');
    if (nameEl) nameEl.textContent = user.name;
    if (roleEl) roleEl.textContent = user.title;
    if (avatarEl) avatarEl.textContent = DB.initials(user.name);
  }

  global.Auth = { requireRole, wireSignOut };
})(window);
