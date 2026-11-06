import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4179' });

test('network picker shows scope and passes both captured revisions to selection', async ({ page }) => {
  await page.goto('/?networks=1');
  await expect(page.getByRole('radio', { checked: true })).toHaveAccessibleName('Ethereum, ETH, Chain ID 1');
  await expect(page.getByText('Test networks', { exact: true })).toBeVisible();
  await expect(page.getByText('Balance and receive only')).toHaveCount(0);
  await page.getByRole('radio', { name: 'Base, ETH, Chain ID 8453', exact: true }).click();
  await expect(page.getByRole('radio', { checked: true })).toHaveAccessibleName('Base, ETH, Chain ID 8453');
  expect(await page.evaluate(() => window.__nativeNetworksFixture.requests())).toEqual([
    { id: 'base', contextRevision: 19, catalogueRevision: 4 },
  ]);
});

test('search distinguishes test networks and leaves selection unchanged for no results', async ({ page }) => {
  await page.goto('/?networks=1');
  await page.getByLabel('Search networks', { exact: true }).fill('tsys');
  await expect(page.getByRole('radio')).toHaveCount(2);
  await expect(page.getByRole('radio', { name: /test network/ })).toHaveCount(2);
  await page.getByLabel('Search networks', { exact: true }).fill('missing');
  await expect(page.getByText('No matching networks', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeNetworksFixture.requests())).toEqual([]);
  expect(await page.evaluate(() => window.__nativeNetworksFixture.selected())).toBe('ethereum');
});

