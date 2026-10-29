import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const tabTo = async (page: Page, target: Locator) => {
  for (let index = 0; index < 40; index += 1) {
    if (await target.evaluate((element) => element === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
};

const publicState = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const persisted = await chrome.storage.local.get('state');
    return {
      liveProvider: state.vaultGlobal.hasEthProperty,
      savedProvider: persisted.state?.vaultGlobal?.hasEthProperty,
      activeAccount: state.vault.activeAccount,
      network: {
        kind: state.vault.activeNetwork.kind,
        chainId: state.vault.activeNetwork.chainId,
        url: state.vault.activeNetwork.url,
      },
      liveGrantCount: Object.keys(state.dapp.dapps).length,
      savedGrantCount: Object.keys(persisted.state?.dapp?.dapps ?? {}).length,
    };
  });

test('Home default-wallet controls support keyboard actions, dismissal and hidden-success focus with mouse behavior retained', async ({}, info) => {
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  const sourceSha256 = createHash('sha256')
    .update(fs.readFileSync(info.file))
    .digest('hex');
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'DefaultWalletKeyboardSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = {};
  try {
    wallet = await PaliWallet.launch('default-wallet-keyboard', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    const page = wallet.page;
    const opener = page.locator(
      'button[aria-controls="default-wallet-options"]'
    );
    const panel = page.locator('#default-wallet-options');
    const action = panel.getByRole('button', {
      name: en.settings.enablePaliProvider,
      exact: true,
    });
    const close = panel.getByRole('button', {
      name: en.buttons.close,
      exact: true,
    });
    let initial: Awaited<ReturnType<typeof publicState>>;
    const providerState = (enabled: boolean) => ({
      ...initial,
      liveProvider: enabled,
      savedProvider: enabled,
    });
    const disableThroughSettings = async () => {
      await wallet!.gotoRoute('#/settings/remove-eth');
      await page
        .getByRole('button', {
          name: en.settings.disablePaliProvider,
          exact: true,
        })
        .click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect.poll(() => publicState(page)).toEqual(providerState(false));
      await page.keyboard.press('Escape');
      await wallet!.ensureOnHome();
      await page.mouse.move(0, 0);
      await expect(opener).toBeEnabled();
      await expect(opener).toHaveAttribute('aria-expanded', 'false');
      await expect(panel).toHaveCount(0);
    };

    await wallet.step(
      'disable the provider through the ordinary settings page',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
        initial = await publicState(page);
        expect(initial).toMatchObject({
          liveProvider: true,
          savedProvider: true,
          liveGrantCount: 0,
          savedGrantCount: 0,
        });
        await disableThroughSettings();
        observations.disabled = await publicState(page);
      }
    );

    await wallet.step(
      'keyboard opens the Home widget and Escape or Close returns focus',
      async (capture) => {
        await tabTo(page, opener);
        await expect(opener).toHaveAccessibleName(en.generalMenu.manageEth);
        await expect(opener).toHaveAttribute('type', 'button');
        await expect(opener).toHaveAttribute(
          'aria-controls',
          'default-wallet-options'
        );
        await page.keyboard.press('Enter');
        await expect(opener).toHaveAttribute('aria-expanded', 'true');
        await expect(action).toBeVisible();
        await expect(action).toHaveAttribute('type', 'button');
        await tabTo(page, action);
        // Moving the pointer out must not collapse keyboard-owned focus.
        await page.mouse.move(399, 0);
        await expect(action).toBeFocused();
        await expect(panel).toBeVisible();
        await expect(
          panel.getByText(en.settings.paliProviderDisabled, { exact: true })
        ).toBeVisible();
        await expect(panel).not.toContainText(/MetaMask/i);
        await capture(page);
        await page.keyboard.press('Escape');
        await expect(panel).toHaveCount(0);
        await expect(opener).toBeFocused();
        expect(await publicState(page)).toEqual(providerState(false));
        await page.keyboard.press('Space');
        await expect(panel).toBeVisible();
        await tabTo(page, close);
        await expect(close).toHaveAttribute('type', 'button');
        await page.keyboard.press('Enter');
        await expect(panel).toHaveCount(0);
        await expect(opener).toBeFocused();
        expect(await publicState(page)).toEqual(providerState(false));
      }
    );

    await wallet.step(
      'keyboard Set Pali durably enables the provider and hidden success leaves no focus target',
      async (capture) => {
        await page.keyboard.press('Enter');
        await tabTo(page, action);
        await page.keyboard.press('Space');
        await expect.poll(() => publicState(page)).toEqual(providerState(true));
        observations.keyboardEnabled = await publicState(page);
        await capture(page);
        // Production hides its success state after one second. No test clock or
        // timer is replaced; the native disabled opener cannot enter Tab order.
        await expect(panel).toHaveCount(0);
        await expect(opener).toBeDisabled();
        await page.keyboard.press('Tab');
        await expect(opener).not.toBeFocused();
        await expect(
          page.locator('#default-wallet-options button')
        ).toHaveCount(0);
      }
    );

    await wallet.step(
      'mouse hover, Close and Set Pali remain working healthy controls',
      async (capture) => {
        await disableThroughSettings();
        await opener.hover();
        await expect(action).toBeVisible();
        await close.click();
        await expect(panel).toHaveCount(0);
        await expect(opener.locator('..')).toHaveCSS('width', '44px');
        expect(await publicState(page)).toEqual(providerState(false));
        await opener.hover();
        await expect(action).toBeVisible();
        await action.click();
        await expect.poll(() => publicState(page)).toEqual(providerState(true));
        observations.mouseEnabled = await publicState(page);
        await capture(page);
        await expect(panel).toHaveCount(0);
        await expect(opener).toBeDisabled();
        await page.reload();
        await wallet!.waitAppReady();
        if (await page.locator('#unlock-btn').isVisible())
          await wallet!.unlock();
        await wallet!.ensureOnHome();
        expect(await publicState(page)).toEqual(providerState(true));
        observations.reloaded = await publicState(page);
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    expect(
      createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
    ).toBe(sourceSha256);
    status = 'passed';
  } finally {
    try {
      await info.attach('default-wallet-keyboard-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          status,
          runtime,
          sourceSha256,
          observations,
          fixtureReads: routes?.reads ?? [],
          deniedWrites: routes?.deniedWrites ?? [],
          proxyDeniedConnections: server.blocked.length,
          controllerStateReplaced: false,
          controllerResultReplaced: false,
          chromeStorageReplaced: false,
          syntheticHttpOnly: true,
          signingOrBroadcastRequested: false,
        }),
      });
    } finally {
      try {
        await wallet?.dispose(status);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  }
});
