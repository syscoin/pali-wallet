import { expect, test } from '@playwright/test';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

for (const refresh of ['healthy', 'refused once'] as const) {
  test(`each Sentry import needs its own backup acknowledgement and removal identifies its key with refresh ${refresh}`, async ({}, info) => {
    const before = { ...E2E_CONFIG };
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'SentryRecoverySynthetic!2026',
      chainId: 5700,
      networkLabel: 'Syscoin Testnet',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    try {
      wallet = await PaliWallet.launch('sentry-recovery-confirmation', {
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
      await page.goto(wallet.appUrl('#/settings/sentry'));
      for (const [label, secret] of [
        ['First backed-up operator', '11'.repeat(32)],
        ['Second backed-up operator', '22'.repeat(32)],
      ]) {
        await page
          .getByRole('button', { name: 'Import Sentry key', exact: true })
          .click();
        await expect(page.getByRole('checkbox')).not.toBeChecked();
        await expect(page.getByLabel('Key label', { exact: true })).toHaveValue(
          ''
        );
        await page.getByLabel('Key label', { exact: true }).fill(label);
        await page
          .getByLabel('Sentry private key (hex)', { exact: true })
          .fill(secret);
        await page
          .getByLabel('Wallet password', { exact: true })
          .fill(E2E_CONFIG.password);
        await expect(
          page.getByRole('button', { name: 'Import', exact: true })
        ).toBeDisabled();
        await page.getByRole('checkbox').check();
        await page.getByRole('button', { name: 'Import', exact: true }).click();
        await expect(
          page.getByText('Operator key imported securely.', { exact: true })
        ).toBeVisible();
      }
      const secondCard = page
        .getByRole('heading', {
          name: 'Second backed-up operator',
          exact: true,
        })
        .locator('..');
      const publicKey = (
        await secondCard.locator('p.font-mono').innerText()
      ).trim();
      expect(publicKey).toMatch(/^[a-f0-9]{96}$/);
      for (const viewport of [
        { width: 320, height: 360 },
        { width: 400, height: 480 },
      ]) {
        await page.setViewportSize(viewport);
        await secondCard
          .getByRole('button', { name: 'Remove local key', exact: true })
          .click();
        const identity = page
          .getByRole('heading', {
            name: 'Second backed-up operator',
            exact: true,
          })
          .locator('..');
        await expect(identity).toContainText(/BLS \(Basic\)\s*·\s*Operator/);
        await expect(identity).toContainText(publicKey);
        await identity.scrollIntoViewIfNeeded();
        await info.attach(
          `removal-identity-${viewport.width}x${viewport.height}`,
          {
            body: await page.screenshot({ animations: 'disabled' }),
            contentType: 'image/png',
          }
        );
        expect(
          await identity.evaluate(
            (element) => element.scrollWidth <= element.clientWidth
          )
        ).toBe(true);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        ).toBe(true);
        await page
          .getByLabel('Wallet password', { exact: true })
          .scrollIntoViewIfNeeded();
        await expect(
          page.getByLabel('Wallet password', { exact: true })
        ).toBeVisible();
        if (viewport.width === 320) {
          await page
            .getByRole('button', { name: 'Cancel', exact: true })
            .click();
        } else {
          if (refresh === 'refused once') {
            const worker = wallet.context
              .serviceWorkers()
              .find((candidate) =>
                candidate
                  .url()
                  .startsWith(`chrome-extension://${wallet!.extensionId}/`)
              );
            expect(worker).toBeTruthy();
            // Fail one native settings read only after the real encrypted-key
            // deletion has completed. Never replace a controller reply, key,
            // password check, native write or other storage read.
            await worker!.evaluate(() => {
              const get = chrome.storage.local.get.bind(chrome.storage.local);
              const set = chrome.storage.local.set.bind(chrome.storage.local);
              let committed = false;
              let refused = false;
              const audit = { nativeKeyWrites: 0, refusedSettingsReads: 0 };
              (globalThis as any).__sentryRemovalAudit = audit;
              chrome.storage.local.set = ((items: any, callback: any) => {
                const removal = Object.entries(items).some(
                  ([key, value]: any) =>
                    key.startsWith('sentry-operator-v1:') &&
                    value?.keys?.length === 1
                );
                return (set as any)(items, (...args: any[]) => {
                  if (removal && !chrome.runtime.lastError) {
                    committed = true;
                    audit.nativeKeyWrites += 1;
                  }
                  callback?.(...args);
                });
              }) as typeof chrome.storage.local.set;
              chrome.storage.local.get = ((keys: any, callback: any) => {
                const requested = Array.isArray(keys) ? keys : [keys];
                if (
                  committed &&
                  !refused &&
                  requested.some(
                    (key: any) =>
                      typeof key === 'string' &&
                      key.startsWith('sentry-settings-v1:')
                  )
                ) {
                  refused = true;
                  audit.refusedSettingsReads += 1;
                  throw new Error('Synthetic postcommit settings read refusal');
                }
                return (get as any)(keys, callback);
              }) as typeof chrome.storage.local.get;
            });
          }
          await page
            .getByLabel('Wallet password', { exact: true })
            .fill(E2E_CONFIG.password);
          await page
            .getByRole('button', { name: 'Remove', exact: true })
            .click();
        }
      }
      if (refresh === 'refused once') {
        await expect(
          page.getByText(
            en.sentry
              .localOperatorKeyRemovedRegisteredCollateralRemainsProtected,
            { exact: true }
          )
        ).toBeVisible();
        await expect(
          page.getByText(en.sentry.unableToLoadSentrySettings, { exact: true })
        ).toBeVisible();
        const worker = wallet.context
          .serviceWorkers()
          .find((candidate) =>
            candidate
              .url()
              .startsWith(`chrome-extension://${wallet!.extensionId}/`)
          )!;
        expect(
          await worker.evaluate(() => (globalThis as any).__sentryRemovalAudit)
        ).toEqual({ nativeKeyWrites: 1, refusedSettingsReads: 1 });
        await page
          .getByRole('button', { name: en.receive.retry, exact: true })
          .click();
        await expect(
          page.getByText(en.sentry.unableToLoadSentrySettings, { exact: true })
        ).toHaveCount(0);
        expect(
          await worker.evaluate(() => (globalThis as any).__sentryRemovalAudit)
        ).toEqual({ nativeKeyWrites: 1, refusedSettingsReads: 1 });
      }
      await expect(
        page.getByRole('heading', {
          name: 'First backed-up operator',
          exact: true,
        })
      ).toBeVisible();
      await expect(
        page.getByRole('heading', {
          name: 'Second backed-up operator',
          exact: true,
        })
      ).toHaveCount(0);
      await page.reload();
      await expect(
        page.getByRole('heading', {
          name: 'First backed-up operator',
          exact: true,
        })
      ).toBeVisible();
      await expect(
        page.getByRole('heading', {
          name: 'Second backed-up operator',
          exact: true,
        })
      ).toHaveCount(0);
      expect(routes.deniedWrites).toEqual([]);
      expect(routes.syntheticBroadcasts).toEqual([]);
    } finally {
      await wallet?.context.close().catch(() => undefined);
      Object.assign(E2E_CONFIG, before);
      await server.close();
    }
  });
}
