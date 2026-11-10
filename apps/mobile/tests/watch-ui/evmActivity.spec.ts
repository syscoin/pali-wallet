import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window {
    __evmDelayedCopy: { calls: string[]; release(): void };
  }
}

const OWNER = '0x52908400098527886E0F7030069857D2E4169EE7';
const SECOND = '0x1111111111111111111111111111111111111111';
const LARGE = '123456789012345678901234567890123456';
const hash = (owner: string, index: number) =>
  `0x${owner.slice(2).toLowerCase().padEnd(60, '0')}${index
    .toString(16)
    .padStart(4, '0')}`;
const row = (page: Page, owner: string, index: number) =>
  page.getByTestId(`activity-row-${hash(owner, index)}`);
async function open(page: Page, mode = 'value', android = false, tokenMetadata?: string) {
  await page.goto(
    `/?evm-activity=1&evm-activity-mode=${mode}${android ? '&android=1' : ''}${tokenMetadata ? '&token-metadata='+tokenMetadata : ''}`
  );
  await page
    .getByRole('button', { name: 'View my accounts', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Activity', exact: true })
  ).toBeVisible();
}
async function loaded(page: Page, owner = OWNER) {
  await expect(row(page, owner, 1)).toHaveAccessibleName(/^1\.000000000000000001 ETH, Confirmed\./);
  await expect(row(page, owner, 1)).toContainText('Confirmed');
  await expect(row(page, owner, 3)).toHaveAccessibleName(new RegExp(`^${LARGE} RAW,`));
}
async function noSigning(page: Page) {
  await expect(
    page.getByRole('button', {
      name: /Review resend|Confirm and send|Unlock wallet/,
    })
  ).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: /password/i })).toHaveCount(0);
  const audit = await page.evaluate(() => window.__watchFixture.audit());
  expect(audit.unlocks).toBe(0);
  expect(audit.signs).toBe(0);
  expect(audit.broadcasts).toBe(0);
  expect(
    await page.evaluate(() => window.__watchFixture.evmActivity.denied())
  ).toEqual([]);
}
async function network(page: Page, name: string) {
  await page.getByRole('tab', { name: 'Wallet', exact: true }).click();
  await page.getByRole('button', { name: /^Network/ }).click();
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
}

test('compact activity amounts fit narrow rows while their accessible labels retain exact values', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await open(page);
  const item = row(page, OWNER, 3);
  await expect(item).toHaveAccessibleName(new RegExp(`^${LARGE} RAW,`));
  const amount = item.getByText('≈+1.23456e+35 RAW', { exact: true });
  await expect(amount).toBeVisible();
  expect(await amount.evaluate(element => {
    const row = element.closest('[role="button"]')!;
    const outer = row.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(element);
    return Array.from(range.getClientRects()).every(rect => rect.left >= outer.left - 1 && rect.right <= outer.right + 1);
  })).toBe(true);
});

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin !== 'http://127.0.0.1:4182') {
      await route.abort('blockedbyclient');
      throw Error('Unexpected live request in EVM watch Activity');
    }
    await route.continue();
  });
});

test('real watch Activity renders indexed native and ERC20 amounts without eager RPC or signing', async ({
  page,
  context,
}, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  await loaded(page);
  const initial = await page.evaluate(() =>
    window.__watchFixture.evmActivity.calls()
  );
  expect(initial.map((call) => call.method).sort()).toEqual([
    'tokentx',
    'txlist',
  ]);
  await expect(row(page, OWNER, 5)).toContainText('Pending');
  await expect(row(page, OWNER, 6)).toContainText('Reverted');
  await expect(
    row(page, OWNER, 4)
  ).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'All', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Activity options', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'Show zero-value token activity',
      exact: true,
    })
    .click();
  await expect(row(page, OWNER, 4)).toContainText('0 RAW');
  await row(page, OWNER, 3).click();
  await expect(
    page.getByRole('heading', { name: 'Transaction details', exact: true })
  ).toBeVisible();
  await expect(
    page.getByText(`Raw token units: ${LARGE}`, { exact: true }).first()
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Copy event recipient', exact: true })
    .click();
  await expect(
    page.getByText('Copy this address?', { exact: true })
  ).toBeVisible();
  await expect(page.getByText(OWNER, { exact: true }).last()).toBeVisible();
  await page
    .getByRole('button', { name: 'Copy full address', exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(OWNER);
  await page
    .getByRole('button', { name: 'View on explorer', exact: true })
    .click();
  expect(
    await page.evaluate(() => window.__watchFixture.evmActivity.opened())
  ).toEqual([`https://etherscan.io/tx/${hash(OWNER, 3)}`]);
  await page.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('evm-watch-token-details.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Activity', exact: true })
  ).toBeVisible();
  await noSigning(page);
});

