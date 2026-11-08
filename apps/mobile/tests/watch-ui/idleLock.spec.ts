import { test, expect, type Page } from '@playwright/test';
async function watch(page: Page) { await page.goto('/'); await page.getByRole('button',{name:'View my accounts',exact:true}).click(); }
async function native(page: Page, query = '') { await page.goto(`/${query}`); await page.getByRole('button',{name:'Accounts',exact:true}).click(); await page.getByRole('button',{name:'Open wallet',exact:true}).click(); await page.getByRole('textbox',{name:'Password',exact:true}).fill('public-password'); await page.getByRole('button',{name:'Unlock wallet',exact:true}).click(); await expect(page.getByRole('tab',{name:'Settings',exact:true})).toBeVisible(); }
async function settings(page: Page) { await page.getByRole('tab',{name:'Settings',exact:true}).click(); await page.getByRole('button',{name:'Auto-lock',exact:false}).click(); await expect(page.getByRole('heading',{name:'Auto-lock',exact:true})).toBeVisible(); }
test.beforeEach(async({page})=>{await page.route('**/*',async route=>{if(new URL(route.request().url()).origin!=='http://127.0.0.1:4182'){await route.abort();throw Error('Unexpected network');}await route.continue();});});
test('watch settings persist only their mode; native default remains five and Off preserves lifecycle hiding',async({page})=>{await watch(page);await settings(page);await page.getByRole('button',{name:'Off while open',exact:true}).click();await page.getByRole('button',{name:'I understand the Off setting',exact:true}).click();await page.getByRole('button',{name:'Save auto-lock',exact:true}).click();await expect(page.getByText('Auto-lock setting saved.',{exact:true})).toBeVisible();expect(JSON.parse((await page.evaluate(()=>window.__watchFixture.idle.value()))!)).toEqual({version:1,custodyIdleMinutes:5,watchIdleMinutes:0});await page.evaluate(()=>window.__watchFixture.lifecycle('background'));await page.evaluate(()=>window.__watchFixture.lifecycle('active'));await expect(page.getByRole('button',{name:'View my accounts',exact:true})).toBeVisible();await page.reload();await page.getByRole('button',{name:'View my accounts',exact:true}).click();await settings(page);await expect(page.getByText(/Current: Off while open/)).toBeVisible();});
test('native weakening needs fresh password while shortening does not reauthenticate',async({page})=>{await native(page);await settings(page);await page.getByRole('button',{name:'15 minutes',exact:true}).click();await expect(page.getByRole('button',{name:'Save auto-lock',exact:true})).toBeDisabled();await page.getByRole('textbox',{name:'Confirm auto-lock password',exact:true}).fill('public-password');await page.getByRole('button',{name:'Save auto-lock',exact:true}).click();await expect(page.getByText('Auto-lock setting saved.',{exact:true})).toBeVisible();expect((await page.evaluate(()=>window.__watchFixture.events())).filter(x=>x==='idle:auth')).toHaveLength(1);await page.getByRole('button',{name:'5 minutes',exact:true}).click();await page.getByRole('button',{name:'Save auto-lock',exact:true}).click();await expect(page.getByText(/Current: 5 minutes/)).toBeVisible();expect((await page.evaluate(()=>window.__watchFixture.events())).filter(x=>x==='idle:auth')).toHaveLength(1);});
test('expired watch input cannot renew the deadline and native idle lock clears secret presentation',async({page})=>{await watch(page);await page.evaluate(()=>window.__watchFixture.idle.elapse(300001));await page.getByRole('tab',{name:'Settings',exact:true}).click();await expect(page.getByRole('button',{name:'View my accounts',exact:true})).toBeVisible();await native(page);await page.evaluate(()=>{window.__watchFixture.idle.elapse(300001);window.__watchFixture.idle.fire();});await expect(page.getByRole('button',{name:'Unlock wallet',exact:true})).toBeVisible();await expect(page.getByRole('tab')).toHaveCount(0);});
test('security read failure gates opening without overwriting; retry recovers explicitly',async({page},testInfo)=>{await page.goto('/?security-read-failure=1');await expect(page.getByText('Security settings unavailable',{exact:true})).toBeVisible();await page.screenshot({path:testInfo.outputPath('security-preferences-unavailable.png'),fullPage:true});await expect(page.getByRole('button',{name:'View my accounts',exact:true})).toHaveCount(0);expect(await page.evaluate(()=>window.__watchFixture.idle.value())).toBeNull();await page.evaluate(()=>window.__watchFixture.idle.readFailure(false));await page.getByRole('button',{name:'Retry security settings',exact:true}).click();await expect(page.getByRole('button',{name:'View my accounts',exact:true})).toBeVisible();});
test('custom validation and cancelled drafts do not change durable preferences',async({page})=>{await watch(page);await settings(page);await page.getByRole('textbox',{name:'Auto-lock minutes',exact:true}).fill('4');await expect(page.getByRole('button',{name:'Save auto-lock',exact:true})).toBeDisabled();await page.getByRole('textbox',{name:'Auto-lock minutes',exact:true}).fill('55');await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(await page.evaluate(()=>window.__watchFixture.idle.value())).toBeNull();await settings(page);await expect(page.getByRole('textbox',{name:'Auto-lock minutes',exact:true})).toHaveValue('5');});
test('Android custom auto-lock remains editable in a compact large-text viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await native(page, '?android=1');
  await settings(page);
  await page.addStyleTag({ content: '[dir="auto"] { font-size:22px !important; line-height:1.45 !important; }' });
  const minutes = page.getByRole('textbox', { name: 'Auto-lock minutes', exact: true });
  await minutes.click();
  // A browser viewport change covers form reflow, not native IME qualification.
  await page.setViewportSize({ width: 320, height: 419 });
  await expect(minutes).toBeFocused();
  await minutes.fill('10');
  await expect(minutes).toHaveValue('10');
  const password = page.getByRole('textbox', { name: 'Confirm auto-lock password', exact: true });
  const save = page.getByRole('button', { name: 'Save auto-lock', exact: true });
  await expect(password).toBeEmpty();
  await expect(save).toBeDisabled();
  await password.fill('public-password');
  await save.click();
  await expect(page.getByText('Auto-lock setting saved.', { exact: true })).toBeVisible();
  expect((await page.evaluate(() => window.__watchFixture.events())).filter(event => event === 'idle:auth')).toHaveLength(1);
});
test('lost write acknowledgement hides the session and retry reads the saved setting',async({page})=>{await watch(page);await settings(page);await page.evaluate(()=>window.__watchFixture.idle.loseAck(true));await page.getByRole('button',{name:'15 minutes',exact:true}).click();await page.getByRole('button',{name:'Save auto-lock',exact:true}).click();await expect(page.getByText('Security settings unavailable',{exact:true})).toBeVisible();await page.evaluate(()=>window.__watchFixture.idle.loseAck(false));await page.getByRole('button',{name:'Retry security settings',exact:true}).click();await page.getByRole('button',{name:'View my accounts',exact:true}).click();await settings(page);await expect(page.getByText(/Current: 15 minutes/)).toBeVisible();});
test('idle cancels pending native weakening without clearing the old policy or reopening the session',async({page})=>{await native(page);await settings(page);await page.getByRole('button',{name:'15 minutes',exact:true}).click();await page.getByRole('textbox',{name:'Confirm auto-lock password',exact:true}).fill('public-password');await page.evaluate(()=>window.__watchFixture.delayUnlock(true));await page.getByRole('button',{name:'Save auto-lock',exact:true}).click();await expect(page.getByRole('button',{name:'Saving auto-lock…',exact:true})).toBeVisible();await page.evaluate(()=>{window.__watchFixture.idle.elapse(300001);window.__watchFixture.idle.fire();window.__watchFixture.releaseUnlock();});await expect(page.getByRole('button',{name:'Unlock wallet',exact:true})).toBeVisible();expect(await page.evaluate(()=>window.__watchFixture.idle.value())).toBeNull();});
test('locked native secret input is cleared by idle and user input renews only a current session',async({page})=>{await page.goto('/');await page.getByRole('button',{name:'Accounts',exact:true}).click();await page.getByRole('button',{name:'Open wallet',exact:true}).click();await page.getByRole('textbox',{name:'Password',exact:true}).fill('not-submitted');await page.evaluate(()=>{window.__watchFixture.idle.elapse(300001);window.__watchFixture.idle.fire();});await expect(page.getByRole('textbox',{name:'Password',exact:true})).toHaveValue('');await page.getByRole('textbox',{name:'Password',exact:true}).fill('public-password');await page.getByRole('button',{name:'Unlock wallet',exact:true}).click();await page.evaluate(()=>window.__watchFixture.idle.elapse(240000));await page.getByRole('tab',{name:'Settings',exact:true}).click();await page.evaluate(()=>{window.__watchFixture.idle.elapse(240000);window.__watchFixture.idle.fire();});await expect(page.getByRole('button',{name:'Auto-lock',exact:false})).toBeVisible();await page.evaluate(()=>{window.__watchFixture.idle.elapse(60001);window.__watchFixture.idle.fire();});await expect(page.getByRole('button',{name:'Unlock wallet',exact:true})).toBeVisible();});
test('narrow large-type settings, validation and saving states stay usable',async({page},testInfo)=>{await page.setViewportSize({width:320,height:720});await native(page);await settings(page);await page.getByRole('button',{name:'Off while open',exact:true}).click();await page.addStyleTag({content:'[dir="auto"] { font-size:22px !important; line-height:1.45 !important; }'});expect(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1)).toBe(false);await page.screenshot({path:testInfo.outputPath('native-auto-lock-large-type.png'),fullPage:true});await page.getByRole('button',{name:'I understand the Off setting',exact:true}).click();await page.getByRole('textbox',{name:'Confirm auto-lock password',exact:true}).fill('public-password');await page.evaluate(()=>window.__watchFixture.delayUnlock(true));await page.getByRole('button',{name:'Save auto-lock',exact:true}).click();await page.screenshot({path:testInfo.outputPath('native-auto-lock-saving.png'),fullPage:true});await page.evaluate(()=>window.__watchFixture.releaseUnlock());await expect(page.getByText('Auto-lock setting saved.',{exact:true})).toBeVisible();});
test('a fresh virtual activation reopens watch accounts after an expired pointer action',async({page})=>{
 await watch(page);await page.evaluate(()=>window.__watchFixture.idle.elapse(300001));
 await page.getByRole('tab',{name:'Settings',exact:true}).click();
 const reopen=page.getByRole('button',{name:'View my accounts',exact:true});await expect(reopen).toBeVisible();
 await reopen.dispatchEvent('click',{bubbles:true,detail:0});
 await expect(page.getByRole('tab',{name:'Settings',exact:true})).toBeVisible();
});
test('changing the timeout clears the previous password and requires new entry',async({page},testInfo)=>{
 await native(page);await settings(page);await page.getByRole('button',{name:'15 minutes',exact:true}).click();
 const password=page.getByRole('textbox',{name:'Confirm auto-lock password',exact:true}),save=page.getByRole('button',{name:'Save auto-lock',exact:true});
 await password.fill('public-password');await page.getByRole('button',{name:'5 minutes',exact:true}).click();await expect(password).toHaveCount(0);
 await page.getByRole('button',{name:'15 minutes',exact:true}).click();await expect(password).toHaveValue('');await expect(save).toBeDisabled();
 await password.fill('public-password');await page.getByRole('button',{name:'30 minutes',exact:true}).click();await expect(password).toHaveValue('');await expect(save).toBeDisabled();
 expect((await page.evaluate(()=>window.__watchFixture.events())).filter(x=>x==='idle:auth')).toHaveLength(0);
 await page.screenshot({path:testInfo.outputPath('changed-timeout-clears-password.png'),fullPage:true});
 await password.fill('public-password');await save.click();await expect(page.getByText('Auto-lock setting saved.',{exact:true})).toBeVisible();
 expect((await page.evaluate(()=>window.__watchFixture.events())).filter(x=>x==='idle:auth')).toHaveLength(1);
});

