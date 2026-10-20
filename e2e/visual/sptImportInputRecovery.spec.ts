import { expect, test } from '@playwright/test';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { SPT_GUID, SPT_SYMBOL } from '../harness/sptFixture';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('custom SPT validation recovers after coalesced input undo without importing', async ({}, info) => {
  const before = { ...E2E_CONFIG };
  const fixture = createIsolatedVaultFixture();
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'SptInputSynthetic!2026',
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('spt-import-input-recovery', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.switchNetwork('Syscoin Testnet', 'UTXO');
    await wallet.ensureOnHome();
    const page = wallet.page;
    await page.locator('#assets-btn').click();
    await page
      .getByRole('button', { name: en.home.importToken, exact: true })
      .click();
    await page
      .getByRole('button', { name: en.tokens.addCustomTab, exact: true })
      .click();
    await page.evaluate(() => {
      const original = chrome.runtime.sendMessage;
      const calls: string[] = [];
      (window as any).__sptValidationCalls = calls;
      // Observe public GUIDs only; every request and response remains real.
      (chrome.runtime.sendMessage as any) = (...args: any[]) => {
        const message = args[0];
        if (
          message?.type === 'CONTROLLER_ACTION' &&
          JSON.stringify(message.data?.methods) ===
            JSON.stringify(['wallet', 'validateSPTOnly'])
        )
          calls.push(String(message.data?.params?.[0]));
        return (original as any).apply(chrome.runtime, args);
      };
    });
    const input = page.locator('#custom-spt-guid');
    const importToken = page.getByRole('button', {
      name: `Import ${SPT_SYMBOL} token`,
      exact: true,
    });
    const calls = () =>
      page.evaluate(() => [...(window as any).__sptValidationCalls]);
    await input.fill(SPT_GUID);
    await expect(importToken).toBeEnabled();
    await expect.poll(calls).toEqual([SPT_GUID]);
    await input.evaluate((element, guid) => {
      const set = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )!.set!;
      // Real native input events in one turn deterministically coalesce the
      // intermediate value. No React state, controller data or results change.
      set.call(element, `${guid}0`);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      set.call(element, guid);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }, SPT_GUID);
    await expect(input).toHaveValue(SPT_GUID);
    await expect.poll(calls).toEqual([SPT_GUID, SPT_GUID]);
    await expect(importToken).toBeEnabled();
    await info.attach('recovered-custom-spt-preview', {
      contentType: 'image/png',
      body: await page.screenshot({ animations: 'disabled' }),
    });
    await input.fill('not-a-guid');
    await expect(importToken).toHaveCount(0);
    await input.fill('');
    await expect(input).toHaveValue('');
    await expect(importToken).toHaveCount(0);
    expect(await calls()).toEqual([SPT_GUID, SPT_GUID]);
    expect(routes.deniedWrites).toEqual([]);
    status = 'passed';
  } finally {
    try {
      await wallet?.dispose(status);
    } finally {
      try {
        await server.close();
      } finally {
        Object.assign(E2E_CONFIG, before);
      }
    }
  }
});
