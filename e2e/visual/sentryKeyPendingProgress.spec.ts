import { expect, test, type TestInfo } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { captureForegroundContrast } from '../harness/foregroundContrast';
import {
  installRuntimeReplyHold,
  armRuntimeReply,
  runtimeReplySnapshot,
  releaseRuntimeReply,
  restoreRuntimeReply,
} from '../harness/genuineRuntimeReply';
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

async function withSentryWallet(
  info: TestInfo,
  name: string,
  run: (
    wallet: PaliWallet,
    audit: Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
  ) => Promise<void>
) {
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  const sourceHash = createHash('sha256')
    .update(fs.readFileSync(info.file))
    .digest('hex');
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'SentryProgressSyntheticOnly!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch(name, {
      offlineHttpProxy: server.url,
      recordVideo: false,
      viewport: { width: 400, height: 620 },
    });
    const screenshot = wallet.page.screenshot.bind(wallet.page);
    wallet.page.screenshot = (options = {}) =>
      screenshot({
        ...options,
        mask: [
          ...(options.mask || []),
          wallet!.page.locator('input, textarea, p.font-mono'),
        ],
      });
    const audit = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    await wallet.step(
      'Sentry key removal keeps genuine pending progress visible and prevents duplicate actions',
      () => run(wallet!, audit)
    );
    expect(audit.deniedWrites).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    expect(
      createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
    ).toBe(sourceHash);
    status = 'passed';
  } finally {
    try {
      await wallet?.dispose(status);
    } finally {
      await server.close();
      Object.assign(E2E_CONFIG, previous);
    }
  }
}

test.use({ trace: 'off', video: 'off', screenshot: 'off' });
for (const viewport of [
  { width: 400, height: 620 },
  { width: 320, height: 360 },
]) {
  test(`Sentry local-key removal pending indicator remains observable at ${viewport.width}`, async ({}, info) => {
    test.setTimeout(90000);
    await withSentryWallet(
      info,
      `sentry-removal-loading-${viewport.width}`,
      async (wallet, audit) => {
        const page = wallet.page;
        await page.setViewportSize(viewport);
        await wallet.importSeedAndCreatePassword();
        await wallet.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet.ensureOnHome();
        await page.locator('#general-settings-button').click();
        await page
          .getByRole('menuitem', {
            name: en.sentry.sentryOperators,
            exact: true,
          })
          .click();
        await page
          .getByRole('button', { name: 'Import Sentry key', exact: true })
          .click();
        await page
          .getByLabel('Key label', { exact: true })
          .fill('Public loading control');
        await page
          .getByLabel('Sentry private key (hex)', { exact: true })
          .fill('11'.repeat(32));
        await page
          .getByLabel('Wallet password', { exact: true })
          .fill(E2E_CONFIG.password);
        await page.getByRole('checkbox').check();
        await page.getByRole('button', { name: 'Import', exact: true }).click();
        await expect(
          page.getByText('Operator key imported securely.', { exact: true })
        ).toBeVisible();
        const card = page
          .getByRole('heading', { name: 'Public loading control', exact: true })
          .locator('..');
        const publicKey = (
          await card.locator('p.font-mono').innerText()
        ).trim();
        expect(publicKey).toMatch(/^[a-f0-9]{96}$/);
        await card
          .getByRole('button', { name: 'Remove local key', exact: true })
          .click();
        await page
          .getByLabel('Wallet password', { exact: true })
          .fill(E2E_CONFIG.password);
        const remove = page.locator('button[type="submit"]');
        await expect(remove).toHaveText('Remove');
        await expect(remove).toBeEnabled();
        const healthy = await captureForegroundContrast(
          remove,
          info,
          `remove-enabled-${viewport.width}`
        );
        await installRuntimeReplyHold(page);
        try {
          await armRuntimeReply(page, 'removeSentryKey');
          await remove.click();
          await expect
            .poll(async () => (await runtimeReplySnapshot(page)).held)
            .toBe(true);
          await expect(remove).toBeDisabled();
          await expect(
            page.getByRole('button', { name: 'Cancel', exact: true })
          ).toBeDisabled();
          const before = await runtimeReplySnapshot(page);
          expect(before.calls.removeSentryKey).toBe(1);
          expect(before.realResponseWasError).toBe(false);
          await page.keyboard.press('Enter');
          expect((await runtimeReplySnapshot(page)).calls.removeSentryKey).toBe(
            1
          );
          const spinnerPath = remove.locator('svg.animate-spin path');
          await expect(spinnerPath).toHaveAttribute('fill', 'currentColor');
          const pending = await captureForegroundContrast(
            spinnerPath,
            info,
            `remove-pending-${viewport.width}`,
            'currentColor-icon'
          );
          expect(pending.unsupported).toEqual([]);
          expect(pending.ratio).toBeGreaterThanOrEqual(3);
          await remove.hover();
          await expect(remove).toHaveCSS('opacity', '1');
          await expect(remove.locator('svg')).toHaveCSS('width', '24px');
          await expect(remove.locator('svg')).toHaveCSS('height', '35px');
          await info.attach(`remove-pending-full-${viewport.width}`, {
            contentType: 'image/png',
            body: await page.screenshot({
              mask: [page.locator('input, textarea')],
            }),
          });
          await info.attach('pending-observation', {
            contentType: 'application/json',
            body: JSON.stringify({
              viewport,
              healthy,
              pending,
              publicKey,
              transport: await runtimeReplySnapshot(page),
              note: 'Active pending feedback remains readable; native disabled state and original result delivery stay intact.',
            }),
          });
          await releaseRuntimeReply(page);
          await expect(
            page.getByRole('heading', {
              name: 'Public loading control',
              exact: true,
            })
          ).toHaveCount(0);
          await expect(
            page.getByText(
              en.sentry
                .localOperatorKeyRemovedRegisteredCollateralRemainsProtected,
              { exact: true }
            )
          ).toBeVisible();
          expect((await runtimeReplySnapshot(page)).calls.removeSentryKey).toBe(
            1
          );
          await page.screenshot({
            path: info.outputPath(`removal-complete-${viewport.width}.png`),
            animations: 'disabled',
          });
          await page.reload();
          await expect(
            page.getByText('No Sentry keys imported on this network.', {
              exact: true,
            })
          ).toBeVisible();
        } finally {
          await restoreRuntimeReply(page);
        }
        expect(audit.deniedWrites).toEqual([]);
      }
    );
  });
}