for (const viewport of [{ width: 320, height: 640 }, { width: 393, height: 852 }]) {
  test(`preset labels stay complete and stable at ${viewport.width} pixels`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await native(page);
    await settings(page);
    const titles = ['5 minutes', '15 minutes', '30 minutes', '60 minutes', '120 minutes', 'Off while open'];
    const preset = (title: string) => page.getByRole('button', { name: title, exact: true });
    const stored = await page.evaluate(() => window.__watchFixture.idle.value());

    const verifyLabels = async () => {
      const dimensions = [];
      for (const title of titles) {
        const button = preset(title);
        await button.scrollIntoViewIfNeeded();
        const label = button.getByText(title, { exact: true });
        await expect(label).toBeVisible();
        const bounds = await button.boundingBox();
        const textBounds = await label.boundingBox();
        expect(bounds).not.toBeNull();
        expect(textBounds).not.toBeNull();
        expect(textBounds!.width).toBeLessThanOrEqual(bounds!.width);
        expect(textBounds!.height).toBeLessThanOrEqual(bounds!.height);
        expect(textBounds!.y).toBeGreaterThanOrEqual(bounds!.y);
        expect(textBounds!.y + textBounds!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height);
        expect(await label.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
        expect(await label.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
        dimensions.push({ width: bounds!.width, height: bounds!.height });
      }
      const widths = dimensions.map(dimension => dimension.width);
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
      return dimensions;
    };

    const initialDimensions = await verifyLabels();
    await preset('15 minutes').click();
    expect(await verifyLabels()).toEqual(initialDimensions);
    await preset('5 minutes').click();
    expect(await verifyLabels()).toEqual(initialDimensions);
    await page.addStyleTag({ content: '[dir="auto"] { font-size: 22px !important; line-height: 1.45 !important; }' });
    const largeTextDimensions = await verifyLabels();
    await preset('15 minutes').click();
    expect(await verifyLabels()).toEqual(largeTextDimensions);
    expect(await page.evaluate(() => window.__watchFixture.idle.value())).toBe(stored);
  });
}
