const { test, expect } = require('@playwright/test');

async function login(page, email) {
  await page.goto('/');
  await page.fill('#collegeCode', 'E2E');
  await page.click('#continueBtn');
  await page.waitForURL('**/login.html');
  await page.fill('#email', email);
  await page.fill('#password', 'Passw0rd1');
  await page.click('#signInBtn');
}


/** Opens the command palette. If the page had not finished starting when the key was pressed, press once more. */
async function openPalette(page) {
  await expect(page.locator('#cmdBtn')).toBeVisible();
  const box = page.getByRole('combobox');
  await page.keyboard.press('Control+K');
  const opened = await box.waitFor({ state: 'visible', timeout: 1500 }).then(() => true).catch(() => false);
  if (!opened) await page.keyboard.press('Control+K');
  await expect(box).toBeFocused();
  return box;
}

const FEE_PAGES = [['overview', 'Fees overview'], ['structures', 'Fee Structures'], ['assign', 'Fee Assignments'], ['transactions', 'Transactions'], ['reports', 'Fee reports'], ['refunds', 'Refunds']];

test('the head of department has no fee navigation, fee figures or fee exports', async ({ page }) => {
  await login(page, 'hod@e2e.edu');
  await page.waitForURL('**/hod.html**');
  await expect(page.locator('.ws-tab', { hasText: 'Fees' })).toHaveCount(0);
  await expect(page.locator('#mainContent')).not.toContainText(/Fees collected|Fees outstanding|Payments verified/);
  const box = await openPalette(page);
  await box.fill('transactions');
  await expect(page.getByText('No match')).toBeVisible();
  await page.keyboard.press('Escape');
  // an old fee bookmark does not open the page for the HOD: it lands on their own start page
  await page.goto('/hod.html#fee-structures');
  await expect(page).toHaveURL(/#overview$/);
});

test('administration staff with fee permissions see Fees: Overview, Structures, Assign, Transactions, Reports', async ({ page }) => {
  await login(page, 'accounts.clerk@e2e.edu');
  await page.waitForURL('**/hod.html**');
  await expect(page.locator('.ws-tab', { hasText: 'Fees' })).toBeVisible();
  await page.locator('.ws-tab', { hasText: 'Fees' }).click();
  await expect(page.locator('.sub-link').first()).toBeVisible();
  const labels = await page.locator('.sub-link').allTextContents();
  expect(labels.map(l => l.trim()).slice(0, 5)).toEqual(['Overview', 'Structures', 'Assign', 'Transactions', 'Reports']);
  for (const [route, heading] of FEE_PAGES) {
    await page.goto(`/hod.html#fees/${route}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-retry]'), `fees/${route} errored`).toHaveCount(0);
    await expect(page.locator('#mainContent h1').first()).toContainText(heading);
  }
});

test('old fee links forward to the new fee routes, keep their query, and Back does not loop', async ({ page }) => {
  await login(page, 'accounts.clerk@e2e.edu');
  await page.waitForURL('**/hod.html**');
  await page.goto('/hod.html#overview');
  const cases = [['fee-structures', 'fees/structures'], ['fee-assignments', 'fees/assign'], ['transactions', 'fees/transactions'], ['finance', 'fees/refunds']];
  for (const [oldRoute, next] of cases) {
    await page.goto(`/hod.html#${oldRoute}?x=1`);
    await expect(page).toHaveURL(new RegExp(`#${next}\\?x=1$`));
    await expect(page.locator('#mainContent h1').first()).toBeVisible();
  }
  await page.goBack();
  await expect(page).not.toHaveURL(/#fee-structures/);
});

test('the command palette offers the new fee routes to fee staff', async ({ page }) => {
  await login(page, 'accounts.clerk@e2e.edu');
  await page.waitForURL('**/hod.html**');
  const box = await openPalette(page);
  await box.fill('structures');
  await page.getByRole('option', { name: /Structures/ }).first().click();
  await expect(page).toHaveURL(/#fees\/structures$/);
});

test('the librarian cannot reach fee pages', async ({ page }) => {
  await login(page, 'librarian@e2e.edu');
  await page.waitForURL('**/hod.html**');
  await expect(page.locator('.ws-tab', { hasText: 'Fees' })).toHaveCount(0);
  await page.goto('/hod.html#fees/transactions');
  await expect(page).not.toHaveURL(/#fees\/transactions/);
});