test('duplicate taps and context replacement cannot revive a pending selection', async ({ page }) => {
  await page.goto('/?networks=1&hold=1');
  await page.getByRole('radio', { name: 'Base, ETH, Chain ID 8453', exact: true }).click();
  await expect(page.getByText('Switching networks…', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Base, ETH, Chain ID 8453', exact: true })).toBeDisabled();
  await page.evaluate(() => { window.__nativeNetworksFixture.replace(); window.__nativeNetworksFixture.release(); });
  await expect(page.getByText('Switching networks…', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__nativeNetworksFixture.requests())).toHaveLength(1);
  await expect(page.getByRole('radio', { checked: true })).toHaveAccessibleName('Ethereum, ETH, Chain ID 1');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('back cancels a held network operation without applying a late result', async ({ page }) => {
  await page.goto('/?networks=1&hold=1');
  await page.getByRole('radio', { name: 'Base, ETH, Chain ID 8453', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByText('Picker closed', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__nativeNetworksFixture.release());
  expect(await page.evaluate(() => window.__nativeNetworksFixture.cancelled())).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__nativeNetworksFixture.selected())).toBe('ethereum');
});

test('busy rejection is visible and the narrow screen has no horizontal overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/?networks=1&busy=1');
  await page.getByRole('radio', { name: 'Base, ETH, Chain ID 8453', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Wait for the current wallet operation');
  await expect(page.getByRole('radio', { checked: true })).toHaveAccessibleName('Ethereum, ETH, Chain ID 1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('native-network-picker.png'), fullPage: true });
});


test('replacing a controller retires its work without blocking or clearing newer work', async ({ page }) => {
  await page.goto('/?networks=1&hold=1');
  await page.getByRole('radio', { name: 'Base, ETH, Chain ID 8453', exact: true }).click();
  await expect(page.getByText('Switching networks…', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__nativeNetworksFixture.replaceController());
  await expect(page.getByText('Switching networks…', { exact: true })).toHaveCount(0);
  const rollux = page.getByRole('radio', { name: 'Rollux, SYS, Chain ID 570', exact: true });
  await expect(rollux).toBeEnabled();
  await rollux.click();
  await expect(page.getByText('Switching networks…', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__nativeNetworksFixture.release());
  await expect(page.getByText('Switching networks…', { exact: true })).toBeVisible();
  await expect(rollux).toBeDisabled();
  await page.evaluate(() => window.__nativeNetworksFixture.releaseReplacement());
  await expect(page.getByText('Switching networks…', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('radio', { checked: true })).toHaveAccessibleName('Rollux, SYS, Chain ID 570');
});


test('returning to a retired controller cannot revive its busy state', async ({ page }) => {
  await page.goto('/?networks=1&hold=1');
  const base = page.getByRole('radio', { name: 'Base, ETH, Chain ID 8453', exact: true });
  await base.click();
  await expect(page.getByText('Switching networks…', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__nativeNetworksFixture.replaceController());
  await expect(page.getByText('Switching networks…', { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.__nativeNetworksFixture.restoreController());
  await expect(base).toBeEnabled();
  await expect(page.getByText('Switching networks…', { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.__nativeNetworksFixture.release());
  await expect(base).toBeEnabled();
  await expect(page.getByRole('radio', { checked: true })).toHaveAccessibleName('Ethereum, ETH, Chain ID 1');
});

test('custom EVM network form saves the supplied name and chain on a narrow screen', async ({ page }, testInfo) => {
  await page.goto('/?networks=1');
  await page.getByRole('button', { name: 'Add network', exact: true }).click();
  await page.getByLabel('Network name', { exact: true }).fill('Custom EVM test');
  await page.getByLabel('RPC URL', { exact: true }).fill('https://custom.example/rpc');
  await page.getByLabel('Chain ID', { exact: true }).fill('123456');
  await page.getByLabel('Currency symbol', { exact: true }).fill('GAS');
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('custom-network-form.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save network', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Custom EVM test, GAS, Chain ID 123456', exact: true })).toBeVisible();
});

test('long network labels and symbols retain padding at 320px with large text', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/?networks=1');
  await page.addStyleTag({ content: '[dir="auto"] { font-size: 200% !important; line-height: 1.35 !important; } input { font-size: 32px !important; }' });
  await page.getByRole('button', { name: 'Add network', exact: true }).click();
  const name = `  ${'Long network '.repeat(8)}  `;
  const symbol = ` ${'x'.repeat(32)} `;
  await page.getByLabel('Network name', { exact: true }).fill(name);
  await page.getByLabel('RPC URL', { exact: true }).fill('https://custom.example/rpc');
  await page.getByLabel('Chain ID', { exact: true }).fill('123456');
  const symbolInput = page.getByLabel('Currency symbol', { exact: true });
  await symbolInput.fill(symbol);
  await expect(symbolInput).toHaveValue(symbol.toUpperCase());
  await expect(page.getByLabel('Network name', { exact: true })).toHaveValue(name);
  await expect(page.getByLabel('Network name', { exact: true })).not.toHaveAttribute('maxlength');
  await expect(symbolInput).not.toHaveAttribute('maxlength');
  await page.getByRole('button', { name: 'Save network', exact: true }).click();
  const stored = await page.evaluate(() => window.__nativeNetworksFixture.registration('custom:123456'));
  expect(stored?.name).toBe(name);
  expect(stored?.symbol).toBe(symbol.toUpperCase());
  const edit = page.getByRole('button', { name: /^Edit +Long network/ });
  await expect(edit).toBeVisible();
  await edit.scrollIntoViewIfNeeded();
  await expect(edit).toBeInViewport();
  await expect(page.getByText('Chain ID 123456', { exact: true })).toBeInViewport();
  expect(await page.getByText(name.trim(), { exact: true }).evaluate((element) => getComputedStyle(element).webkitLineClamp)).toBe('2');
  expect(await page.getByText(symbol.trim().toUpperCase(), { exact: true }).evaluate((element) => getComputedStyle(element).webkitLineClamp)).toBe('2');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('long-network-large-type.png'), fullPage: true });
  await edit.click();
  await expect(page.getByLabel('Network name', { exact: true })).toHaveValue(name);
  await expect(symbolInput).toHaveValue(symbol.toUpperCase());
  await page.getByLabel('Network name', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('long-network-form-large-type.png'), fullPage: true });
});

test('identical network names and symbols have distinct spoken selection and edit labels', async ({ page }) => {
  await page.goto('/?networks=1');
  for (const chainId of ['31337', '31338']) {
    await page.getByRole('button', { name: 'Add network', exact: true }).click();
    await page.getByLabel('Network name', { exact: true }).fill('Shared network');
    await page.getByLabel('RPC URL', { exact: true }).fill(`https://custom.example/${chainId}`);
    await page.getByLabel('Chain ID', { exact: true }).fill(chainId);
    await page.getByLabel('Currency symbol', { exact: true }).fill('ABC');
    await page.getByRole('button', { name: 'Save network', exact: true }).click();
  }
  for (const chainId of ['31337', '31338']) {
    await expect(page.getByRole('radio', { name: `Shared network, ABC, Chain ID ${chainId}`, exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: `Edit Shared network, Chain ID ${chainId}`, exact: true })).toHaveCount(1);
  }
  await page.getByRole('button', { name: 'Edit Shared network, Chain ID 31338', exact: true }).click();
  await expect(page.getByLabel('Chain ID', { exact: true })).toHaveValue('31338');
  await expect(page.getByLabel('Network name', { exact: true })).toHaveValue('Shared network');
});

test('Add network searches once, fills an editable draft by keyboard, and saves only on consent', async ({ page }, testInfo) => {
  await page.route('**/*', (route) => new URL(route.request().url()).origin === 'http://127.0.0.1:4179'
    ? route.continue() : route.abort());
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/?networks=1&catalogue=held');
  await page.addStyleTag({ content: '[dir="auto"] { font-size: 200% !important; line-height: 1.35 !important; } input { font-size: 32px !important; }' });
  await page.getByRole('button', { name: 'Add network', exact: true }).click();
  const search = page.getByLabel('Find a network', { exact: true });
  expect(await page.evaluate(() => window.__nativeNetworksFixture.catalogueRequests())).toBe(0);
  await search.fill('Ex');
  await expect(page.getByText('Searching networks…', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('network-search-loading-320.png') });
  await search.fill('missing');
  await page.evaluate(() => window.__nativeNetworksFixture.releaseCatalogue());
  await expect(page.getByText('No matching networks. Enter network details below.')).toBeVisible();
  await search.fill('Example');
  const suggestion = page.getByRole('button', { name: /^Use Example test network/ });
  await expect(suggestion).toBeVisible();
  await expect(page.getByText('Example incompatible network')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('network-search-results-320.png') });
  await suggestion.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('RPC URL', { exact: true })).toHaveValue('https://preferred.example/rpc');
  await expect(page.getByLabel('Chain ID', { exact: true })).toHaveValue('31337');
  await expect(page.getByRole('checkbox', { name: 'This is a test network' })).toBeChecked();
  expect(await page.evaluate(() => [window.__nativeNetworksFixture.catalogueRequests(), window.__nativeNetworksFixture.saveRequests()])).toEqual([1, 0]);
  await page.getByLabel('RPC URL', { exact: true }).fill('https://edited.example/rpc');
  await page.getByLabel('Network name', { exact: true }).fill('Edited example');
  await page.getByRole('button', { name: 'Save network', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Edited example, EX, Chain ID 31337, test network', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeNetworksFixture.registration('custom:31337')?.rpcUrl)).toBe('https://edited.example/rpc');
  expect(await page.evaluate(() => window.__nativeNetworksFixture.selected())).toBe('ethereum');
});

test('unavailable catalogue keeps manual Add available without reissuing search', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 680 });
  await page.goto('/?networks=1&catalogue=offline');
  await page.getByRole('button', { name: 'Add network', exact: true }).click();
  const search = page.getByLabel('Find a network', { exact: true });
  await search.fill('Example');
  await expect(page.getByText('Search unavailable. Enter network details below.')).toBeVisible();
  await search.fill('Other');
  expect(await page.evaluate(() => window.__nativeNetworksFixture.catalogueRequests())).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('network-search-unavailable-320.png') });
  await page.getByLabel('Network name', { exact: true }).fill('Manual network');
  await expect(page.getByText('Search unavailable. Enter network details below.')).toHaveCount(0);
  await page.getByLabel('RPC URL', { exact: true }).fill('https://manual.example/rpc');
  await page.getByLabel('Chain ID', { exact: true }).fill('31415');
  await page.getByLabel('Currency symbol', { exact: true }).fill('MAN');
  await page.getByRole('button', { name: 'Save network', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Manual network, MAN, Chain ID 31415', exact: true })).toBeVisible();
});

test('catalogue recovers only when Retry is pressed after a failed search', async ({ page }) => {
  await page.goto('/?networks=1&catalogue=retry');
  await page.getByRole('button', { name: 'Add network', exact: true }).click();
  const search = page.getByLabel('Find a network', { exact: true });
  await search.fill('Example');
  const retry = page.getByRole('button', { name: 'Retry search', exact: true });
  await expect(retry).toBeVisible();
  await search.fill('');
  await search.fill('Example');
  await expect(retry).toBeVisible();
  expect(await page.evaluate(() => window.__nativeNetworksFixture.catalogueRequests())).toBe(1);
  await retry.click();
  await expect(page.getByRole('button', { name: /^Use Example test network/ })).toBeVisible();
  await expect(retry).toHaveCount(0);
  expect(await page.evaluate(() => window.__nativeNetworksFixture.catalogueRequests())).toBe(2);
});

test('Back retires held catalogue feedback and save errors before the next draft', async ({ page }) => {
  await page.goto('/?networks=1&catalogue=held&holdSave=1');
  const add = page.getByRole('button', { name: 'Add network', exact: true });
  const back = page.getByRole('button', { name: 'Back', exact: true });
  await add.click();
  await page.getByLabel('Find a network', { exact: true }).fill('Example');
  await expect(page.getByText('Searching networks…', { exact: true })).toBeVisible();
  await back.click();
  await add.click();
  await page.getByLabel('Network name', { exact: true }).fill('Next draft');
  await page.evaluate(() => window.__nativeNetworksFixture.releaseCatalogue());
  await expect(page.getByText('Searching networks…', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Use Example/ })).toHaveCount(0);
  await page.getByLabel('RPC URL', { exact: true }).fill('https://manual.example/rpc');
  await page.getByLabel('Chain ID', { exact: true }).fill('31415');
  await page.getByLabel('Currency symbol', { exact: true }).fill('MAN');
  await page.getByRole('button', { name: 'Save network', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Checking network…', exact: true })).toBeVisible();
  await back.click();
  await add.click();
  await page.evaluate(() => window.__nativeNetworksFixture.releaseSave());
  await expect(page.getByLabel('Network name', { exact: true })).toHaveValue('');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save network', exact: true })).toBeEnabled();
});


test('custom UTXO settings verify another URL and rename without changing the saved route', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/?networks=1&utxo=1');
  await page.getByRole('button', { name: 'Edit Custom Litecoin', exact: true }).click();
  await expect(page.getByText('https://litecoin.example/blockbook', { exact: true })).toBeVisible();
  await expect(page.getByLabel('URL to check')).toHaveCount(0);
  await page.getByRole('button', { name: 'Check another URL' }).click();
  await page.getByLabel('URL to check').fill('https://wrong.example/blockbook');
  await page.getByRole('button', { name: 'Verify URL' }).click();
  await expect(page.getByRole('alert')).toContainText('Could not verify this URL');
  await page.getByLabel('URL to check').fill('https://replacement.example/blockbook');
  await page.getByRole('button', { name: 'Verify URL' }).click();
  await expect(page.getByText('Same network verified.')).toBeVisible();
  await expect(page.getByText('https://litecoin.example/blockbook', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('native-utxo-network-settings.png'), fullPage: true });
  await page.getByLabel('Network name', { exact: true }).fill('Personal Litecoin');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Personal Litecoin', exact: true }).click();
  await expect(page.getByText('https://litecoin.example/blockbook', { exact: true })).toBeVisible();
  await expect(page.getByText('Same network verified.')).toHaveCount(0);
});
