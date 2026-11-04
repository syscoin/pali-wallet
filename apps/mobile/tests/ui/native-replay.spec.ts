import { expect, test } from '@playwright/test';

test.use({
  baseURL: process.env.PALI_NATIVE_SEND_UI_URL ?? 'http://127.0.0.1:4179',
});
test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' || !['4179', '4181'].includes(url.port)) {
      await route.abort();
      throw new Error(`Unexpected external request: ${url.origin}`);
    }
    await route.continue();
  });
});
for (const width of [390, 320]) test(`saved predecessor replay is explicit at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({width,height:844});
  await page.goto('/?erc20-send');
  await page.waitForFunction(() => !!window.__erc20SendFixture);
  const hashes=await page.evaluate(()=>window.__erc20SendFixture.seedPredecessor());
  if(width===320)await page.evaluate(()=>{
    for(const node of Array.from(document.querySelectorAll<HTMLElement>('[dir="auto"]'))){
      const style=getComputedStyle(node);node.style.fontSize=`${parseFloat(style.fontSize)*2}px`;node.style.lineHeight=`${parseFloat(style.lineHeight)*2}px`;
    }
  });
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await expect(page.getByText('PREVIOUS TRANSACTION · NONCE 0')).toBeVisible();
  await expect(page.getByTestId('native-send-recipient')).toHaveText('Contract creation');
  expect(await page.evaluate(()=>window.__erc20SendFixture.broadcasts().length)).toBe(0);
  await page.screenshot({path:testInfo.outputPath(`native-replay-${width}.png`),fullPage:true});
  await page.getByRole('button',{name:`Transaction ${hashes.first.slice(0,10)}…`,exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath(`native-replay-gap-${width}.png`),fullPage:true});
  await page.getByRole('button',{name:`Transaction ${hashes.first.slice(0,10)}…`,exact:true}).click();
  await expect(page.getByText(hashes.first,{exact:true})).toBeVisible();
  await expect(page.getByTestId('native-send-confirm')).toHaveText('Resend signed transaction');
  expect(await page.evaluate(()=>window.__erc20SendFixture.broadcasts().length)).toBe(0);
  await page.getByTestId('native-send-confirm').click();
  await expect(page.getByTestId('native-send-hash')).toHaveText(hashes.first);
  expect(await page.evaluate(()=>window.__erc20SendFixture.broadcasts().length)).toBe(1);
  expect(await page.evaluate(()=>window.__erc20SendFixture.signatures())).toBe(0);
});

test('older same-nonce alternatives remain reachable through local pagination',async({page})=>{
 await page.goto('/?erc20-send');await page.waitForFunction(()=>!!window.__erc20SendFixture);
 const hashes=await page.evaluate(()=>window.__erc20SendFixture.seedPredecessor(22));
 const oldest=page.getByRole('button',{name:`Transaction ${hashes.first.slice(0,10)}…`,exact:true});
 await expect(oldest).toHaveCount(0);
 const before=await page.evaluate(()=>window.__erc20SendFixture.rpcMethods().length);
 await page.getByRole('button',{name:'Load more saved transactions',exact:true}).click();
 await expect(oldest).toBeVisible();
 expect(await page.evaluate(()=>window.__erc20SendFixture.rpcMethods().length)).toBe(before);
 await oldest.click();await expect(page.getByText(hashes.first,{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__erc20SendFixture.broadcasts().length)).toBe(0);
});
