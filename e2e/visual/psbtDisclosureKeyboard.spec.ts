import { expect, test } from '@playwright/test';
import { utils as sys } from 'syscoinjs-lib';

import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_PATH,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('ordinary unsigned Send exposes every PSBT input to keyboard review', async ({}, info) => {
  const previous = { ...E2E_CONFIG };
  const fixture = createUtxoFixture('100000');
  const parents = Array.from({ length: 4 }, (_, index) => {
    const parent = sys.bitcoinjs.Transaction.fromHex(
      fixture.parentTxs[0].toHex()
    );
    parent.ins[0].hash = Buffer.alloc(32, 30 + index);
    parent.outs[0].value = BigInt(25000);
    return parent;
  });
  fixture.parentTxs.push(...parents);
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'PsbtKeyboardSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('psbt-disclosure-keyboard', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      fixture,
      server.url,
      {
        readState: () => ({
          utxos: parents.map((parent) => ({
            txid: parent.getId(),
            vout: 0,
            value: '25000',
            height: 1,
            confirmations: 1,
            address: fixture.userAddress,
            path: UTXO_FIXTURE_PATH,
          })),
        }),
      }
    );
    const page = wallet.page;
    await wallet.step(
      'prepare a four-input unsigned Send using normal UI',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        await page.locator('#send-btn').click();
        await page
          .getByPlaceholder('Receiver', { exact: true })
          .fill(fixture.recipientAddress);
        await page.getByPlaceholder('Amount', { exact: true }).fill('0.0009');
        await page.locator('#fee-input').fill('0.00000001');
        await page.getByRole('button', { name: 'Next', exact: true }).click();
        await expect(page).toHaveURL(/#\/send\/confirm$/);
        const advanced = page.getByRole('button', {
          name: 'Advanced Details',
          exact: true,
        });
        await advanced.focus();
        await page.keyboard.press('Enter');
        await expect(
          page.getByRole('button', { name: 'Inputs (4)', exact: true })
        ).toHaveAttribute('aria-expanded', 'false');
        await expect(
          page.getByRole('button', { name: 'Inputs (4)', exact: true })
        ).toHaveText('Inputs (4)');
        await expect(page.getByText('Input #3', { exact: true })).toHaveCount(
          0
        );
      }
    );

    const inputs = page.getByRole('button', {
      name: 'Inputs (4)',
      exact: true,
    });
    await wallet.step(
      'Tab reaches inputs and Enter exposes all four rows',
      async () => {
        // Start at the real Advanced Details control; do not programmatically
        // focus the disclosure whose native keyboard accessibility is under test.
        await page
          .getByRole('button', { name: 'Advanced Details', exact: true })
          .focus();
        for (let index = 0; index < 60; index++) {
          await page.keyboard.press('Tab');
          if (
            await inputs.evaluate((button) => button === document.activeElement)
          )
            break;
        }
        await expect(inputs).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(inputs).toHaveAttribute('aria-expanded', 'true');
        for (let index = 0; index < 4; index++)
          await expect(
            page.getByText(`Input #${index}`, { exact: true })
          ).toBeVisible();
        await expect(page).toHaveURL(/#\/send\/confirm$/);
        expect(routes.deniedWrites).toEqual([]);
      }
    );

    await wallet.step(
      'Space collapses and mouse toggles the same review without submitting',
      async () => {
        await page.keyboard.press('Space');
        await expect(inputs).toHaveAttribute('aria-expanded', 'false');
        await expect(page.getByText('Input #3', { exact: true })).toHaveCount(
          0
        );
        await inputs.click();
        await expect(inputs).toHaveAttribute('aria-expanded', 'true');
        await expect(page.getByText('Input #3', { exact: true })).toBeVisible();
        await inputs.click();
        await expect(inputs).toHaveAttribute('aria-expanded', 'false');
        await expect(
          page.getByRole('button', { name: 'Outputs (2)', exact: true })
        ).toHaveAttribute('aria-expanded', 'true');
        await expect(
          page.getByRole('button', { name: 'Outputs (2)', exact: true })
        ).toHaveText('Outputs (2)');
        await expect(
          page.getByRole('button', { name: 'Confirm', exact: true })
        ).toBeEnabled();
        expect(routes.deniedWrites).toEqual([]);
      }
    );

    await wallet.step('Cancel preserves the unsigned draft', async () => {
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page).toHaveURL(/#\/send\/sys$/);
      await expect(
        page.getByPlaceholder('Amount', { exact: true })
      ).toHaveValue('0.0009');
      await expect(
        page.getByPlaceholder('Receiver', { exact: true })
      ).toHaveValue(fixture.recipientAddress);
      expect(routes.deniedWrites).toEqual([]);
    });
    await info.attach('psbt-disclosure-keyboard', {
      contentType: 'application/json',
      body: JSON.stringify({
        inputCount: 4,
        parentTxids: parents.map((parent) => parent.getId()),
        keyboard: ['Tab', 'Enter', 'Space'],
        unsigned: true,
        deniedWrites: routes.deniedWrites,
      }),
    });
    status = 'passed';
  } finally {
    try {
      await wallet?.dispose(status);
    } finally {
      await server.close();
      Object.assign(E2E_CONFIG, previous);
    }
  }
});
