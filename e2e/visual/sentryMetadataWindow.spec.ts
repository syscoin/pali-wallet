import { expect, test } from '@playwright/test';

import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('Sentry settings wrap a long custom network label in small windows', async ({}, info) => {
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'SentryMetadataSynthetic!2026',
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  try {
    wallet = await PaliWallet.launch('sentry-metadata-small-window', {
      offlineHttpProxy: server.url,
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.switchNetwork('Syscoin Testnet', 'UTXO');
    await wallet.ensureOnHome();
    const page = await wallet.context.newPage();
    const label = 'CustomSentryNetwork'.repeat(8);
    // Renderer-only public metadata; no new network or credential is installed.
    await page.addInitScript((longLabel) => {
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      const fixture = (state: any) => {
        if (!state?.vault?.activeNetwork) return state;
        const copy = structuredClone(state);
        copy.vault.activeNetwork.label = longLabel;
        return copy;
      };
      chrome.runtime.sendMessage = ((...args: any[]) => {
        const [message, callback] = args;
        if (message?.type === 'getCurrentState') {
          if (typeof callback === 'function')
            return (original as any)(message, (state: any) =>
              callback(fixture(state))
            );
          return (original as any)(message).then(fixture);
        }
        return (original as any)(...args);
      }) as typeof chrome.runtime.sendMessage;
    }, label);
    await page.goto(wallet.appUrl('#/settings/sentry'));
    const metadata = page.locator('form > section').first().locator('p').last();
    await expect(metadata).toContainText(label);
    for (const viewport of [
      { width: 320, height: 360 },
      { width: 400, height: 480 },
    ]) {
      await page.setViewportSize(viewport);
      await metadata.scrollIntoViewIfNeeded();
      await info.attach(`sentry-network-${viewport.width}x${viewport.height}`, {
        body: await page.screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      });
      await expect
        .poll(() =>
          metadata.evaluate(
            (element) => element.scrollWidth <= element.clientWidth
          )
        )
        .toBe(true);
      const open = page.getByRole('button', { name: 'Import Sentry key' });
      await open.scrollIntoViewIfNeeded();
      await open.click();
      await expect(page.getByLabel('Key role')).toBeVisible();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    expect(routes.deniedWrites).toEqual([]);
    expect(routes.syntheticBroadcasts).toEqual([]);
  } finally {
    await wallet?.context.close().catch(() => undefined);
    Object.assign(E2E_CONFIG, before);
    await server.close();
  }
});
