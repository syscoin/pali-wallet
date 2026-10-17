import { expect, test } from '@playwright/test';
import path from 'path';

import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('Sentry batch import validates and stores all keys atomically in a short window', async ({}, info) => {
  test.setTimeout(180000);
  const extensionPath = process.env.PALI_TEST_DAPP_EXTENSION_PATH;
  if (!extensionPath || !path.isAbsolute(extensionPath))
    throw new Error('Pin the exact built extension');
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'SentryBatchSynthetic!2026',
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  try {
    wallet = await PaliWallet.launch('sentry-batch-import', {
      offlineHttpProxy: server.url,
      viewport: { width: 320, height: 360 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    const page = wallet.page;
    await wallet.importSeedAndCreatePassword();
    await wallet.switchNetwork('Syscoin Testnet', 'UTXO');
    await wallet.ensureOnHome();
    await wallet.gotoRoute('#/settings/sentry');
    const keys = ['01', '02', '03', '04'].map((byte) => '00'.repeat(31) + byte);
    const openBatch = async () => {
      await page
        .getByRole('button', { name: 'Import Sentry key', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Batch import', exact: true })
        .click();
    };
    const submit = async () => {
      await page.getByLabel('Wallet password').fill(E2E_CONFIG.password);
      await page.getByRole('checkbox').check();
      const button = page.getByRole('button', { name: 'Import', exact: true });
      await button.scrollIntoViewIfNeeded();
      expect(
        await button.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const hit = document.elementFromPoint(
            box.left + box.width / 2,
            box.top + box.height / 2
          );
          return (
            box.left >= 0 &&
            box.right <= innerWidth &&
            box.top >= 0 &&
            box.bottom <= innerHeight &&
            !!hit &&
            (hit === element || element.contains(hit))
          );
        })
      ).toBe(true);
      await button.click();
    };
    await wallet.step(
      'keep a private key out of the masked batch preview when pasted as a label',
      async () => {
        await openBatch();
        const input = page.getByLabel('Sentry keys (one per line)');
        await input.fill(`${keys[0]} | ${keys[0]}\nBeta | ${keys[1]}`);
        await expect(page.getByRole('alert')).toContainText('private keys');
        const preview = (await page.locator('ol li').allTextContents()).join(
          ' '
        );
        expect(preview).not.toContain(keys[0]);
        expect(preview).not.toContain(keys[1]);
        expect(
          await input.evaluate((element) =>
            getComputedStyle(element).getPropertyValue('-webkit-text-security')
          )
        ).toBe('disc');
        await page.getByLabel('Wallet password').fill(E2E_CONFIG.password);
        await page.getByRole('checkbox').check();
        await expect(
          page.getByRole('button', { name: 'Import', exact: true })
        ).toBeDisabled();
        await input.fill(`Alpha | ${keys[0]}\nBeta | ${keys[1]}`);
        await expect(page.getByRole('alert')).toHaveCount(0);
        await expect(page.getByRole('checkbox')).not.toBeChecked();
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      }
    );
    await wallet.step(
      'reject malformed lines and reset the complete batch acknowledgement after edits',
      async () => {
        await openBatch();
        const input = page.getByLabel('Sentry keys (one per line)');
        await input.fill(`Alpha | ${keys[0]}\nBroken | invalid`);
        await expect(page.getByRole('alert')).toContainText('Line 2');
        await page.getByLabel('Wallet password').fill(E2E_CONFIG.password);
        await page.getByRole('checkbox').check();
        await expect(
          page.getByRole('button', { name: 'Import', exact: true })
        ).toBeDisabled();
        await input.fill(`Alpha | ${keys[0]}\nBeta | ${keys[1]}`);
        await expect(page.getByRole('checkbox')).not.toBeChecked();
        await page.screenshot({
          path: info.outputPath('batch-review-320.png'),
          mask: [input, page.getByLabel('Wallet password')],
        });
      }
    );
    await wallet.step(
      'import two real BLS keys through one local approval and persist only ciphertext',
      async () => {
        await submit();
        await expect(
          page.getByRole('heading', { name: 'Alpha', exact: true })
        ).toBeVisible({ timeout: 30000 });
        await expect(
          page.getByRole('heading', { name: 'Beta', exact: true })
        ).toBeVisible();
        const worker = wallet!.context
          .serviceWorkers()
          .find((w) => w.url().endsWith('background.bundle.js'))!;
        const store = await worker.evaluate(async () => {
          const items = await new Promise<Record<string, any>>((resolve) =>
            chrome.storage.local.get(null, resolve)
          );
          return Object.entries(items)
            .filter(([key]) => key.startsWith('sentry-operator-v1:'))
            .map(([, value]) => value);
        });
        expect(store).toHaveLength(1);
        expect(store[0].keys).toHaveLength(2);
        for (const secret of [...keys, UTXO_FIXTURE_SEED, E2E_CONFIG.password])
          expect(JSON.stringify(store)).not.toContain(secret);
        await page.screenshot({
          path: info.outputPath('batch-imported-320.png'),
        });
        await page.reload();
        await expect(
          page.getByRole('heading', { name: 'Alpha', exact: true })
        ).toBeVisible();
        await expect(
          page.getByRole('heading', { name: 'Beta', exact: true })
        ).toBeVisible();
      }
    );
    await wallet.step(
      'a rejected second key remains editable and imports atomically after correction and fresh approval',
      async () => {
        await openBatch();
        await page
          .getByLabel('Sentry keys (one per line)')
          .fill(`Gamma | ${keys[2]}\nInvalid scalar | ${'00'.repeat(32)}`);
        await submit();
        await expect(page.getByRole('alert')).toContainText(
          'Key 2: invalid key',
          { timeout: 30000 }
        );
        const input = page.getByLabel('Sentry keys (one per line)');
        await expect(input).toHaveValue(
          `Gamma | ${keys[2]}\nInvalid scalar | ${'00'.repeat(32)}`
        );
        await expect(page.getByLabel('Wallet password')).toHaveValue('');
        await expect(page.getByRole('checkbox')).not.toBeChecked();
        const worker = wallet!.context
          .serviceWorkers()
          .find((w) => w.url().endsWith('background.bundle.js'))!;
        const count = await worker.evaluate(async () => {
          const items = await new Promise<Record<string, any>>((resolve) =>
            chrome.storage.local.get(null, resolve)
          );
          return Object.entries(items)
            .filter(([key]) => key.startsWith('sentry-operator-v1:'))
            .flatMap(([, value]) => value.keys).length;
        });
        expect(count).toBe(2);
        await input.fill(`Gamma | ${keys[2]}\nDelta | ${keys[3]}`);
        await expect(
          page.getByRole('button', { name: 'Import', exact: true })
        ).toBeDisabled();
        await submit();
        await expect(
          page.getByRole('heading', { name: 'Gamma', exact: true })
        ).toBeVisible();
        await expect(
          page.getByRole('heading', { name: 'Delta', exact: true })
        ).toBeVisible();
        await openBatch();
        await expect(page.getByLabel('Sentry keys (one per line)')).toHaveValue(
          ''
        );
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(
          page.getByRole('heading', { name: 'Alpha', exact: true })
        ).toBeVisible();
        await expect(
          page.getByRole('heading', { name: 'Beta', exact: true })
        ).toBeVisible();
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    expect(routes.syntheticBroadcasts).toEqual([]);
    await wallet.dispose('passed');
    wallet = undefined;
  } finally {
    if (wallet) await wallet.dispose('failed');
    Object.assign(E2E_CONFIG, previous);
    await server.close();
  }
});