test('selected detail wrong chain preserves indexed facts and feed failure remains retryable', async ({
  page,
}) => {
  await open(page, 'wrong-chain');
  await loaded(page);
  expect(
    (await page.evaluate(() => window.__watchFixture.evmActivity.calls()))
      .map((call) => call.method)
      .sort()
  ).toEqual(['tokentx', 'txlist']);
  await row(page, OWNER, 1).click();
  await expect(
    page.getByRole('heading', { name: 'Transaction details', exact: true })
  ).toBeVisible();
  await expect(
    page
      .getByText('1.000000000000000001 ETH', { exact: true })
      .filter({ visible: true })
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__watchFixture.evmActivity
            .calls()
            .filter((call) => call.method === 'eth_chainId').length
      )
    )
    .toBe(1);
  await expect(
    page.getByText('Actual fee not verified', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Confirmed', { exact: true }).filter({ visible: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.evaluate(() => window.__watchFixture.evmActivity.mode('error'));
  await page
    .getByRole('button', { name: 'Refresh activity', exact: true })
    .click();
  await expect(
    page.getByText('Some activity is unavailable', { exact: true })
  ).toBeVisible();
  await expect(row(page, OWNER, 1)).toBeVisible();
  await page.evaluate(() => window.__watchFixture.evmActivity.mode('value'));
  await page
    .getByRole('button', { name: 'Refresh activity', exact: true })
    .click();
  await loaded(page);
  await noSigning(page);
});

test('Base and Arbitrum report missing discovery without inventing a watch history', async ({
  page,
}) => {
  await open(page);
  await loaded(page);
  for (const name of ['Base', 'Arbitrum One']) {
    await network(page, name);
    await expect(
      page.getByText('Activity discovery is unavailable for this network.', {
        exact: true,
      })
    ).toBeVisible();
    await expect(
      row(page, OWNER, 1)
    ).toHaveCount(0);
    await expect(page.getByText(/Saved transfers only/)).toHaveCount(0);
  }
  await noSigning(page);
});

test('late old-account requests cannot populate a newly added public account', async ({
  page,
}) => {
  await open(page);
  await loaded(page);
  const before = await page.evaluate(
    () => window.__watchFixture.evmActivity.calls().length
  );
  await page.evaluate(() => window.__watchFixture.evmActivity.mode('slow'));
  await page
    .getByRole('button', { name: 'Refresh activity', exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => window.__watchFixture.evmActivity.calls().length)
    )
    .toBeGreaterThan(before);
  await page.getByRole('tab', { name: 'Wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await page
    .getByRole('button', { name: 'Watch an account', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Account name', exact: true })
    .fill('Second public account');
  await page
    .getByRole('textbox', { name: 'Public EVM address', exact: true })
    .fill(SECOND);
  await page
    .getByRole('button', { name: 'Review account', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Confirm watch account', exact: true })
    .click();
  await page.evaluate(() => window.__watchFixture.evmActivity.release());
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await loaded(page, SECOND);
  await expect(
    row(page, OWNER, 1)
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__watchFixture.evmActivity.cancelled())
  ).toBeGreaterThan(0);
  await noSigning(page);
});

test('background and Android blur revoke Activity without unlocking a signing wallet', async ({
  page,
}) => {
  await open(page, 'value', true);
  await loaded(page);
  await page.evaluate(() => window.__watchFixture.evmActivity.mode('slow'));
  await page
    .getByRole('button', { name: 'Refresh activity', exact: true })
    .click();
  await page.evaluate(() => window.__watchFixture.blur());
  await expect(
    page.getByRole('button', { name: 'View my accounts', exact: true })
  ).toBeVisible();
  await expect(
    row(page, OWNER, 1)
  ).toHaveCount(0);
  await page.evaluate(() => window.__watchFixture.evmActivity.release());
  const stopped = await page.evaluate(
    () => window.__watchFixture.evmActivity.calls().length
  );
  await page.evaluate(() => window.__watchFixture.lifecycle('active'));
  expect(
    await page.evaluate(() => window.__watchFixture.evmActivity.calls().length)
  ).toBe(stopped);
  await page
    .getByRole('button', { name: 'View my accounts', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await loaded(page);
  await noSigning(page);
});

test('320px large-text Activity keeps keyboard detail and address copy navigation usable', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await open(page);
  await loaded(page);
  await page.addStyleTag({
    content:
      '[dir="auto"] { font-size: 22px !important; line-height: 1.4 !important; } [data-testid^="main-tab-caption-"] { font-size: 15px !important; }',
  });
  const first = row(page, OWNER, 1);
  await first.scrollIntoViewIfNeeded();
  await page.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('evm-watch-activity-320.png'),
    fullPage: true,
  });
  await first.focus();
  await first.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Transaction details', exact: true })
  ).toBeVisible();
  await expect(
    page
      .getByText('1.000000000000000001 ETH', { exact: true })
      .filter({ visible: true })
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Copy sender address', exact: true })
    .click();
  await expect(page.getByText(OWNER, { exact: true }).last()).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth)
  ).toBeLessThanOrEqual(320);
  await page.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('evm-watch-copy-320.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Activity', exact: true })
  ).toBeVisible();
  await noSigning(page);
});

test('shared filters survive tab navigation without mixing received and sent rows', async ({
  page,
}) => {
  await open(page);
  await loaded(page);
  await page.getByRole('tab', { name: 'Received', exact: true }).click();
  await expect(row(page, OWNER, 2)).toBeVisible();
  await expect(
    row(page, OWNER, 1)
  ).toHaveCount(0);
  await page.getByRole('tab', { name: 'Tools', exact: true }).click();
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await expect(row(page, OWNER, 2)).toBeVisible();
  await expect(
    row(page, OWNER, 1)
  ).toHaveCount(0);
  await noSigning(page);
});

test('same-address network change closes old details and pending copy feedback', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  await loaded(page);
  await row(page, OWNER, 1).click();
  await expect(
    page.getByRole('heading', { name: 'Transaction details', exact: true })
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Copy sender address', exact: true })
    .click();
  await expect(
    page.getByText('Copy this address?', { exact: true })
  ).toBeVisible();
  await page.evaluate(() => {
    const delayed = (window.__evmDelayedCopy = {
      calls: [] as string[],
      release: () => undefined as void,
    });
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: (value: string) => {
        delayed.calls.push(value);
        return new Promise<void>((resolve) => {
          delayed.release = resolve;
        });
      },
    });
  });
  await page
    .getByRole('button', { name: 'Copy full address', exact: true })
    .click();
  expect(await page.evaluate(() => window.__evmDelayedCopy.calls)).toEqual([
    OWNER,
  ]);
  await page.evaluate(() => window.__watchFixture.selectWatchNetwork('rollux'));
  // The existing shell deliberately returns to Wallet when network identity changes.
  await expect(
    page.getByRole('heading', { name: 'Wallet', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Network Rollux', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Transaction details', exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByText('Copy this address?', { exact: true })
  ).toHaveCount(0);
  await page.evaluate(() => window.__evmDelayedCopy.release());
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await expect(
    page.getByText('Address copied. Verify it again before sending funds.', {
      exact: true,
    })
  ).toHaveCount(0);
  await expect(row(page, OWNER, 1)).toHaveAccessibleName(/^1\.000000000000000001 SYS, Confirmed\./);
  await expect(row(page, OWNER, 1)).toContainText('Confirmed');
  expect(await page.evaluate(() => window.__evmDelayedCopy.calls)).toEqual([
    OWNER,
  ]);
  expect(
    (await page.evaluate(() => window.__watchFixture.evmActivity.calls())).some(
      (call) => call.url === 'https://rpc.rollux.com'
    )
  ).toBe(false);
  expect(
    (await page.evaluate(() => window.__watchFixture.evmActivity.calls())).some(
      (call) =>
        new URL(call.url).searchParams.get('address') === OWNER &&
        call.method === 'txlist'
    )
  ).toBe(true);
  await noSigning(page);
});

for (const mode of ['missing','invalid','malformed']) test(`watch ${mode} token metadata never displays raw units as a human amount`, async ({page}, testInfo) => {
  await open(page,'value',false,mode);
  const item=row(page,OWNER,3), amount=mode==='malformed'?'? RAW':'RAW transfer';
  await expect(item).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('watch-'+mode+'-list.png')});
  await expect(item).toContainText(amount);
  await expect(item).not.toContainText(LARGE+' RAW');
  await item.click();
  await expect(page.getByText(amount,{exact:true}).last()).toBeVisible();
  await expect(page.getByText(mode==='malformed'?'Raw token units: Unavailable':'Raw token units: '+LARGE,{exact:true}).first()).toBeVisible();
});


for (const mode of ['token-placeholder', 'mixed-case']) test(`public watch Activity preserves both transaction hashes for ${mode} history`, async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page, mode);
  for (const index of [3, 7]) {
    await expect(row(page, OWNER, index)).toBeVisible();
    await expect(row(page, OWNER, index)).toContainText('Confirmed');
  }
  expect((await page.evaluate(() => window.__watchFixture.evmActivity.calls())).map(call => call.method).sort()).toEqual(
    mode === 'mixed-case' ? ['tokentx', 'tokentx', 'txlist'] : ['tokentx', 'txlist']);
  await expect(page.getByText(/One activity feed is unavailable|Activity could not be fully loaded/)).toHaveCount(0);
  await noSigning(page);
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`watch-${mode}.png`), fullPage: true });
  expect(errors).toEqual([]);
});
