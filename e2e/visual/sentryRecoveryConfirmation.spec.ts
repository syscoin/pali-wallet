import { expect, test } from '@playwright/test';

import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('each Sentry import needs its own backup acknowledgement and removal identifies its key', async ({}, info) => {
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
      await expect(identity).toContainText(/Legacy BLS\s*·\s*Operator/);
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
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      } else {
        await page
          .getByLabel('Wallet password', { exact: true })
          .fill(E2E_CONFIG.password);
        await page.getByRole('button', { name: 'Remove', exact: true }).click();
      }
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
    expect(routes.deniedWrites).toEqual([]);
    expect(routes.syntheticBroadcasts).toEqual([]);
  } finally {
    await wallet?.context.close().catch(() => undefined);
    Object.assign(E2E_CONFIG, before);
    await server.close();
  }
});
