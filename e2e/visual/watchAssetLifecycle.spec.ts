import { expect, test } from '@playwright/test';
import { AbiCoder, id } from 'ethers';
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

for (const changedContext of ['account', 'network'] as const) {
  test(`watch-asset preview cannot be reused after a wallet ${changedContext} change`, async ({}, info) => {
    test.setTimeout(120_000);
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    expect(
      path.isAbsolute(process.env.PALI_TEST_DAPP_EXTENSION_PATH || '')
    ).toBe(true);
    expect(E2E_CONFIG.extensionPath).toBe(
      process.env.PALI_TEST_DAPP_EXTENSION_PATH
    );
    const before = { ...E2E_CONFIG };
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'WatchAssetSyntheticOnly!2026',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    // The basic metadata path uses the on-chain symbol as its display name.
    const tokenName = 'REVIEW';
    const contract = '0x000000000000000000000000000000000000ed6e';
    const metadataReads: string[] = [];
    const deniedWrites: string[] = [];
    let automaticallyClosed = false;
    try {
      wallet = await PaliWallet.launch(`watch-asset-${changedContext}-scope`, {
        offlineHttpProxy: server.url,
        viewport: { width: 400, height: 620 },
      });
      const routes = await installIsolatedVaultRoutes(
        wallet.context,
        createIsolatedVaultFixture(),
        server.url
      );
      const abi = AbiCoder.defaultAbiCoder();
      const replies = new Map([
        [id('name()').slice(0, 10), abi.encode(['string'], [tokenName])],
        [id('symbol()').slice(0, 10), abi.encode(['string'], ['REVIEW'])],
        [id('decimals()').slice(0, 10), abi.encode(['uint8'], [6])],
        [
          id('balanceOf(address)').slice(0, 10),
          abi.encode(['uint256'], ['12000000']),
        ],
        [
          id('totalSupply()').slice(0, 10),
          abi.encode(['uint256'], ['12000000']),
        ],
        [
          id('supportsInterface(bytes4)').slice(0, 10),
          abi.encode(['bool'], [false]),
        ],
      ]);
      // Public synthetic contract reads only. This supplements the existing
      // launch-time deny proxy; no controller/store/signature is replaced.
      await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const rpc = route.request().postDataJSON();
        const calls = Array.isArray(rpc) ? rpc : [rpc];
        if (
          calls.some((call: any) =>
            /^(?:eth_send|wallet_send|sys_sign)/i.test(call?.method || '')
          )
        ) {
          deniedWrites.push('attempted-write');
          return route.abort('blockedbyclient');
        }
        if (
          !calls.some(
            (call: any) =>
              ['eth_call', 'eth_getCode'].includes(call.method) &&
              (call.params?.[0]?.to || call.params?.[0])?.toLowerCase() ===
                contract
          )
        )
          return route.fallback();
        const values = calls.map((call: any) => {
          const target = (
            call.params?.[0]?.to || call.params?.[0]
          )?.toLowerCase();
          let result: unknown;
          if (call.method === 'eth_chainId') result = '0x1644';
          if (call.method === 'eth_getCode' && target === contract)
            result = '0x60006000fd';
          if (call.method === 'eth_call' && target === contract) {
            const selector = call.params[0].data.slice(0, 10);
            result = replies.get(selector);
            metadataReads.push(selector);
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
          body: JSON.stringify(Array.isArray(rpc) ? values : values[0]),
        });
      });
      await wallet.step(
        'open the reviewed token with real metadata decoding',
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await wallet!.ensureOnHome();
        }
      );
      const review = await wallet.context.newPage();
      await wallet.step(
        'verify the original preview and Add action',
        async (capture) => {
          try {
            await review.goto(
              `chrome-extension://${
                wallet!.extensionId
              }/external.html?route=watch-asset&data=${encodeURIComponent(
                JSON.stringify({
                  host: 'synthetic-watch-asset.invalid',
                  eventName: 'synthetic-watch-asset-preview-only',
                  asset: { type: 'ERC20', options: { address: contract } },
                })
              )}`
            );
            await expect(
              review.getByText(tokenName, { exact: true }).first()
            ).toBeVisible();
            await expect(
              review.getByRole('button', { name: contract, exact: true })
            ).toBeVisible();
            await expect(
              review.locator('p').filter({
                hasText: new RegExp(`^${en.settings.decimals}\\s*6$`),
              })
            ).toBeVisible();
            await expect(
              review.getByRole('button', {
                name: en.buttons.addToken,
                exact: true,
              })
            ).toBeEnabled();
          } finally {
            if (!review.isClosed()) await capture(review);
          }
        }
      );
      await wallet.step(
        `change the wallet ${changedContext} through normal UI`,
        async () => {
          if (changedContext === 'network') {
            await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
          } else {
            await wallet!.gotoRoute('#/settings/account/new');
            await wallet!.page
              .locator('#account-name-input')
              .fill('Second watch-asset account');
            await wallet!.page.locator('#create-btn').click();
            await wallet!.page
              .getByRole('button', { name: /^ok$/i })
              .first()
              .click();
            await wallet!.ensureOnHome();
          }
        }
      );
      await wallet.step(
        'discard the old approval while keeping its close action reachable',
        async (capture) => {
          try {
            await expect
              .poll(async () =>
                review.isClosed()
                  ? true
                  : review
                      .getByText(en.transactions.psbtSigningContextChanged, {
                        exact: true,
                      })
                      .isVisible()
                      .catch(() => review.isClosed())
              )
              .toBe(true);
            automaticallyClosed = review.isClosed();
            if (automaticallyClosed) return;
            await expect(
              review.getByText(tokenName, { exact: true })
            ).toHaveCount(0);
            await expect(
              review.getByRole('button', {
                name: en.buttons.addToken,
                exact: true,
              })
            ).toHaveCount(0);
            const close = review.getByRole('button', {
              name: en.buttons.close,
              exact: true,
            });
            await expect(close).toBeEnabled();
            await close.scrollIntoViewIfNeeded();
            const bounds = await close.boundingBox();
            expect(bounds).not.toBeNull();
            expect(bounds!.y).toBeGreaterThanOrEqual(0);
            expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(620);
            await capture(review);
            await Promise.all([review.waitForEvent('close'), close.click()]);
          } finally {
            if (!review.isClosed()) await capture(review);
          }
        }
      );
      expect(metadataReads).toContain(id('symbol()').slice(0, 10));
      expect(metadataReads).toContain(id('decimals()').slice(0, 10));
      expect(deniedWrites).toEqual([]);
      expect(routes.deniedWrites).toEqual([]);
      await info.attach('watch-asset-lifecycle-evidence', {
        body: JSON.stringify(
          {
            ...extensionEvidence(),
            changedContext,
            automaticallyClosed,
            standalonePreviewOnly: true,
            providerRequestSettlementTested: false,
            controllerStateReplaced: false,
            syntheticMetadataOnly: true,
            metadataReads,
            deniedWrites: [...deniedWrites, ...routes.deniedWrites],
          },
          null,
          2
        ),
        contentType: 'application/json',
      });
      status = 'passed';
    } finally {
      try {
        await wallet?.dispose(status);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, before);
      }
    }
  });
}
