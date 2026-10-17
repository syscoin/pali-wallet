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

// Read-only RPC fixtures in a disposable wallet; no renderer state overrides,
// private export, signing, or public network forwarding.
test('token and NFT searches distinguish empty results and clear back to the full list', async ({}, info) => {
  test.setTimeout(180_000);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(process.env.PALI_TEST_DAPP_EXTENSION_PATH || '')).toBe(
    true
  );
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'QA122SyntheticOnly!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('qa122-settings-search-regressions', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    const contract = '0x000000000000000000000000000000000000ed6e';
    const nftContract = '0x000000000000000000000000000000000000ed6f';
    const abi = AbiCoder.defaultAbiCoder();
    const tokenReplies = new Map([
      [
        id('name()').slice(0, 10),
        abi.encode(['string'], ['QA122 Synthetic Asset']),
      ],
      [id('symbol()').slice(0, 10), abi.encode(['string'], ['QAASSET'])],
      [id('decimals()').slice(0, 10), abi.encode(['uint8'], [8])],
      [
        id('balanceOf(address)').slice(0, 10),
        abi.encode(['uint256'], ['123000000']),
      ],
      [
        id('totalSupply()').slice(0, 10),
        abi.encode(['uint256'], ['123000000']),
      ],
      [
        id('supportsInterface(bytes4)').slice(0, 10),
        abi.encode(['bool'], [false]),
      ],
    ]);
    const nftReplies = new Map(tokenReplies);
    nftReplies.set(
      id('name()').slice(0, 10),
      abi.encode(['string'], ['QA122 Synthetic Collection'])
    );
    nftReplies.set(
      id('symbol()').slice(0, 10),
      abi.encode(['string'], ['QANFT'])
    );
    nftReplies.set(
      id('balanceOf(address)').slice(0, 10),
      abi.encode(['uint256'], ['2'])
    );
    const deniedWrites: string[] = [];
    await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const rpc = route.request().postDataJSON();
      const calls = Array.isArray(rpc) ? rpc : [rpc];
      if (
        calls.some((call: any) =>
          /^(eth_send|wallet_send|sys_sign)/i.test(call?.method || '')
        )
      ) {
        deniedWrites.push('attempted-write');
        return route.abort('blockedbyclient');
      }
      if (
        !calls.some(
          (call: any) =>
            ['eth_call', 'eth_getCode'].includes(call.method) &&
            [contract, nftContract].includes(
              (call.params?.[0]?.to || call.params?.[0])?.toLowerCase()
            )
        )
      )
        return route.fallback();
      const values = calls.map((call: any) => {
        const target = (
          call.params?.[0]?.to || call.params?.[0]
        )?.toLowerCase();
        let result: unknown;
        if (call.method === 'eth_chainId') result = '0x1644';
        if (
          call.method === 'eth_getCode' &&
          [contract, nftContract].includes(target)
        )
          result = '0x60006000fd';
        if (call.method === 'eth_call' && target === contract)
          result = tokenReplies.get(call.params[0].data.slice(0, 10));
        if (call.method === 'eth_call' && target === nftContract) {
          const data = call.params[0].data;
          result = data.startsWith(id('supportsInterface(bytes4)').slice(0, 10))
            ? abi.encode(['bool'], [data.slice(10, 18) === '80ac58cd'])
            : nftReplies.get(data.slice(0, 10));
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
    const page = wallet.page;
    await wallet.importSeedAndCreatePassword();
    await wallet.switchNetwork('Syscoin NEVM Testnet', 'EVM');
    await page.locator('#assets-btn').click();
    await expect(
      page.getByText(en.home.youHaveNoTokens, { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText(en.assetsHeader.noMatchingAssets, { exact: true })
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: en.home.importToken, exact: true })
      .click();
    const custom = page.getByRole('button', {
      name: en.tokens.addCustomTab,
      exact: true,
    });
    if (await custom.count()) await custom.first().click();
    const importAsset = async (address: string, symbol: string) => {
      await page.locator('#custom-token-contract').fill(address);
      const button = page.getByRole('button', {
        name: `Import ${symbol} token`,
        exact: true,
      });
      await button.click();
      await expect(button).toBeDisabled();
    };
    await importAsset(contract, 'QAASSET');
    const checkSearch = async (
      symbol: string,
      isNft: boolean,
      width: number,
      height: number
    ) => {
      await page.setViewportSize({ width, height });
      await wallet!.gotoRoute('#/home?tab=assets');
      await page.locator('#assets-btn').click();
      await page
        .getByRole('button', {
          name: isNft ? en.tooltip.viewNFTs : en.tooltip.viewTokens,
          exact: true,
        })
        .click();
      await page
        .getByRole('button', { name: en.tooltip.searchAssets, exact: true })
        .click();
      const input = page.getByRole('textbox', {
        name: en.assetsHeader.tokenOrContractAddress,
      });
      const details = page.getByRole('button', {
        name: `View details for ${symbol} ${isNft ? 'collection' : 'token'}`,
      });
      await input.fill(` ${symbol} `);
      await expect(input).toHaveValue(` ${symbol} `);
      await expect(details).toBeVisible();
      await input.fill('no-such-asset');
      await expect(details).toHaveCount(0);
      await expect(
        page
          .getByRole('status')
          .filter({ hasText: en.assetsHeader.noMatchingAssets })
      ).toBeVisible();
      await expect(
        page.getByText(
          isNft ? en.home.youHaveNoNfts : en.home.youHaveNoTokens,
          { exact: true }
        )
      ).toHaveCount(0);
      const clear = page.getByRole('button', {
        name: en.assetsHeader.clearSearch,
        exact: true,
      });
      await input.press('Tab');
      await expect(clear).toBeFocused();
      const screenshot = info.outputPath(
        `${isNft ? 'nft' : 'token'}-no-results-${width}x${height}.png`
      );
      await page.screenshot({ path: screenshot, animations: 'disabled' });
      await info.attach(`no-results-${symbol}-${width}`, {
        path: screenshot,
        contentType: 'image/png',
      });
      await page.keyboard.press('Enter');
      await expect(input).toHaveValue('');
      await expect(input).toBeFocused();
      await expect(details).toBeVisible();
      await expect(
        page.getByText(en.assetsHeader.noMatchingAssets, { exact: true })
      ).toHaveCount(0);
      await input.press('Escape');
    };
    for (const [width, height] of [
      [320, 360],
      [400, 620],
    ])
      await checkSearch('QAASSET', false, width, height);
    await wallet.gotoRoute('#/home?tab=assets');
    await page.locator('#assets-btn').click();
    await page
      .getByRole('button', { name: en.tooltip.viewNFTs, exact: true })
      .click();
    await expect(
      page.getByText(en.home.youHaveNoNfts, { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText(en.assetsHeader.noMatchingAssets, { exact: true })
    ).toHaveCount(0);
    await wallet.gotoRoute('#/tokens/add?tab=custom');
    if (await custom.count()) await custom.first().click();
    await importAsset(nftContract, 'QANFT');
    for (const [width, height] of [
      [320, 360],
      [400, 620],
    ])
      await checkSearch('QANFT', true, width, height);
    expect(routes.deniedWrites).toEqual([]);
    expect(deniedWrites).toEqual([]);
    await info.attach('runtime-evidence', {
      body: JSON.stringify(
        {
          ...extensionEvidence(),
          deniedWrites: [...routes.deniedWrites, ...deniedWrites],
          controllerStateReplaced: false,
          simulated: true,
          publicSyntheticOnly: true,
        },
        null,
        2
      ),
      contentType: 'application/json',
    });
    status = 'passed';
  } finally {
    await wallet?.dispose(status);
    await server.close();
    Object.assign(E2E_CONFIG, previous);
  }
});
