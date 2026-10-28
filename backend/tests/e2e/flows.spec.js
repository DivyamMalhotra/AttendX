const { test, expect } = require('@playwright/test');

async function login(page, email, password = 'Passw0rd1') {
  await page.goto('/');
  await page.fill('#collegeCode', 'E2E');
  await page.click('#continueBtn');
  await page.waitForURL('**/login.html');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('#signInBtn');
}

test('login offers password recovery and rejects a wrong password', async ({ page }) => {
  await login(page, 'admin@e2e.edu', 'wrong-password');
  await expect(page.getByRole('link', { name: /forgot your password/i })).toBeVisible();
  await expect(page.locator('#loginError')).toContainText(/invalid/i);
});

test('student sees fees, timetable and published results', async ({ page }) => {
  await login(page, 's1@e2e.edu');
  await page.waitForURL('**/student.html**');
  await page.goto('/student.html#fees');
  await expect(page.getByText(/semester 3/i).first()).toBeVisible();
  await page.goto('/student.html#timetable');
  await expect(page.getByRole('heading', { name: 'Timetable' })).toBeVisible();
  await page.goto('/student.html#results');
  await expect(page.getByText(/Mid-term test/)).toBeVisible();
});

test('a student is sent back to their own dashboard from the administrator console', async ({ page }) => {
  await login(page, 's1@e2e.edu');
  await page.waitForURL('**/student.html**');
  await page.goto('/hod.html');
  await page.waitForURL('**/student.html**');
});

test('manifest and service worker are served', async ({ request }) => {
  const m = await request.get('/manifest.webmanifest');
  expect(m.ok()).toBeTruthy();
  expect((await m.json()).display).toBe('standalone');
  const sw = await request.get('/sw.js');
  expect(await sw.text()).toContain('clear-data');
});

