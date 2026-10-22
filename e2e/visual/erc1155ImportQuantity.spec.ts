import { expect, test } from '@playwright/test';
import { createHash } from 'crypto';
import { AbiCoder, id } from 'ethers';
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

const CONTRACT = '0x000000000000000000000000000000000000e115';
const SYMBOL = 'HUGE1155';
const TOKEN_ID = '7';
const QUANTITY =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';

test('manual ERC1155 import and Send MAX retain the exact verified quantity', async ({}, info) => {
  test.setTimeout(120_000);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(process.env.PALI_TEST_DAPP_EXTENSION_PATH || '')).toBe(
    true
  );
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  const before = { ...E2E_CONFIG };
  const fixture = createIsolatedVaultFixture();
  const server = await startUtxoFixtureServer();
  const abi = AbiCoder.defaultAbiCoder();
  const selector = (signature: string) => id(signature).slice(0, 10);
  const reads: string[] = [];
  const ownershipReads: { balances: string[]; tokenIds: string[] }[] = [];
  let currentQuantity = QUANTITY;
  const deniedWrites: string[] = [];
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'Erc1155PreviewSynthetic!2026',
    chainId: 5700,
    networkLabel: 'Syscoin NEVM Testnet',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  let observedPreviewText: string | null = null;
  let observedDetailsOwnedText: string | null = null;
  try {
    wallet = await PaliWallet.launch('erc1155-import-quantity', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    // Supply ABI-encoded contract reads, not controller results or renderer
    // state. The real SDK detects ERC1155 and derives numeric/raw quantities.
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
        if (call?.method === 'eth_chainId') result = '0x1644';
        const target = (
          call?.params?.[0]?.to || call?.params?.[0]
        )?.toLowerCase();
        if (call?.method === 'eth_getCode' && target === CONTRACT) {
          reads.push('eth_getCode');
          result = '0x60006000fd';
        }
        if (call?.method === 'eth_call' && target === CONTRACT) {
          const data = call.params[0].data as string;
          const prefix = data.slice(0, 10);
          if (prefix === selector('name()')) {
            reads.push('name');
            result = abi.encode(['string'], ['Synthetic Huge Editions']);
          }
          if (prefix === selector('symbol()')) {
            reads.push('symbol');
            result = abi.encode(['string'], [SYMBOL]);
          }
          if (prefix === selector('supportsInterface(bytes4)')) {
            const [value] = abi.decode(['bytes4'], `0x${data.slice(10)}`);
            reads.push(`supportsInterface:${value}`);
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
              reads.push('balanceOf');
              result = abi.encode(
                ['uint256'],
                [
                  [TOKEN_ID, '8'].includes(String(tokenId))
                    ? currentQuantity
                    : '0',
                ]
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
              const balances = ids.map((value) =>
                [TOKEN_ID, '8'].includes(value) ? currentQuantity : '0'
              );
              reads.push('balanceOfBatch');
              ownershipReads.push({ tokenIds: ids, balances });
              result = abi.encode(['uint256[]'], [balances]);
            }
          }
        }
        return result === undefined
          ? {
              jsonrpc: '2.0',
              id: call.id,
              error: { code: -32000, message: 'Unsupported synthetic read' },
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
    await wallet.step(
      'import a disposable synthetic wallet and select the EVM fixture',
      async (capture) => {
        try {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await wallet!.ensureOnHome();
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      }
    );
    await wallet.step(
      'open manual token import through the normal Assets screen',
      async (capture) => {
        try {
          await page.locator('#assets-btn').click();
          await page
            .getByRole('button', { name: en.home.importToken, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/tokens\/add(?:\?|$)/);
          const field = page.locator('#custom-token-contract');
          const custom = page
            .getByRole('button', { name: en.tokens.addCustomTab, exact: true })
            .first();
          await expect(field.or(custom).first()).toBeVisible();
          if (await custom.isVisible()) await custom.click();
          await expect(field).toBeVisible();
          await field.fill(CONTRACT);
          await expect(page.locator('#custom-token-id')).toBeVisible();
          expect(reads).toContain('supportsInterface:0xd9b67a26');
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      }
    );
    await wallet.step(
      'verify the huge token ID quantity through the real SDK and preview formatter',
      async (capture) => {
        try {
          await page.locator('#custom-token-id').fill(TOKEN_ID);
          const importToken = page.getByRole('button', {
            name: `Import ${SYMBOL} token`,
            exact: true,
          });
          await expect(importToken).toBeEnabled();
          const row = page.getByRole('listitem').filter({ has: importToken });
          observedPreviewText = await row.innerText();
          await expect(row).toContainText('1.16e77');
          await expect(row).not.toContainText('9.01e15');
          const title = en.tokens.balanceForTokenId.replace(
            '{{balance}}',
            QUANTITY
          );
          await expect(page.getByTitle(title, { exact: true })).toBeVisible();
          expect(ownershipReads).toContainEqual({
            tokenIds: [TOKEN_ID],
            balances: [QUANTITY],
          });
          expect([...deniedWrites, ...routes!.deniedWrites]).toEqual([]);
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      }
    );
    await wallet.step(
      'retain verified custom ownership through the ordinary View Details action',
      async (capture) => {
        try {
          const importToken = page.getByRole('button', {
            name: `Import ${SYMBOL} token`,
            exact: true,
          });
          const row = page.getByRole('listitem').filter({ has: importToken });
          await row
            .getByRole('button', {
              name: en.tokens.viewTokenDetails.replace('{{symbol}}', SYMBOL),
              exact: true,
            })
            .click();
          await expect(page).toHaveURL(/#\/home\/details$/);
          const owned = page
            .getByText('Owned', { exact: true })
            .locator('..')
            .locator('span')
            .last();
          observedDetailsOwnedText = await owned.innerText();
          await expect(owned).toHaveAttribute('title', QUANTITY);
          await expect(owned).toHaveText('1.16e77 NFTs');
          await page
            .getByRole('button', { name: en.buttons.close, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/tokens\/add(?:\?|$)/);
          await expect(page.locator('#custom-token-contract')).toHaveValue(
            CONTRACT
          );
          await expect(page.locator('#custom-token-id')).toHaveValue(TOKEN_ID);
          await expect(importToken).toBeEnabled();
          expect([...deniedWrites, ...routes!.deniedWrites]).toEqual([]);
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      }
    );
    await wallet.step(
      'import the verified token and preserve its exact quantity in Send MAX',
      async (capture) => {
        try {
          const importToken = page.getByRole('button', {
            name: `Import ${SYMBOL} token`,
            exact: true,
          });
          await importToken.click();
          await expect(importToken).toBeDisabled();
          for (const alias of ['07', '0x07']) {
            await page.locator('#custom-token-id').fill(alias);
            await expect(page.locator('#custom-token-id')).toHaveValue(alias);
            await expect(
              page.getByTitle(
                en.tokens.balanceForTokenId.replace('{{balance}}', QUANTITY),
                { exact: true }
              )
            ).toBeVisible();
            await expect(importToken).toBeDisabled();
            const membership = await page.evaluate(async (contract) => {
              const state = await chrome.runtime.sendMessage({
                type: 'getCurrentState',
              });
              const account = state.vault.activeAccount;
              return state.vault.accountAssets[account.type][
                account.id
              ].ethereum
                .filter(
                  (asset: any) =>
                    asset.contractAddress.toLowerCase() === contract
                )
                .map((asset: any) => ({
                  id: asset.id,
                  tokenId: asset.tokenId,
                  chainId: asset.chainId,
                }));
            }, CONTRACT);
            expect(membership).toEqual([
              {
                id: `${CONTRACT}-5700-${TOKEN_ID}`,
                tokenId: TOKEN_ID,
                chainId: 5700,
              },
            ]);
          }
          // A different on-chain ID remains available; only equivalent IDs
          // are disabled. Keep it unimported so the MAX control selects ID7.
          await page.locator('#custom-token-id').fill('8');
          await expect(importToken).toBeEnabled();
          expect(ownershipReads).toContainEqual({
            tokenIds: ['8'],
            balances: [QUANTITY],
          });
          await page.locator('#custom-token-id').fill(TOKEN_ID);
          await expect(importToken).toBeDisabled();
          await wallet!.gotoRoute('#/send/eth');
          await page.getByRole('button', { name: 'TSYS', exact: true }).click();
          await page
            .locator('button[role="menuitem"]')
            .filter({ hasText: SYMBOL })
            .click();
          await expect(
            page.getByRole('button', { name: SYMBOL, exact: true })
          ).toBeVisible();
          await page.getByRole('button', { name: 'MAX', exact: true }).click();
          await expect(page.locator('#with-max-button')).toHaveValue(QUANTITY);
          await expect(page.locator('#with-max-button')).toBeVisible();
          for (const viewport of [
            { width: 400, height: 620 },
            { width: 320, height: 360 },
          ]) {
            await page.setViewportSize(viewport);
            const balanceRow = page
              .getByText(en.components.yourBalance, { exact: true })
              .locator('..');
            await expect
              .poll(() =>
                balanceRow.evaluate((row) =>
                  [...row.querySelectorAll('p')].every((element) => {
                    const bounds = element.getBoundingClientRect();
                    return bounds.left >= 0 && bounds.right <= innerWidth;
                  })
                )
              )
              .toBe(true);
            await expect(page.locator('#with-max-button')).toHaveValue(
              QUANTITY
            );
            await info.attach(
              `exact-max-${viewport.width}x${viewport.height}`,
              {
                body: await page.screenshot({ animations: 'disabled' }),
                contentType: 'image/png',
              }
            );
          }
          expect([...deniedWrites, ...routes!.deniedWrites]).toEqual([]);
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      }
    );
    await wallet.step(
      'keep the open owned collection current after genuine contract balance refreshes',
      async (capture) => {
        try {
          await page.setViewportSize({ width: 400, height: 620 });
          await wallet!.ensureOnHome();
          await page.locator('#assets-btn').click();
          await page
            .getByRole('button', { name: en.tooltip.viewNFTs, exact: true })
            .click();
          await page
            .getByRole('button', {
              name: `View details for ${SYMBOL} collection`,
              exact: true,
            })
            .click();
          await page
            .getByRole('button', {
              name: `eye ${en.send.viewCollectionItems}`,
              exact: true,
            })
            .click();
          const header = page.getByText(/• ERC-1155$/);
          const amount = page
            .getByText('Amount', { exact: true })
            .locator('..');
          await expect(header).toHaveAttribute('title', QUANTITY);
          await expect(amount).toHaveAttribute('title', QUANTITY);
          const collectionUrl = page.url();
          for (const balance of ['7', '0', QUANTITY]) {
            currentQuantity = balance;
            // Exercise the ordinary background asset refresh while the same
            // collection stays mounted. Only ABI transport responses change;
            // neither renderer state nor controller results are replaced.
            const published = await page.evaluate(async (contract) => {
              const initialState = await chrome.runtime.sendMessage({
                type: 'getCurrentState',
              });
              const result = await chrome.runtime.sendMessage({
                type: 'CONTROLLER_ACTION',
                data: {
                  methods: ['wallet', 'updateAssetsFromCurrentAccount'],
                  params: [
                    {
                      isBitcoinBased: false,
                      activeAccount: initialState.vault.activeAccount,
                      activeNetwork: initialState.vault.activeNetwork,
                      isPolling: true,
                    },
                  ],
                },
              });
              if (result && (result.error || result.success === false))
                throw new Error(
                  `Asset refresh failed: ${JSON.stringify(result)}`
                );
              const after = await chrome.runtime.sendMessage({
                type: 'getCurrentState',
              });
              const accountRef = after.vault.activeAccount;
              const token = after.vault.accountAssets[accountRef.type][
                accountRef.id
              ].ethereum.find(
                (asset: any) =>
                  asset.contractAddress.toLowerCase() === contract &&
                  asset.tokenId === '7' &&
                  asset.chainId === 5700
              );
              return { balance: token?.balance, rawBalance: token?.rawBalance };
            }, CONTRACT);
            expect(published).toEqual({
              // The existing NFT transport helper caps its legacy numeric
              // field; rawBalance and the rendered exact titles stay lossless.
              balance: Math.min(Number(balance), Number.MAX_SAFE_INTEGER),
              rawBalance: balance,
            });
            expect(page.url()).toBe(collectionUrl);
            await expect(header).toHaveAttribute('title', balance);
            await expect(amount).toHaveAttribute('title', balance);
            if (balance !== QUANTITY)
              await info.attach(`live-owned-quantity-${balance}`, {
                body: await page.screenshot({ animations: 'disabled' }),
                contentType: 'image/png',
              });
          }
          expect([...deniedWrites, ...routes!.deniedWrites]).toEqual([]);
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      }
    );
    status = 'passed';
  } finally {
    try {
      await info.attach('runtime-and-contract-read-evidence', {
        body: JSON.stringify(
          {
            ...runtime,
            testSourceSha256: createHash('sha256')
              .update(fs.readFileSync(__filename))
              .digest('hex'),
            syntheticHttpOnly: true,
            controllerStateReplaced: false,
            contract: CONTRACT,
            tokenId: TOKEN_ID,
            quantity: QUANTITY,
            expectedCompactPreview: '1.16e77',
            observedPreviewText,
            observedDetailsOwnedText,
            reads,
            ownershipReads,
            deniedWrites: [...deniedWrites, ...(routes?.deniedWrites ?? [])],
            proxyDeniedConnections: server.blocked.length,
          },
          null,
          2
        ),
        contentType: 'application/json',
      });
    } finally {
      try {
        await wallet?.dispose(status);
      } finally {
        try {
          await server.close();
        } finally {
          Object.assign(E2E_CONFIG, before);
        }
      }
    }
  }
});
