const { test, expect } = require('@playwright/test');

const WIDTHS = [[320, 700], [375, 760], [768, 1024], [1024, 768], [1366, 768], [1440, 900]];

async function login(page, email) {
  await page.goto('/');
  await page.fill('#collegeCode', 'E2E');
  await page.click('#continueBtn');
  await page.waitForURL('**/login.html');
  await page.fill('#email', email);
  await page.fill('#password', 'Passw0rd1');
  await page.click('#signInBtn');
}

const overflow = page => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));

for (const [w, h] of WIDTHS) {
  test(`no page-level horizontal scrolling at ${w}px (student and administrator)`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await login(page, 's1@e2e.edu');
    await page.waitForURL('**/student.html**');
    for (const r of ['dashboard', 'attendance', 'timetable', 'fees', 'payments', 'results', 'assignments', 'campus', 'timeline', 'duty-leave']) {
      await page.goto(`/student.html#${r}`);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('#mainContent h1').first()).toBeVisible();
      await page.waitForTimeout(400);
      const o = await overflow(page);
      expect(o.sw, `student #${r} at ${w}px`).toBeLessThanOrEqual(o.cw);
    }
    await page.context().clearCookies();
    await login(page, 'hod@e2e.edu');
    await page.waitForURL('**/hod.html**');
    for (const r of ['overview', 'students', 'sections', 'analytics', 'at-risk', 'exams', 'access', 'finance', 'library', 'data', 'system', 'audit', 'timetable']) {
      await page.goto(`/hod.html#${r}`);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('#mainContent h1').first()).toBeVisible();
      await page.waitForTimeout(400);
      const o = await overflow(page);
      expect(o.sw, `console #${r} at ${w}px`).toBeLessThanOrEqual(o.cw);
    }
  });
}

test('there is no sidebar: workspaces live in the header, with a contextual row beneath', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 's1@e2e.edu');
  await page.waitForURL('**/student.html**');
  await expect(page.locator('.sidebar, #sidebar')).toHaveCount(0);
  await expect(page.locator('.ws-tab')).toHaveCount(5);
  await page.getByRole('link', { name: 'Attendance', exact: true }).first().click();
  await expect(page.locator('.sub-link', { hasText: 'Timetable' })).toBeVisible();
  await page.locator('.sub-link', { hasText: 'Timetable' }).click();
  await expect(page.locator('#mainContent h1').first()).toHaveText('Timetable');
  await expect(page.locator('.ws-tab.active')).toHaveText('Attendance');
});

test('the command palette opens with Ctrl+K, searches real pages and records, and navigates with the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'hod@e2e.edu');
  await page.waitForURL('**/hod.html**');
  await expect(page.locator('#cmdBtn')).toBeVisible();
  await page.keyboard.press('Control+K');
  const input = page.getByRole('combobox');
  await expect(input).toBeFocused();
  await input.fill('fee');
  await expect(page.getByRole('option').first()).toBeVisible();
  await input.fill('Student 2');
  await expect(page.getByRole('option', { name: /Student 2/ }).first()).toBeVisible({ timeout: 5000 });
  await page.keyboard.press('Enter');
  await page.waitForURL('**#students');
  await expect(page.locator('#q')).toHaveValue(/E2E102/);
  await page.keyboard.press('Control+K');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Command search' })).toHaveCount(0);
});

test('a student palette only offers student pages', async ({ page }) => {
  await login(page, 's1@e2e.edu');
  await page.waitForURL('**/student.html**');
  await expect(page.locator('#cmdBtn')).toBeVisible();
  await page.keyboard.press('Control+K');
  await page.getByRole('combobox').fill('audit');
  await expect(page.getByText('No match')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('on a phone the header slims down and workspaces move to a bottom bar with a More sheet', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await login(page, 's1@e2e.edu');
  await page.waitForURL('**/student.html**');
  await expect(page.locator('.ws-tabs')).toBeHidden();
  await expect(page.locator('#bottomNav')).toBeVisible();
  await page.locator('#bottomNav').getByText('Finance').click();
  await expect(page.locator('#mainContent h1').first()).toBeVisible();
  await expect(page.locator('#bottomNav .bn-item.active')).toContainText('Finance');
  await page.locator('#bnMore').click();
  expect(await page.evaluate(() => document.body.classList.contains('no-scroll'))).toBe(true);
  await page.locator('#moreSheet').getByRole('link', { name: 'Library & hostel' }).click();
  await expect(page.locator('#moreSheet')).toBeHidden();
  expect(await page.evaluate(() => document.body.classList.contains('no-scroll'))).toBe(false);
});

test('tables become labelled cards on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await login(page, 'hod@e2e.edu');
  await page.waitForURL('**/hod.html**');
  await page.goto('/hod.html#students');
  await page.waitForSelector('tbody td[data-label]');
  const display = await page.locator('tbody tr').first().evaluate(el => getComputedStyle(el).display);
  expect(display).toBe('block');
});

test('the student directory can switch between table and directory layouts', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await login(page, 'hod@e2e.edu');
  await page.waitForURL('**/hod.html**');
  await page.goto('/hod.html#students');
  await page.waitForSelector('table');
  await page.getByRole('button', { name: 'Directory' }).click();
  await expect(page.locator('.dir-grid .person').first()).toBeVisible();
  await page.getByRole('button', { name: 'Table' }).click();
  await expect(page.locator('table')).toBeVisible();
});