const noErrorOn = async (page, base, routes) => {
  for (const r of routes) {
    await page.goto(`${base}#${r}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-retry]'), `route #${r} shows an error`).toHaveCount(0);
    await expect(page.locator('#mainContent h1').first(), `route #${r} has a heading`).toBeVisible();
  }
};

test('every administrator console page loads without an error', async ({ page }) => {
  await login(page, 'admin@e2e.edu');
  await page.waitForURL('**/admin.html**');
  await noErrorOn(page, '/admin.html', ['overview', 'sections', 'teachers', 'students', 'duty-leave', 'announcements', 'attendance', 'analytics',
    'access', 'mentoring', 'timetable', 'exams', 'leave-types', 'library', 'data', 'settings', 'system', 'audit']);
});

test('every student page loads without an error', async ({ page }) => {
  await login(page, 's1@e2e.edu');
  await page.waitForURL('**/student.html**');
  await noErrorOn(page, '/student.html', ['dashboard', 'attendance', 'qr', 'timetable', 'duty-leave', 'assignments', 'materials', 'results', 'fees', 'payments', 'campus', 'announcements', 'notifications', 'timeline', 'profile']);
});

test('a HOD only sees departmental academic tools and no system, fee or parent tools', async ({ page }) => {
  await login(page, 'hod.cse@e2e.edu');
  await page.waitForURL('**/hod.html**');
  await page.waitForLoadState('networkidle');
  const tabs = (await page.locator('.ws-tab').allTextContents()).map(t => t.trim()).join('|');
  expect(tabs).toMatch(/Attendance/);
  expect(tabs).not.toMatch(/Admin|Fees|Campus/);
  await noErrorOn(page, '/hod.html', ['students', 'attendance', 'analytics', 'at-risk', 'exams', 'data']);
  for (const hidden of ['settings', 'system', 'audit', 'access', 'mentoring', 'library']) {
    await page.goto(`/hod.html#${hidden}`);
    await expect(page).not.toHaveURL(new RegExp(`#${hidden}$`));
  }
  await expect(page.getByText(/Parents/)).toHaveCount(0);
});

test('every teacher page loads and the QR window shows a code', async ({ page }) => {
  await login(page, 't1@e2e.edu');
  await page.waitForURL('**/teacher.html**');
  await noErrorOn(page, '/teacher.html', ['today', 'classes', 'exams', 'attendance-watch', 'duty-leave', 'announcements']);
  await page.goto('/teacher.html#today');
  const qr = page.getByRole('button', { name: /QR \/ code/ }).first();
  if (await qr.count()) {
    await qr.click();
    await expect(page.locator('#qrCode')).toHaveText(/^\d{6}$/, { timeout: 10000 });
  }
});

test('Accounts Clerk and Exam Cell see no attendance anywhere', async ({ page }) => {
  const links = async () => (await page.locator('.ws-tab, .sub-link').allTextContents()).map(t => t.trim());

  await page.context().clearCookies();
  await login(page, 'accounts.clerk@e2e.edu');
  await page.waitForURL('**/hod.html**');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#mainContent')).not.toContainText(/Recent attendance sessions|attendance/i);
  expect((await links()).join('|')).not.toMatch(/Attendance|Campus|Admin/);

  await page.context().clearCookies();
  await login(page, 'exam.cell@e2e.edu');
  await page.waitForURL('**/hod.html**');
  await page.waitForLoadState('networkidle');
  expect((await links()).join('|')).not.toMatch(/Attendance|Fees|Campus|Admin/);
  await page.goto('/hod.html#data');
  await expect(page.getByText('Student Marks').first()).toBeVisible();
  await expect(page.getByText(/Library/)).toHaveCount(0);
});

test('the Administrator sees the Admin workspace (Settings, Jobs & backups, Audit Logs) and Library, not Fees or Hostel', async ({ page }) => {
  await login(page, 'admin@e2e.edu');
  await page.waitForURL('**/admin.html**');
  await page.waitForLoadState('networkidle');
  const tabs = (await page.locator('.ws-tab').allTextContents()).map(t => t.trim());
  expect(tabs.slice(0, 2)).toEqual(['Settings', 'System']);
  expect(tabs).not.toContain('Attendance');   // no HOD-style workspaces in the Administrator console
  await expect(page.locator('#mainContent h1').first()).toHaveText('Settings');   // lands on Settings
  await page.locator('.ws-tab', { hasText: 'System' }).click();
  await expect(page.locator('.sub-link').first()).toBeVisible();
  expect((await page.locator('.sub-link').allTextContents()).map(t => t.trim())).toEqual(expect.arrayContaining(['Jobs & backups', 'Audit Logs']));
  await expect(page.locator('.ws-tab', { hasText: 'Fees' })).toHaveCount(0);
  await page.goto('/admin.html#hostel');
  await expect(page).not.toHaveURL(/#hostel$/);
  await expect(page.getByText(/Hostel/i)).toHaveCount(0);
});

test('every password field has a working Show / Hide control', async ({ page }) => {
  await page.goto('/');
  await page.fill('#collegeCode', 'E2E');
  await page.click('#continueBtn');
  await page.waitForURL('**/login.html');
  const field = page.locator('#password');
  const toggle = page.getByRole('button', { name: 'Show password' });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('type', 'button');
  await field.fill('Secret123');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(field).toHaveAttribute('type', 'text');
  await expect(page.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(field).toHaveAttribute('type', 'password');
  await expect(page.locator('input[type="text"], input[type="email"]')).toHaveCount(1);
});

test('the Parent portal offers only the linked child: marks and fees', async ({ page }) => {
  await login(page, 'parent.s1@e2e.edu');
  await page.waitForURL('**/parent.html**');
  await expect(page.getByText('Student 1').first()).toBeVisible();
  const nav = (await page.locator('a[href^="#"]').allTextContents()).map(t => t.trim()).join('|');
  expect(nav).not.toMatch(/Attendance|Leave|Assignment|Timetable|Library|Hostel/);
  await noErrorOn(page, '/parent.html', ['children', 'results', 'fees', 'payments']);
  await page.goto('/parent.html#attendance');
  await expect(page).not.toHaveURL(/#attendance$/);
  await expect(page.getByText('Student 2')).toHaveCount(0);
  await page.goto('/student.html');
  await expect(page).toHaveURL(/parent\.html/);
});

test('the Administrator is kept in the Administrator console', async ({ page }) => {
  await login(page, 'admin@e2e.edu');
  await page.waitForURL('**/admin.html**');
  await page.goto('/hod.html');
  await page.waitForURL('**/admin.html**');
});

test('the HOD cannot open the Administrator console', async ({ page }) => {
  await login(page, 'hod.cse@e2e.edu');
  await page.waitForURL('**/hod.html**');
  await page.goto('/admin.html');
  await page.waitForURL('**/hod.html**');
});
