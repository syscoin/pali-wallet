import { expect, test } from '@playwright/test';
import { AbiCoder, id } from 'ethers';

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

const CONTRACT = '0x000000000000000000000000000000000000e115';
const SYMBOL = 'READ1155';
const QUANTITY = '9007199254740993';

test('manual ERC1155 verification distinguishes failed reads and retries the unchanged valid ID', async ({}, info) => {
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  const previous = { ...E2E_CONFIG };
  const fixture = createIsolatedVaultFixture();
  const server = await startUtxoFixtureServer();
  const abi = AbiCoder.defaultAbiCoder();
  const selector = (signature: string) => id(signature).slice(0, 10);
  const ownershipReads: Array<{ failed: boolean; ids: string[] }> = [];
  const deniedWrites: string[] = [];
  const observations: Record<string, unknown> = {};
  let failed = true;
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'VerificationRetrySynthetic!2026',
    rpcUrl: server.url,
  });
  try {
    wallet = await PaliWallet.launch('erc1155-verification-retry', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    // ABI transport only: the real provider/controller/helper derive verification
    // and exact balance. Random detector probes return zero, not a fake asset.
    await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const rpc = route.request().postDataJSON();
      const calls = Array.isArray(rpc) ? rpc : [rpc];
      if (
        calls.some((call: any) =>
          /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign)/i.test(
            call?.method || ''
          )
        )
      ) {
        deniedWrites.push('attempted-write-or-sign');
        return route.abort('blockedbyclient');
      }
      if (
        !calls.some(
          (call: any) =>
            ['eth_call', 'eth_getCode'].includes(call?.method) &&
            (call.params?.[0]?.to || call.params?.[0])?.toLowerCase() ===
              CONTRACT
        )
      )
        return route.fallback();
      const replies = calls.map((call: any) => {
        let result: unknown;
        let readFailed = false;
        if (call?.method === 'eth_chainId') result = '0x1644';
        const target = (
          call?.params?.[0]?.to || call?.params?.[0]
        )?.toLowerCase();
        if (call?.method === 'eth_getCode' && target === CONTRACT)
          result = '0x60006000fd';
        if (call?.method === 'eth_call' && target === CONTRACT) {
          const data = String(call.params[0].data);
          const prefix = data.slice(0, 10);
          if (prefix === selector('name()'))
            result = abi.encode(['string'], ['Synthetic Read Editions']);
          if (prefix === selector('symbol()'))
            result = abi.encode(['string'], [SYMBOL]);
          if (prefix === selector('supportsInterface(bytes4)')) {
            const [value] = abi.decode(['bytes4'], `0x${data.slice(10)}`);
            result = abi.encode(
              ['bool'],
              [value === '0xd9b67a26' || value === '0x01ffc9a7']
            );
          }
          if (prefix === selector('balanceOf(address,uint256)')) {
            const [owner, tokenId] = abi.decode(
              ['address', 'uint256'],
              `0x${data.slice(10)}`
            );
            if (owner.toLowerCase() === fixture.evmAddresses[0].toLowerCase()) {
              const token = String(tokenId);
              readFailed = failed && token === '7';
              ownershipReads.push({ ids: [token], failed: readFailed });
              result = abi.encode(
                ['uint256'],
                [['7', '8'].includes(token) ? QUANTITY : '0']
              );
            }
          }
          if (prefix === selector('balanceOfBatch(address[],uint256[])')) {
            const [owners, tokenIds] = abi.decode(
              ['address[]', 'uint256[]'],
              `0x${data.slice(10)}`
            );
            if (
              owners.length === tokenIds.length &&
              owners.every(
                (owner: string) =>
                  owner.toLowerCase() === fixture.evmAddresses[0].toLowerCase()
              )
            ) {
              const ids = Array.from(tokenIds, String);
              readFailed = failed && ids.includes('7');
              ownershipReads.push({ ids, failed: readFailed });
              result = abi.encode(
                ['uint256[]'],
                [
                  ids.map((token) =>
                    ['7', '8'].includes(token) ? QUANTITY : '0'
                  ),
                ]
              );
            }
          }
        }
        return result === undefined || readFailed
          ? {
              jsonrpc: '2.0',
              id: call.id,
              error: {
                code: -32000,
                message: readFailed
                  ? 'Synthetic ownership read unavailable'
                  : 'Unsupported synthetic read',
              },
            }
          : { jsonrpc: '2.0', id: call.id, result };
      });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(rpc) ? replies : replies[0]),
      });
    });
    const page = wallet.page;
    const importToken = page.getByRole('button', {
      name: `Import ${SYMBOL} token`,
      exact: true,
    });
    const exactBalance = en.tokens.balanceForTokenId.replace(
      '{{balance}}',
      QUANTITY
    );
    const step = (name: string, action: () => Promise<void>) =>
      wallet!.step(name, async (capture) => {
        try {
          await action();
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      });
    await step(
      'open ordinary custom ERC1155 import with real contract detection',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
        await page.locator('#assets-btn').click();
        await page
          .getByRole('button', { name: en.home.importToken, exact: true })
          .click();
        const field = page.locator('#custom-token-contract');
        const custom = page
          .getByRole('button', { name: en.tokens.addCustomTab, exact: true })
          .first();
        await expect(field.or(custom).first()).toBeVisible();
        if (await custom.isVisible()) await custom.click();
        await field.fill(CONTRACT);
        await expect(page.locator('#custom-token-id')).toBeVisible();
      }
    );
    await step(
      'healthy positive and zero balances remain valid preview controls',
      async () => {
        await page.locator('#custom-token-id').fill('8');
        await expect(importToken).toBeEnabled();
        await expect(
          page.getByTitle(exactBalance, { exact: true })
        ).toBeVisible();
        await page.locator('#custom-token-id').fill('9');
        await expect(importToken).toBeEnabled();
        await expect(
          page.getByText(en.tokens.erc1155ZeroBalanceNote, { exact: true })
        ).toBeVisible();
        observations.healthyPositiveAndZero = true;
      }
    );
    await step(
      'failed valid-ID read blocks import without claiming invalidity',
      async () => {
        await page.locator('#custom-token-id').fill('7');
        await expect
          .poll(
            () =>
              ownershipReads.filter(
                (read) => read.failed && read.ids.includes('7')
              ).length
          )
          .toBeGreaterThanOrEqual(2);
        await expect(importToken).toHaveCount(0);
        observations.invalidHintCount = await page
          .getByTitle(en.send.invalidTokenId, { exact: true })
          .count();
        observations.retryCount = await page
          .getByRole('button', { name: en.receive.retry, exact: true })
          .count();
        await expect(
          page.getByTitle(en.send.invalidTokenId, { exact: true })
        ).toHaveCount(0);
        await expect(
          page.getByText(en.send.unableToLoad, { exact: true })
        ).toBeVisible();
        await expect(
          page.getByRole('button', { name: en.receive.retry, exact: true })
        ).toBeEnabled();
      }
    );
    await step(
      'Retry verifies the unchanged ID and restores the exact preview',
      async () => {
        failed = false;
        await page
          .getByRole('button', { name: en.receive.retry, exact: true })
          .click();
        await expect(page.locator('#custom-token-id')).toHaveValue('7');
        await expect(importToken).toBeEnabled();
        await expect(
          page.getByTitle(exactBalance, { exact: true })
        ).toBeVisible();
        await expect(
          page.getByText(en.send.unableToLoad, { exact: true })
        ).toHaveCount(0);
        expect(
          ownershipReads.some((read) => !read.failed && read.ids.includes('7'))
        ).toBe(true);
        expect([...deniedWrites, ...routes!.deniedWrites]).toEqual([]);
      }
    );
    status = 'passed';
  } finally {
    await info.attach('erc1155-verification-retry-evidence', {
      contentType: 'application/json',
      body: JSON.stringify({
        status,
        ownershipReads,
        observations,
        deniedWrites,
        fixtureDeniedWrites: routes?.deniedWrites || [],
        controllerStateReplaced: false,
        controllerResultsReplaced: false,
        importClicked: false,
        signingOrBroadcastRequested: false,
        syntheticWalletOnly: true,
      }),
    });
    try {
      await wallet?.dispose(status);
    } finally {
      await server.close();
      Object.assign(E2E_CONFIG, previous);
    }
  }
});
