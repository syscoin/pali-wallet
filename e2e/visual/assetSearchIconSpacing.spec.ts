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
test('asset contract search reserves the decorative icon area', async ({}, info) => {
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
    wallet = await PaliWallet.launch('asset-search-icon-spacing', {
      offlineHttpProxy: server.url,
      recordVideo: false,
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
    const selectCustomTab = async () => {
      await expect(page).toHaveURL(/#\/tokens\/add(?:\?|$)/);
      // The owned-token empty state can include another Add Custom button.
      // Select the tab itself only after the destination has rendered.
      const custom = page
        .getByRole('button', {
          name: en.tokens.addCustomTab,
          exact: true,
        })
        .and(page.locator('button[aria-pressed]'));
      await expect(custom).toHaveCount(1);
      await expect(custom).toBeVisible();
      await custom.click();
      await expect(custom).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#custom-token-contract')).toBeVisible();
    };
    await selectCustomTab();
    const importAsset = async (address: string, symbol: string) => {
      await page.locator('#custom-token-contract').fill(address);
      const button = page.getByRole('button', {
        name: `Import ${symbol} token`,
        exact: true,
      });
      await button.click();
      await expect(button).toBeDisabled();
      // The success toast temporarily overlays the lower list in short windows.
      // Let it dismiss naturally before evaluating the settled search layout.
      const successToast = page.getByText(
        en.tokens.hasBeenAddedToYourWallet.replace('{{token}}', symbol),
        { exact: true }
      );
      await expect(successToast).toBeVisible();
      await expect(successToast).toBeHidden({ timeout: 15_000 });
    };
    await importAsset(contract, 'QAASSET');
    const measurements: unknown[] = [];
    for (const viewport of [
      { width: 400, height: 620 },
      { width: 320, height: 360 },
    ]) {
      await page.setViewportSize(viewport);
      await wallet.gotoRoute('#/home?tab=assets');
      await page.locator('#assets-btn').click();
      await page
        .getByRole('button', { name: en.tooltip.viewTokens, exact: true })
        .click();
      await page
        .getByRole('button', { name: en.tooltip.searchAssets, exact: true })
        .click();
      const input = page.getByRole('textbox', {
        name: en.assetsHeader.tokenOrContractAddress,
        exact: true,
      });
      const icon = input.locator('xpath=..').locator('svg');
      await expect(icon).toHaveCount(1);
      const detail = page.getByRole('button', {
        name: 'View details for QAASSET token',
        exact: true,
      });
      for (const query of ['QAASSET', contract]) {
        await input.fill(query);
        await input.press('End');
        await expect(input).toBeFocused();
        await expect(input).toHaveValue(query);
        await expect(detail).toBeVisible();
        const box = await input.evaluate((element) => {
          const field = element as HTMLInputElement;
          const glyph = field.parentElement!.querySelector('svg')!;
          const a = field.getBoundingClientRect(),
            b = glyph.getBoundingClientRect();
          const style = getComputedStyle(field);
          const textRight =
            a.right -
            parseFloat(style.paddingRight) -
            parseFloat(style.borderRightWidth);
          const hit = document.elementFromPoint(
            b.x + b.width / 2,
            b.y + b.height / 2
          );
          return {
            input: {
              left: a.left,
              right: a.right,
              top: a.top,
              bottom: a.bottom,
            },
            icon: {
              left: b.left,
              right: b.right,
              top: b.top,
              bottom: b.bottom,
            },
            textRight,
            gap: b.left - textRight,
            paddingRight: style.paddingRight,
            clickHitsInput: hit === field,
            iconPointerEvents: getComputedStyle(glyph).pointerEvents,
            scrollWidth: field.scrollWidth,
            clientWidth: field.clientWidth,
          };
        });
        const label =
          viewport.width +
          '-' +
          (query === contract ? 'long-contract' : 'short-symbol');
        const file = info.outputPath(label + '.png');
        await page.screenshot({
          path: file,
          animations: 'disabled',
          caret: 'initial',
        });
        await info.attach(label, { path: file, contentType: 'image/png' });
        measurements.push({ viewport, query, ...box });
        // A real trailing icon must not cover editable text or absorb input clicks.
        expect(box.gap).toBeGreaterThanOrEqual(8);
        expect(box.icon.left).toBeGreaterThan(box.input.left);
        expect(box.icon.right).toBeLessThan(box.input.right);
        expect(
          Math.abs(
            (box.icon.top + box.icon.bottom) / 2 -
              (box.input.top + box.input.bottom) / 2
          )
        ).toBeLessThanOrEqual(1);
        expect(box.clickHitsInput).toBe(true);
      }
      const iconBox = await icon.boundingBox();
      await input.blur();
      await page.mouse.click(
        iconBox!.x + iconBox!.width / 2,
        iconBox!.y + iconBox!.height / 2
      );
      measurements.push({
        viewport,
        iconClickFocusedInput: await input.evaluate(
          (e) => e === document.activeElement
        ),
      });
      await expect(input).toBeFocused();
      await input.focus();
      await input.press('Escape');
      await expect(input).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: en.tooltip.searchAssets, exact: true })
      ).toBeFocused();
      await page
        .getByRole('button', { name: en.tooltip.searchAssets, exact: true })
        .click();
      await expect(input).toHaveValue('');
      await input.fill('QAASSET');
      await expect(detail).toBeVisible();
      await page
        .getByRole('button', { name: en.buttons.back, exact: true })
        .click();
      await expect(input).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: en.tooltip.searchAssets, exact: true })
      ).toBeFocused();
    }
    expect(routes.deniedWrites).toEqual([]);
    expect(deniedWrites).toEqual([]);
    await info.attach('asset-search-icon-observation', {
      contentType: 'application/json',
      body: JSON.stringify(
        {
          runtime: extensionEvidence(),
          measurements,
          deniedWrites,
          fixtureDeniedWrites: routes.deniedWrites,
          broadcast: false,
        },
        null,
        2
      ),
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
