import { expect, test } from '@playwright/test';
import { AbiCoder, Interface, id } from 'ethers';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { dismissRejectedApproval } from '../harness/dismissRejectedApproval';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import {
  approve,
  popupFor,
  settle,
  startRequest,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('external transaction review exposes exact Data and Hex through keyboard tabs and mouse', async ({}, info) => {
  const previous = { ...E2E_CONFIG };
  const fixture = createIsolatedVaultFixture();
  const contract = '0x000000000000000000000000000000000000ed6e';
  const spender = `0x${'11'.repeat(20)}`;
  const data = new Interface([
    'function approve(address,uint256)',
  ]).encodeFunctionData('approve', [spender, 42]);
  const abi = AbiCoder.defaultAbiCoder();
  const metadata = new Map([
    [id('name()').slice(0, 10), abi.encode(['string'], ['Review Token'])],
    [id('symbol()').slice(0, 10), abi.encode(['string'], ['REVIEW'])],
    [id('decimals()').slice(0, 10), abi.encode(['uint8'], [8])],
    [id('balanceOf(address)').slice(0, 10), abi.encode(['uint256'], [0])],
    [id('totalSupply()').slice(0, 10), abi.encode(['uint256'], [0])],
    [
      id('supportsInterface(bytes4)').slice(0, 10),
      abi.encode(['bool'], [false]),
    ],
  ]);
  const writes: string[] = [];
  const errors: string[] = [];
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'TransactionTabsSynthetic!2026',
    rpcUrl: server.url,
  });
  try {
    wallet = await PaliWallet.launch('transaction-review-tabs', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    wallet.context.on('page', (page) =>
      page.on('pageerror', (error) => errors.push(error.message))
    );
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const body = route.request().postDataJSON();
      const calls = Array.isArray(body) ? body : [body];
      if (
        calls.some((call: any) =>
          /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction)/i.test(
            call?.method || ''
          )
        )
      ) {
        writes.push(...calls.map((call: any) => call.method));
        return route.abort('blockedbyclient');
      }
      const replies = calls.map((call: any) => {
        let result: unknown;
        if (call.method === 'eth_estimateGas') result = '0x5208';
        if (call.method === 'eth_feeHistory')
          result = {
            oldestBlock: '0x1',
            baseFeePerGas: ['0x3b9aca00', '0x3b9aca00'],
            gasUsedRatio: [0.5],
            reward: [['0x3b9aca00']],
          };
        if (
          call.method === 'eth_getCode' &&
          call.params[0].toLowerCase() === contract
        )
          result = '0x60006000fd';
        if (
          call.method === 'eth_call' &&
          call.params[0].to?.toLowerCase() === contract
        )
          result = metadata.get(call.params[0].data.slice(0, 10));
        return result === undefined
          ? undefined
          : { jsonrpc: '2.0', id: call.id, result };
      });
      if (!replies.every((reply) => reply !== undefined))
        return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
      });
    });
    await wallet.step('onboard the fenced synthetic wallet', async () => {
      await wallet!.importSeedAndCreatePassword();
      await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
      await wallet!.ensureOnHome();
    });
    await wallet.page.goto('about:blank');
    const dapp = await wallet.context.newPage();
    await dapp.goto(server.url);
    await dapp.waitForFunction(() => Boolean((window as any).pali));
    const connected = await approve(
      wallet.context,
      dapp,
      await startRequest(dapp, 'eth_requestAccounts')
    );
    const request = await startRequest(dapp, 'eth_sendTransaction', [
      { from: connected.result[0], to: contract, value: '0x0', data },
    ]);
    const popup = await popupFor(wallet.context, dapp, request);
    const tabs = popup.getByRole('tablist');
    const details = tabs.getByRole('tab', {
      name: en.send.details,
      exact: true,
    });
    const dataTab = tabs.getByRole('tab', { name: en.send.data, exact: true });
    const hex = tabs.getByRole('tab', { name: en.send.hex, exact: true });
    const detailsPanel = popup.getByRole('tabpanel', {
      name: en.send.details,
      exact: true,
    });
    const dataPanel = popup.getByRole('tabpanel', {
      name: en.send.data,
      exact: true,
    });
    const hexPanel = popup.getByRole('tabpanel', {
      name: en.send.hex,
      exact: true,
    });
    const assertData = async () => {
      await expect(dataTab).toHaveAttribute('aria-selected', 'true');
      await expect(dataPanel).toBeVisible();
      const decoded = JSON.parse(await dataPanel.locator('pre').innerText());
      expect(decoded.method).toBe('approve');
      expect(decoded.inputs).toEqual([spender, '42']);
      return decoded;
    };
    const assertHex = async () => {
      await expect(hex).toHaveAttribute('aria-selected', 'true');
      await expect(hexPanel).toBeVisible();
      expect((await hexPanel.innerText()).trim()).toBe(data);
    };
    const focusOrder: string[] = [];
    await wallet.step(
      'reach and navigate the review tabs with only the keyboard',
      async (capture) => {
        await expect(detailsPanel).toBeVisible();
        for (let index = 0; index < 20; index += 1) {
          await popup.keyboard.press('Tab');
          focusOrder.push(
            await popup.evaluate(
              () =>
                document.activeElement?.id ||
                document.activeElement?.tagName ||
                ''
            )
          );
          if (
            await details.evaluate(
              (element) => element === document.activeElement
            )
          )
            break;
        }
        await expect(details).toBeFocused();
        await popup.keyboard.press('ArrowRight');
        await expect(dataTab).toBeFocused();
        await assertData();
        await popup.keyboard.press('End');
        await expect(hex).toBeFocused();
        await assertHex();
        await popup.keyboard.press('ArrowRight');
        await expect(details).toBeFocused();
        await expect(detailsPanel).toBeVisible();
        await popup.keyboard.press('ArrowLeft');
        await expect(hex).toBeFocused();
        await assertHex();
        await popup.keyboard.press('Home');
        await expect(details).toBeFocused();
        await expect(detailsPanel).toBeVisible();
        await capture(popup);
      }
    );
    await wallet.step(
      'retain ordinary mouse selection and the exact original calldata',
      async (capture) => {
        await dataTab.click();
        const decoded = await assertData();
        await hex.click();
        await assertHex();
        await capture(popup);
        await info.attach('transaction-tab-observations', {
          body: JSON.stringify(
            { focusOrder, decoded, calldata: data },
            null,
            2
          ),
          contentType: 'application/json',
        });
      }
    );
    const canceled = await dismissRejectedApproval({
      click: () =>
        popup
          .getByRole('button', { name: en.buttons.cancel, exact: true })
          .click(),
      isClosed: () => popup.isClosed(),
      settle: () => settle(dapp, request),
    });
    expect(canceled.error?.code).toBe(4001);
    expect(canceled.result).toBeUndefined();
    expect(writes).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    expect(errors).toEqual([]);
    status = 'passed';
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
