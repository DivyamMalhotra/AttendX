const { test, expect } = require('@playwright/test');

/**
 * The browser fires `beforeinstallprompt` only on real, installable origins; headless tests cannot make it do that.
 * So these tests dispatch a SIMULATED event that carries the same prompt() / userChoice members and check what the
 * page does with it. They prove our button logic, not that a particular browser will offer installation.
 */
const fireInstallEvent = (page, outcome) => page.evaluate(outcome => {
  const e = new Event('beforeinstallprompt', { cancelable: true });
  window.__prompted = 0;
  e.prompt = async () => { window.__prompted += 1; };
  e.userChoice = Promise.resolve({ outcome });
  window.dispatchEvent(e);
}, outcome);

async function toLogin(page) {
  await page.goto('/');
  await page.fill('#collegeCode', 'E2E');
  await page.click('#continueBtn');
  await page.waitForURL('**/login.html');
}

async function signIn(page, email) {
  await toLogin(page);
  await page.fill('#email', email);
  await page.fill('#password', 'Passw0rd1');
  await page.click('#signInBtn');
}

test('sign-in page: the button stays hidden until the browser offers installation, then asks for the install', async ({ page }) => {
  await toLogin(page);
  const btn = page.locator('#installBtn');
  await expect(btn).toBeHidden();
  await fireInstallEvent(page, 'accepted');
  await expect(btn).toBeVisible();
  await btn.click();
  expect(await page.evaluate(() => window.__prompted)).toBe(1);
  await expect(btn).toBeHidden();
});

test('sign-in page: declining hides the button and it does not come back in this tab session', async ({ page }) => {
  await toLogin(page);
  await fireInstallEvent(page, 'dismissed');
  await page.locator('#installBtn').click();
  await expect(page.locator('#installBtn')).toBeHidden();
  await fireInstallEvent(page, 'dismissed');
  await expect(page.locator('#installBtn')).toBeHidden();
  await page.reload();
  await fireInstallEvent(page, 'dismissed');
  await expect(page.locator('#installBtn')).toBeHidden();
});

test('the sign-in form stays usable with the button showing on a small phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await toLogin(page);
  await fireInstallEvent(page, 'accepted');
  await expect(page.locator('#installBtn')).toBeVisible();
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(o.sw).toBeLessThanOrEqual(o.cw);
  await expect(page.locator('#signInBtn')).toBeVisible();
});

test('student header: one button, hidden until offered, never duplicated by navigating', async ({ page }) => {
  await signIn(page, 's1@e2e.edu');
  await page.waitForURL('**/student.html**');
  await expect(page.locator('#installBtn')).toHaveCount(1);
  await expect(page.locator('#installBtn')).toBeHidden();
  await fireInstallEvent(page, 'accepted');
  await expect(page.locator('#installBtn')).toBeVisible();
  for (const r of ['timetable', 'fees', 'results', 'dashboard']) { await page.goto(`/student.html#${r}`); await page.waitForLoadState('networkidle'); }
  await expect(page.locator('#installBtn')).toHaveCount(1);
  await page.locator('#installBtn').click();
  expect(await page.evaluate(() => window.__prompted)).toBe(1);
  await expect(page.locator('#installBtn')).toBeHidden();
});

for (const [who, email, file] of [['administrator', 'hod@e2e.edu', 'hod'], ['faculty', 't1@e2e.edu', 'teacher'], ['parent', 'parent.s1@e2e.edu', 'parent'], ['administration staff', 'accounts.clerk@e2e.edu', 'hod']]) {
  test(`the ${who} interface has no install button`, async ({ page }) => {
    await signIn(page, email);
    await page.waitForURL(`**/${file}.html**`);
    await expect(page.locator('.profile-btn')).toBeVisible();
    await fireInstallEvent(page, 'accepted');
    await expect(page.locator('#installBtn')).toHaveCount(0);
  });
}
