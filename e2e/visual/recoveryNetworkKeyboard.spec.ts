import { expect, test, type Locator } from '@playwright/test';

import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const exposed = (locator: Locator) =>
  locator.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return (
      bounds.left >= 0 &&
      bounds.top >= 0 &&
      bounds.right <= innerWidth &&
      bounds.bottom <= innerHeight &&
      bounds.width > 0 &&
      bounds.height > 0 &&
      [
        [bounds.left + 2, bounds.top + bounds.height / 2],
        [bounds.right - 2, bounds.top + bounds.height / 2],
        [bounds.left + bounds.width / 2, bounds.top + 2],
        [bounds.left + bounds.width / 2, bounds.bottom - 2],
      ].every(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return !!hit && (hit === element || element.contains(hit));
      })
    );
  });

test('recovery network picker can be operated by keyboard in a short window', async ({}, info) => {
  test.setTimeout(120_000);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'NetworkKeyboardSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('qa116-network-keyboard', {
      offlineHttpProxy: server.url,
      viewport: { width: 320, height: 360 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    const page = wallet.page;
    await wallet.gotoRoute('#/chain-fail-to-connect');
    await page.getByRole('button', { name: 'Go to another network' }).click();
    await expect(page).toHaveURL(/#\/switch-network/);
    const evm = page.getByRole('button', { name: 'EVM', exact: true });
    const utxo = page.getByRole('button', { name: 'UTXO', exact: true });
    await expect(evm).toBeAttached();
    await expect(utxo).toBeAttached();
    // Reach these controls with normal keyboard navigation, not DOM focus().
    for (let step = 0; step < 20; step++) {
      await page.keyboard.press('Tab');
      if (await evm.evaluate((element) => element === document.activeElement))
        break;
    }
    await expect(evm).toBeFocused();
    await expect.poll(() => exposed(evm)).toBe(true);
    await page.keyboard.press('Enter');
    await expect(evm).toHaveAttribute('aria-pressed', 'true');
    const connect = page.getByRole('button', { name: 'Connect', exact: true });
    await expect(connect).toBeDisabled();
    await page.keyboard.press('Shift+Tab');
    await expect(utxo).toBeFocused();
    await page.keyboard.press('Space');
    await expect(utxo).toHaveAttribute('aria-pressed', 'true');
    const testnet = page.getByRole('button', {
      name: /^Syscoin Testnet(?: \(Active\))?$/,
    });
    for (let step = 0; step < 20; step++) {
      await page.keyboard.press('Tab');
      if (
        await testnet.evaluate((element) => element === document.activeElement)
      )
        break;
    }
    await expect(testnet).toBeFocused();
    await expect.poll(() => exposed(testnet)).toBe(true);
    await page.keyboard.press('Enter');
    await expect(testnet).toHaveAttribute('aria-pressed', 'true');
    await expect(connect).toBeEnabled();
    await page.keyboard.press('Tab');
    await expect(connect).toBeFocused();
    await expect.poll(() => exposed(connect)).toBe(true);
    await info.attach('network-picker-keyboard-320x360', {
      body: await page.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    });
    // This pass tests selection only, not a network connection or transaction.
    expect(routes.deniedWrites).toEqual([]);
    if (test.info().errors.length === 0) status = 'passed';
  } finally {
    try {
      await wallet?.dispose(status);
    } finally {
      try {
        await server.close();
      } finally {
        Object.assign(E2E_CONFIG, previous);
      }
    }
  }
});
