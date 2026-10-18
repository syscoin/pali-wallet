import { expect, test, type Page } from '@playwright/test';
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

// Normal UI/controller flow with public synthetic metadata read over the
// network fence. No renderer state, signing response, or balances are patched.
test('asset toolbar and network autocomplete support keyboard use in narrow windows', async ({}, info) => {
  test.setTimeout(180_000);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'QA121SyntheticSettingsOnly!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const capture = async (page: Page, name: string) => {
    const screenshot = info.outputPath(`${name}.png`);
    await page.screenshot({ path: screenshot, animations: 'disabled' });
    await info.attach(name, { path: screenshot, contentType: 'image/png' });
  };
  try {
    wallet = await PaliWallet.launch('qa121-settings-regressions', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    const contract = '0x000000000000000000000000000000000000ed6e';
    const abi = AbiCoder.defaultAbiCoder();
    const replies = new Map([
      [
        id('name()').slice(0, 10),
        abi.encode(['string'], ['QA121 Synthetic Asset']),
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
        if (call.method === 'eth_call' && target === contract)
          result = replies.get(call.params[0].data.slice(0, 10));
        return result === undefined
          ? {
              jsonrpc: '2.0',
              id: call.id,
              error: {
                code: -32000,
                message: 'Synthetic read fixture does not support this method',
              },
            }
          : { jsonrpc: '2.0', id: call.id, result };
      });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(rpc) ? values : values[0]),
      });
    });
    await wallet.context.route(
      'https://chainlist.org/rpcs.json',
      async (route) => {
        const names = ['Ethereum QA Alpha', 'Ethereum QA Beta'];
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            names.map((name) => ({
              name,
              chainId: 5700,
              networkId: 5700,
              nativeCurrency: {
                name: 'Test Syscoin',
                symbol: 'TSYS',
                decimals: 18,
              },
              rpc: [{ url: 'https://rpc.tanenbaum.io/' }],
              explorers: [],
            }))
          ),
        });
      }
    );
    const page = wallet.page;
    await wallet.step(
      'import synthetic token through ordinary UI',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.gotoRoute('#/tokens/add?tab=custom');
        const custom = page.getByRole('button', {
          name: en.tokens.addCustomTab,
          exact: true,
        });
        if (await custom.count()) await custom.first().click();
        await page.locator('#custom-token-contract').fill(contract);
        const importToken = page.getByRole('button', {
          name: 'Import QAASSET token',
          exact: true,
        });
        await importToken.click();
        await expect(importToken).toBeDisabled();
      }
    );
    for (const [width, height] of [
      [320, 360],
      [400, 620],
    ]) {
      await wallet.step(
        `keyboard asset toolbar ${width}x${height}`,
        async () => {
          await page.setViewportSize({ width, height });
          await wallet!.gotoRoute('#/home?tab=assets');
          await page.locator('#assets-btn').click();
          const sort = page.getByRole('button', {
            name: en.tooltip.sortAssets,
            exact: true,
          });
          await expect(sort).toBeVisible();
          for (
            let i = 0;
            i < 20 &&
            !(await sort.evaluate((node) => node === document.activeElement));
            i++
          )
            await page.keyboard.press('Tab');
          await expect(sort).toBeFocused();
          await page.keyboard.press('Enter');
          await expect(
            page.getByRole('button', { name: en.send.balance, exact: true })
          ).toBeFocused();
          await page.keyboard.press('Tab');
          await expect(
            page.getByRole('button', {
              name: en.assetsHeader.name,
              exact: true,
            })
          ).toBeFocused();
          await page.keyboard.press('Enter');
          await expect(sort).toBeFocused();
          await expect(sort).toHaveAttribute('aria-expanded', 'false');
          await page.keyboard.press('Tab');
          const search = page.getByRole('button', {
            name: en.tooltip.searchAssets,
            exact: true,
          });
          await expect(search).toBeFocused();
          await page.keyboard.press('Space');
          const input = page.getByRole('textbox', {
            name: en.assetsHeader.tokenOrContractAddress,
          });
          await expect(input).toBeFocused();
          await page.keyboard.type('QAASSET');
          await expect(
            page.getByRole('button', { name: 'View details for QAASSET token' })
          ).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(search).toBeFocused();
          await expect(input).toHaveCount(0);
          await page.keyboard.press('Tab');
          const tokens = page.getByRole('button', {
            name: en.tooltip.viewTokens,
            exact: true,
          });
          await expect(tokens).toBeFocused();
          await page.keyboard.press('Tab');
          const nfts = page.getByRole('button', {
            name: en.tooltip.viewNFTs,
            exact: true,
          });
          await expect(nfts).toBeFocused();
          await page.keyboard.press('Enter');
          await expect(nfts).toHaveAttribute('aria-pressed', 'true');
          await page.keyboard.press('Shift+Tab');
          await page.keyboard.press('Space');
          await expect(tokens).toHaveAttribute('aria-pressed', 'true');
          await capture(page, `asset-toolbar-${width}x${height}`);
        }
      );
      await wallet.step(
        `keyboard network autocomplete ${width}x${height}`,
        async () => {
          await wallet!.gotoRoute('#/settings/networks/custom-rpc');
          const input = page.getByRole('combobox', {
            name: en.settings.label,
            exact: true,
          });
          await input.fill('Ethereum');
          const alpha = page.getByRole('option', { name: /Ethereum QA Alpha/ });
          const beta = page.getByRole('option', { name: /Ethereum QA Beta/ });
          await expect(alpha).toBeVisible();
          await page.keyboard.press('ArrowDown');
          await expect(alpha).toHaveAttribute('aria-selected', 'true');
          await page.keyboard.press('ArrowDown');
          await expect(beta).toHaveAttribute('aria-selected', 'true');
          await page.keyboard.press('Escape');
          await expect(input).toBeFocused();
          await expect(input).toHaveValue('Ethereum');
          await expect(input).toHaveAttribute('aria-expanded', 'false');
          await page.keyboard.press('ArrowDown');
          await page.keyboard.press('Tab');
          await expect(input).toHaveAttribute('aria-expanded', 'false');
          await expect(page.getByRole('listbox')).toHaveCount(0);
          await input.focus();
          await page.keyboard.press('ArrowUp');
          await expect(beta).toHaveAttribute('aria-selected', 'true');
          await page.keyboard.press('Enter');
          await expect(input).toHaveValue('Ethereum QA Beta');
          await expect(input).toHaveAttribute('aria-expanded', 'false');
          await expect(page.getByRole('listbox')).toHaveCount(0);
          await expect(page.locator('#rpc_chainId')).toHaveValue('5700');
          await expect(
            page.getByRole('button', { name: en.buttons.save, exact: true })
          ).toBeEnabled();
          await capture(page, `network-autocomplete-${width}x${height}`);
        }
      );
    }
    expect(routes.deniedWrites).toEqual([]);
    expect(deniedWrites).toEqual([]);
    status = 'passed';
  } finally {
    await wallet?.dispose(status);
    await server.close();
    Object.assign(E2E_CONFIG, previous);
  }
});
