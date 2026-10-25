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
  await login(page, 'hod@e2e.edu', 'wrong-password');
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
  await login(page, 'hod@e2e.edu');
  await page.waitForURL('**/hod.html**');
  await noErrorOn(page, '/hod.html', ['overview', 'sections', 'teachers', 'students', 'duty-leave', 'announcements', 'attendance', 'analytics', 'at-risk',
    'access', 'mentoring', 'timetable', 'exams', 'leave-types', 'hostel', 'library', 'data', 'settings', 'system', 'audit']);
});

test('every student page loads without an error', async ({ page }) => {
  await login(page, 's1@e2e.edu');
  await page.waitForURL('**/student.html**');
  await noErrorOn(page, '/student.html', ['dashboard', 'attendance', 'qr', 'timetable', 'duty-leave', 'assignments', 'materials', 'results', 'fees', 'payments', 'campus', 'announcements', 'notifications', 'timeline', 'profile']);
});

test('limited staff only see the console areas their role allows', async ({ page }) => {
  await login(page, 'librarian@e2e.edu');
  await page.waitForURL('**/hod.html**');
  await expect(page.locator('.ws-tab', { hasText: 'Campus' })).toBeVisible();
  await expect(page.locator('.ws-tab', { hasText: 'Finance' })).toHaveCount(0);
});

test('every teacher page loads and the QR window shows a code', async ({ page }) => {
  await login(page, 't1@e2e.edu');
  await page.waitForURL('**/teacher.html**');
  await noErrorOn(page, '/teacher.html', ['today', 'classes', 'exams', 'duty-leave', 'announcements']);
  await page.goto('/teacher.html#today');
  const qr = page.getByRole('button', { name: /QR \/ code/ }).first();
  if (await qr.count()) {
    await qr.click();
    await expect(page.locator('#qrCode')).toHaveText(/^\d{6}$/, { timeout: 10000 });
  }
});

test('a parent sees only the linked child and the read-only summary', async ({ page }) => {
  await login(page, 'parent.s1@e2e.edu');
  await page.waitForURL('**/parent.html**');
  await expect(page.getByText('Student 1').first()).toBeVisible();
  await page.getByRole('link', { name: 'View' }).click();
  await expect(page.getByText(/Overall attendance/)).toBeVisible();
  await expect(page.getByText('Student 2')).toHaveCount(0);
});
