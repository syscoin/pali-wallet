import { expect, test, type Page } from '@playwright/test';
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

const networks = [
  {
    chainId: 137,
    label: 'Synthetic Polygon icon',
    icon: 'pali-fixture-polygon',
    url: 'https://polygon.chain-icon.synthetic.invalid/rpc',
    color: '#8247e5',
  },
  {
    chainId: 10,
    label: 'Synthetic Optimism icon',
    icon: 'pali-fixture-optimism',
    url: 'https://optimism.chain-icon.synthetic.invalid/rpc',
    color: '#ff0420',
  },
];
const imageUrl = (icon: string) =>
  `https://c1.coinlore.com/img/25x25/${icon}.png`;
const svg = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="${color}"/></svg>`;
const imageData = (color: string) =>
  `data:image/svg+xml;base64,${Buffer.from(svg(color)).toString('base64')}`;
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};
const selection = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const network = state.vault.activeNetwork;
    return {
      chainId: network.chainId,
      kind: network.kind,
      url: network.url,
      label: network.label,
    };
  });
const header = (page: Page, label: string) =>
  page
    .locator('button')
    .filter({ has: page.getByTitle(label, { exact: true }) });

test('the real network header uses the selected chain icon and ignores an older delayed image', async ({}, info) => {
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const previous = { ...E2E_CONFIG };
  const fixture = createIsolatedVaultFixture();
  const server = await startUtxoFixtureServer();
  const holds = networks.map(gate);
  const imageRequests = [0, 0];
  const completedImages = [0, 0];
  const rpcReads: string[] = [];
  const deniedWrites: string[] = [];
  const observations: Record<string, unknown> = {};
  let closing = false;
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'ChainIconSynthetic!2026',
    rpcUrl: server.url,
  });
  try {
    wallet = await PaliWallet.launch('chain-icon-lifecycle', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    await wallet.context.route('https://chainlist.org/rpcs.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          networks.map((network) => ({
            name: network.label,
            chainId: network.chainId,
            networkId: network.chainId,
            icon: network.icon,
            nativeCurrency: {
              name: 'Synthetic Ether',
              symbol: 'ETH',
              decimals: 18,
            },
            rpc: [{ url: network.url }],
            explorers: [],
          }))
        ),
      })
    );
    const rpcs = new Map([
      ['https://ethereum-rpc.publicnode.com/', 1],
      ['https://mainnet.base.org/', 8453],
      ...networks.map(
        (network) => [network.url, network.chainId] as [string, number]
      ),
    ]);
    for (const [url, chainId] of rpcs) {
      await wallet.context.route(url, async (route) => {
        const request = route.request();
        if (request.method() === 'OPTIONS')
          return route.fulfill({
            status: 204,
            headers: {
              'access-control-allow-origin': '*',
              'access-control-allow-headers': '*',
            },
          });
        if (request.method() !== 'POST') return route.abort('blockedbyclient');
        const input = request.postDataJSON();
        const calls = Array.isArray(input) ? input : [input];
        const replies = calls.map((call: any) => {
          const params = call?.params;
          let result: unknown;
          if (call?.jsonrpc === '2.0' && Array.isArray(params)) {
            if (
              /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
                call.method || ''
              )
            ) {
              deniedWrites.push('attempted-write');
            } else if (call.method === 'eth_chainId' && params.length === 0) {
              result = `0x${chainId.toString(16)}`;
            } else if (call.method === 'net_version' && params.length === 0) {
              result = String(chainId);
            } else if (
              call.method === 'eth_blockNumber' &&
              params.length === 0
            ) {
              result = '0x1';
            } else if (
              ['eth_gasPrice', 'eth_maxPriorityFeePerGas'].includes(
                call.method
              ) &&
              params.length === 0
            ) {
              result = '0x3b9aca00';
            } else if (
              ['eth_getBalance', 'eth_getTransactionCount'].includes(
                call.method
              ) &&
              fixture.evmAddresses.some(
                (address) =>
                  address.toLowerCase() === String(params[0]).toLowerCase()
              )
            ) {
              result = '0x0';
            } else if (
              call.method === 'eth_getBlockByNumber' &&
              ['latest', '0x1'].includes(params[0])
            ) {
              result = {
                number: '0x1',
                hash: `0x${'12'.repeat(32)}`,
                parentHash: `0x${'11'.repeat(32)}`,
                nonce: '0x0000000000000000',
                timestamp: '0x1',
                difficulty: '0x0',
                gasLimit: '0x1c9c380',
                gasUsed: '0x0',
                miner: `0x${'00'.repeat(20)}`,
                extraData: '0x',
                transactions: [],
                baseFeePerGas: '0x3b9aca00',
              };
            }
          }
          if (result === undefined)
            return {
              jsonrpc: '2.0',
              id: call?.id ?? null,
              error: { code: -32601, message: 'Read-only chain icon fixture' },
            };
          rpcReads.push(`${chainId}:${call.method}`);
          return { jsonrpc: '2.0', id: call.id, result };
        });
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify(Array.isArray(input) ? replies : replies[0]),
        });
      });
    }
    for (const [index, network] of networks.entries()) {
      await wallet.context.route(imageUrl(network.icon), async (route) => {
        if (route.request().method() !== 'GET')
          return route.abort('blockedbyclient');
        imageRequests[index] += 1;
        await holds[index].promise;
        try {
          await route.fulfill({
            status: 200,
            contentType: 'image/svg+xml',
            body: svg(network.color),
          });
          completedImages[index] += 1;
        } catch (error) {
          if (!closing) throw error;
        }
      });
    }
    const page = wallet.page;
    const addNetwork = async (network: (typeof networks)[number]) => {
      await wallet!.gotoRoute('#/settings/networks/custom-rpc');
      await page
        .getByRole('combobox', { name: en.settings.label, exact: true })
        .fill(network.label);
      await page.locator('input#rpc_symbol').fill('ETH');
      await page.locator('input#rpc_chainId').fill(String(network.chainId));
      const input = page.locator('input#rpc_url');
      await input.fill(network.url);
      await input.press('Tab');
      await expect
        .poll(() => rpcReads.includes(`${network.chainId}:eth_chainId`))
        .toBe(true);
      const save = page.getByRole('button', {
        name: en.buttons.save,
        exact: true,
      });
      await expect(save).toBeEnabled();
      await save.click();
      await expect(page).toHaveURL(/#\/home$/);
      await expect
        .poll(() =>
          page.evaluate(async ({ chainId, url }) => {
            const state = await chrome.runtime.sendMessage({
              type: 'getCurrentState',
            });
            return state.vaultGlobal.networks.ethereum[chainId]?.url === url;
          }, network)
        )
        .toBe(true);
    };
    await wallet.step(
      'add the two synthetic public network configurations through Settings',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Ethereum Mainnet', 'EVM');
        for (const network of networks) await addNetwork(network);
        expect(await selection(page)).toMatchObject({
          chainId: 1,
          kind: 'ethereum',
          label: 'Ethereum Mainnet',
        });
        await page.evaluate(
          (expectedImages) => {
            const original = FileReader.prototype.readAsDataURL;
            const probe = {
              completed: [] as string[],
              restore: () => {
                FileReader.prototype.readAsDataURL = original;
                delete (window as any).__chainIconReads;
              },
            };
            (window as any).__chainIconReads = probe;
            FileReader.prototype.readAsDataURL = function (blob) {
              this.addEventListener(
                'loadend',
                () => {
                  const value = String(this.result);
                  if (expectedImages.includes(value))
                    probe.completed.push(value);
                },
                { once: true }
              );
              return original.call(this, blob);
            };
          },
          networks.map((network) => imageData(network.color))
        );
      }
    );
    await wallet.step(
      'the persistent header replaces the Ethereum SVG with its selected remote image',
      async () => {
        const before = header(page, 'Ethereum Mainnet');
        await expect(before.locator('svg').first()).toBeVisible();
        await expect(before.locator('img')).toHaveCount(0);
        const original = await before.elementHandle();
        await wallet!.switchNetwork(networks[0].label, 'EVM');
        expect(await selection(page)).toEqual({
          chainId: 137,
          kind: 'ethereum',
          label: networks[0].label,
          url: networks[0].url,
        });
        const current = header(page, networks[0].label);
        expect(
          await current.evaluate(
            (element, previousElement) => element === previousElement,
            original
          )
        ).toBe(true);
        await expect.poll(() => imageRequests[0]).toBeGreaterThan(0);
        await expect(current.locator('svg[viewBox="0 0 100 100"]')).toHaveCount(
          0
        );
        holds[0].release();
        const icon = current.locator('img[alt="Chain 137"]');
        await expect(icon).toHaveAttribute('src', imageData(networks[0].color));
        await expect
          .poll(() =>
            icon.evaluate(
              (element: HTMLImageElement) =>
                element.complete && element.naturalWidth === 24
            )
          )
          .toBe(true);
        observations.remote = {
          selection: await selection(page),
          src: await icon.getAttribute('src'),
        };
      }
    );
    await wallet.step(
      'an older delayed remote image cannot replace the newly selected local Base icon',
      async () => {
        await wallet!.switchNetwork(networks[1].label, 'EVM');
        expect(await selection(page)).toEqual({
          chainId: 10,
          kind: 'ethereum',
          label: networks[1].label,
          url: networks[1].url,
        });
        await expect.poll(() => imageRequests[1]).toBeGreaterThan(0);
        await wallet!.switchNetwork('Base', 'EVM');
        const selected = header(page, 'Base');
        const icon = selected.locator('img[alt="Chain 8453"]');
        await expect(icon).toBeVisible();
        const localSrc = await icon.getAttribute('src');
        expect(
          await icon.evaluate((element: HTMLImageElement) => element.src)
        ).toMatch(new RegExp(`^chrome-extension://${wallet!.extensionId}/`));
        await expect
          .poll(() =>
            icon.evaluate(
              (element: HTMLImageElement) =>
                element.complete && element.naturalWidth > 0
            )
          )
          .toBe(true);
        holds[1].release();
        await expect.poll(() => completedImages[1]).toBeGreaterThan(0);
        // Observe the original native FileReader completion. No extra fetch,
        // replacement result or guessed delay establishes this ordering.
        await expect
          .poll(() =>
            page.evaluate(
              (expectedImage) =>
                (window as any).__chainIconReads.completed.includes(
                  expectedImage
                ),
              imageData(networks[1].color)
            )
          )
          .toBe(true);
        await expect(icon).toHaveAttribute('src', localSrc!);
        expect(await selection(page)).toMatchObject({
          chainId: 8453,
          kind: 'ethereum',
          label: 'Base',
        });
        observations.local = {
          selection: await selection(page),
          src: localSrc,
        };
      }
    );
    expect(deniedWrites).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    status = 'passed';
  } finally {
    closing = true;
    holds.forEach((hold) => hold.release());
    try {
      await info.attach('chain-icon-lifecycle-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          runtime: extensionEvidence(),
          observations,
          rpcReads,
          imageRequests,
          completedImages,
          deniedWrites: [...deniedWrites, ...(routes?.deniedWrites || [])],
          proxyDeniedConnections: server.blocked.length,
          controllerStateReplaced: false,
        }),
      });
    } finally {
      try {
        await wallet?.page
          .evaluate(() => (window as any).__chainIconReads?.restore())
          .catch(() => undefined);
        await wallet?.dispose(status);
      } finally {
        try {
          await server.close();
        } finally {
          Object.assign(E2E_CONFIG, previous);
        }
      }
    }
  }
});
