import assert from 'node:assert/strict';

// Other suites use an explicit fixture profile, never the old seeded persona.
export async function completeOnboarding(page) {
  await page.waitForSelector('.welcome, .application-shell');
  if (!await page.$('.welcome')) return false;
  await page.waitForSelector('#welcome-background');
  assert.equal(await page.$eval('#welcome-background', element => element.value), '');
  assert.equal(await page.$eval('#welcome-foundations', element => element.value), '');
  await page.type('#welcome-background', 'Offline QA learner');
  await page.click('.welcome-next');
  await page.waitForSelector('.welcome-finish .primary');
  await page.click('.welcome-finish .primary');
  await page.waitForSelector('.application-shell');
  return true;
}
