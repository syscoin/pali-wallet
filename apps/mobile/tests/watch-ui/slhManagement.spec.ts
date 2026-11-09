import { expect, test, type Locator, type Page } from '@playwright/test';

async function reachable(action: Locator, page: Page) {
  await action.scrollIntoViewIfNeeded(); await expect(action).toBeVisible();
  const bounds = await action.boundingBox(), viewport = page.viewportSize()!;
  expect(bounds).not.toBeNull(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height); expect(bounds!.height).toBeGreaterThanOrEqual(44);
  await test.info().attach('slh-hit-target', {body:JSON.stringify({label:await action.innerText(),viewport,bounds}),contentType:'application/json'});
}
// Match the existing watch-browser large-text control; RN Web does not scale native text itself.
async function largeText(page: Page) {
  const measured = await page.evaluate(() => {
    const values = Array.from(document.querySelectorAll<HTMLElement>('[dir="auto"]'))
      .filter(element => !element.hasAttribute('data-qa-font-scaled'))
      .map(element => { const style = getComputedStyle(element); return {element,font:parseFloat(style.fontSize),line:parseFloat(style.lineHeight)}; });
    for (const {element,font,line} of values) {
      element.setAttribute('data-qa-font-scaled','true');
      if (Number.isFinite(font)) element.style.setProperty('font-size', `${font * 1.6}px`, 'important');
      if (Number.isFinite(line)) element.style.setProperty('line-height', `${line * 1.6}px`, 'important');
    }
    return values.filter(value => Number.isFinite(value.font)).map(({element,font,line}) => ({
      text:element.textContent,normalFontSize:font,scaledFontSize:parseFloat(getComputedStyle(element).fontSize),normalLineHeight:line,scaledLineHeight:parseFloat(getComputedStyle(element).lineHeight)
    }));
  });
  expect(measured.length).toBeGreaterThan(0);
  for (const value of measured) expect(value.scaledFontSize).toBeCloseTo(value.normalFontSize * 1.6, 1);
  await test.info().attach('slh-computed-font-scale', {body:JSON.stringify(measured),contentType:'application/json'});
}
test.beforeEach(async ({page,baseURL}) => {
  await page.setViewportSize({width:320,height:480});
  await page.route('**/*', async route => {
    if (new URL(route.request().url()).origin === new URL(baseURL!).origin) return route.continue();
    await route.abort('blockedbyclient'); throw Error('Unexpected external request');
  });
});
test('saved SLH status and explicit rebuild remain reachable at narrow large text', async ({page},info) => {
  await page.goto('/?slh-fixture=ready&android&font-scale=1.6');
  await expect(page.getByRole('heading', {name:'Post-quantum SLH-DSA'})).toBeVisible(); await largeText(page);
  await expect(page.getByLabel('SLH-DSA 7 / 16776216')).toBeVisible();
  await page.getByText('Ready',{exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath('slh-ready-320-large.png'),fullPage:true});
  const use = page.getByRole('button',{name:'Use this method',exact:true}); await reachable(use,page);
  const rebuild = page.getByRole('button',{name:'Regenerate local signer',exact:true}); await reachable(rebuild,page); await rebuild.click();
  await expect(page.getByText('25%',{exact:true})).toBeVisible(); await expect(rebuild).toBeDisabled();
  expect(await page.evaluate(() => window.__slhManagementFixture.counts())).toEqual({prepared:0,rebuilt:1});
  await largeText(page); await page.getByText('25%',{exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath('slh-rebuild-320-large.png'),fullPage:true});
  await page.evaluate(() => window.__slhManagementFixture.release()); await expect(rebuild).toBeEnabled();
  await expect(page.getByLabel('SLH-DSA 7 / 16776216')).toBeVisible();
  await reachable(page.getByRole('button',{name:'Close',exact:true}),page);
  await page.goto('/?slh-fixture=installed&android&font-scale=1.6'); await expect(page.getByText('Installed',{exact:true})).toBeVisible(); await largeText(page); await page.getByText('Installed',{exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath('slh-installed-320-large.png'),fullPage:true});
});
test('fresh SLH setup retires on background without publishing late progress', async ({page},info) => {
  await page.goto('/?slh-fixture=fresh&android'); const create = page.getByRole('button',{name:'Create',exact:true});
  await reachable(create,page); await page.screenshot({path:info.outputPath('slh-fresh-320.png'),fullPage:true}); await create.click();
  await expect(page.getByText('25%',{exact:true})).toBeVisible();
  expect(await page.evaluate(() => window.__slhManagementFixture.counts())).toEqual({prepared:1,rebuilt:0});
  await page.getByText('25%',{exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath('slh-setup-320.png'),fullPage:true});
  await page.evaluate(() => window.__watchFixture.lifecycle('background'));
  await expect(page.getByRole('button',{name:'Close',exact:true})).toBeDisabled();
  await page.evaluate(() => window.__slhManagementFixture.release());
  await expect(page.getByText('Public fixture closed',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Use this method',exact:true})).toHaveCount(0);
});
test('SLH loading, failure and closing keep a reachable footer and drain before Back', async ({page},info) => {
  await page.goto('/?slh-fixture=loading&android'); const close = page.getByRole('button',{name:'Close',exact:true});
  await reachable(close,page); await page.screenshot({path:info.outputPath('slh-loading-320.png'),fullPage:true}); await close.click(); await expect(close).toBeDisabled();
  await page.screenshot({path:info.outputPath('slh-closing-320.png'),fullPage:true});
  await expect(page.getByText('Public fixture closed',{exact:true})).toHaveCount(0);
  await page.evaluate(() => window.__slhManagementFixture.release()); await expect(page.getByText('Public fixture closed',{exact:true})).toBeVisible();
  await page.goto('/?slh-fixture=failed&android'); await expect(page.getByText('Unavailable',{exact:true})).toBeVisible();
  await reachable(page.getByRole('button',{name:'Close',exact:true}),page); await page.screenshot({path:info.outputPath('slh-failure-320.png'),fullPage:true});
  await page.goto('/?slh-fixture=closing&android'); await page.getByRole('button',{name:'Use this method',exact:true}).click();
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await expect(page.getByText('Public fixture closed',{exact:true})).toHaveCount(0);
  await page.evaluate(() => window.__slhManagementFixture.release()); await expect(page.getByText('Public fixture closed',{exact:true})).toBeVisible();
});
test('exact SLH target review and uncertain submission preserve public binding at large text', async ({page},info) => {
  await page.goto('/?slh-fixture=review&android&font-scale=1.6'); await expect(page.getByRole('button',{name:'Authorize authenticator change',exact:true})).toBeVisible(); await largeText(page);
  await expect(page.getByText(`0x${'44'.repeat(16)}${'00'.repeat(16)}`,{exact:true})).toBeVisible();
  await expect(page.getByText(`0x${'33'.repeat(16)}${'00'.repeat(16)}`,{exact:true})).toBeVisible();
  await page.getByText(`0x${'33'.repeat(16)}${'00'.repeat(16)}`,{exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath('slh-review-target-320-large.png'),fullPage:true});
  await expect(page.getByText(/Pali wallet already configured/)).toHaveCount(0);
  const authorize = page.getByRole('button',{name:'Authorize authenticator change',exact:true}); await reachable(authorize,page);
  await page.screenshot({path:info.outputPath('slh-review-320-large.png'),fullPage:true}); await authorize.click();
  await expect(page.getByText(`0x${'ab'.repeat(32)}`,{exact:true})).toBeVisible();
  await expect(page.getByText('Check authenticator status',{exact:true})).toBeVisible(); await expect(authorize).toHaveCount(0);
  await page.screenshot({path:info.outputPath('slh-uncertain-320-large.png'),fullPage:true});
  await reachable(page.getByRole('button',{name:'Close',exact:true}),page);
});
