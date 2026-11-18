import { expect, test } from '@playwright/test';
import { Transaction } from 'ethers/transaction';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('an unconfirmed send can be sped up from Activity at 320px', async ({}, info) => {
  test.setTimeout(90_000);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  const fixture = createIsolatedVaultFixture();
  const [payer, recipient] = fixture.evmAddresses;
  const posts: Transaction[] = [];
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'ActivitySpeedUpSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('activity-speed-up-320', {
      offlineHttpProxy: server.url,
      viewport: { width: 320, height: 620 },
      recordVideo: false,
    });
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
      const request = route.request();
      if (request.method() !== 'POST') return route.fallback();
      const payload = request.postDataJSON();
      const calls = Array.isArray(payload) ? payload : [payload];
      if (calls.length === 1 && calls[0]?.method === 'eth_sendRawTransaction') {
        const { id, params } = calls[0];
        expect(params).toHaveLength(1);
        const signed = Transaction.from(params[0]);
        expect(signed.from).toBe(payer);
        expect(signed.chainId.toString()).toBe('5700');
        posts.push(signed);
        if (posts.length === 1) return route.abort('failed');
        expect(posts).toHaveLength(2);
        return route.fulfill({
          json: { jsonrpc: '2.0', id, result: signed.hash },
        });
      }
      const responses = new Map<string, string | null>([
        ['eth_getBalance', '0xde0b6b3a7640000'],
        ['eth_getTransactionReceipt', null],
        ['eth_getTransactionByHash', null],
        ['eth_estimateGas', '0x5208'],
      ]);
      if (!calls.every((call) => responses.has(call.method)))
        return route.fallback();
      const replies = calls.map((call) => ({
        jsonrpc: '2.0',
        id: call.id,
        result: responses.get(call.method),
      }));
      return route.fulfill({
        json: Array.isArray(payload) ? replies : replies[0],
      });
    });
    const page = wallet.page;
    await wallet.step(
      'save the signed spend while its synthetic acknowledgement is lost',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
        await expect(page.locator('#home-balance')).toHaveText('1');
        await page.locator('#send-btn').click();
        await page
          .getByPlaceholder('Receiver', { exact: true })
          .fill(recipient);
        await page.getByPlaceholder('Amount', { exact: true }).fill('0.0005');
        await page.locator('#send-eth-next-btn').click();
        await page
          .getByRole('button', { name: en.buttons.confirm, exact: true })
          .click();
        await expect.poll(() => posts.length).toBe(1);
        expect(posts[0]?.to).toBe(recipient);
        expect(posts[0]?.value.toString()).toBe('500000000000000');
      }
    );
    await wallet.step(
      'review and sign a fee replacement from the Activity menu',
      async () => {
        await wallet!.ensureOnHome();
        await page.locator('#activity-btn').click();
        const transaction = page
          .locator('#activity-panel-list')
          .locator(`[data-transaction-hash="${posts[0]!.hash}"]`);
        const openActions = () =>
          transaction
            .locator('#transaction-options')
            .getByRole('button')
            .click();
        const speedUp = page.getByRole('menuitem', {
          name: en.header.speedUp,
          exact: true,
        });
        await openActions();
        await expect(
          page.getByRole('menuitem', { name: /resend/i })
        ).toHaveCount(0);
        await speedUp.click();
        const dialog = page.getByRole('dialog', { name: en.header.speedTx });
        const confirm = dialog.getByRole('button', {
          name: en.buttons.confirm,
          exact: true,
        });
        await expect(
          dialog.getByText(/maximum network fee of [\d.]+ TSYS/)
        ).toBeVisible();
        await expect(confirm).toBeEnabled();
        expect(posts).toHaveLength(1);
        await info.attach('Activity Speed Up review at 320px', {
          body: await page.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        });
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        expect(posts).toHaveLength(1);
        await openActions();
        await speedUp.click();
        await expect(confirm).toBeEnabled();
        await confirm.click();
        await expect.poll(() => posts.length).toBe(2);
        const [original, replacement] = posts;
        expect(replacement.hash).not.toBe(original.hash);
        expect(replacement.nonce).toBe(original.nonce);
        expect(replacement.to).toBe(original.to);
        expect(replacement.data).toBe(original.data);
        expect(replacement.value).toBe(original.value);
        expect(
          replacement.maxFeePerGas ?? replacement.gasPrice
        ).toBeGreaterThan(
          original.maxFeePerGas ?? original.gasPrice ?? BigInt(0)
        );
      }
    );
    expect(routes.deniedWrites).toEqual([]);
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
