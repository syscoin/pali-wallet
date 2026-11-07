import { expect, test, type Locator, type Page } from '@playwright/test';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import path from 'path';
import { utils as sys } from 'syscoinjs-lib';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { createPendingNativeChain } from '../harness/pendingNativeChain';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const tabTo = async (page: Page, target: Locator) => {
  for (let count = 0; count < 40; count++) {
    if (await target.evaluate((element) => element === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
};

const exposed = (control: Locator) =>
  control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    if (
      box.width <= 0 ||
      box.height <= 0 ||
      box.left < 0 ||
      box.top < 0 ||
      box.right > innerWidth ||
      box.bottom > innerHeight
    )
      return false;
    return [
      [box.left + box.width / 2, box.top + box.height / 2],
      [box.left + 2, box.top + 2],
      [box.right - 2, box.bottom - 2],
    ].every(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === element || element.contains(hit));
    });
  });

// Exact startup reads observed before selecting the synthetic test network.
// Everything else still passes through the shared deny-by-default fixture.
function startupReads() {
  const config = getNetworkConfig(57, 'sys');
  const xpub = new sys.HDSigner(
    UTXO_FIXTURE_SEED,
    '',
    false,
    config.networks,
    57,
    config.types.zPubType,
    84
  ).getAccountXpub();
  const reads = new Map<string, unknown>([
    [
      'https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json',
      [],
    ],
    [
      'https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/urls/urls-darklist.json',
      [],
    ],
    [
      'https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/master/src/config.json',
      { blacklist: [], whitelist: [], fuzzylist: [] },
    ],
    [
      'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json',
      [],
    ],
    [
      'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/domains.json',
      [],
    ],
  ]);
  for (const origin of [
    'https://blockbook.syscoin.org',
    'https://blockbook-dev.syscoin.org',
  ])
    reads.set(`${origin}/api/v2/tickers/currency`, {
      ts: 1,
      rates: { usd: 1 },
    });
  for (const query of [
    'details=tokenBalances&tokens=used',
    'details=txsummary&pageSize=30',
    'details=tokenBalances&tokens=nonzero',
    'details=txslight&pageSize=30',
  ])
    reads.set(`https://blockbook.syscoin.org/api/v2/xpub/${xpub}?${query}`, {
      address: xpub,
      balance: '0',
      unconfirmedBalance: '0',
      totalReceived: '0',
      totalSent: '0',
      txs: 0,
      unconfirmedTxs: 0,
      usedTokens: 0,
      tokens: [],
      tokensAsset: [],
      transactions: [],
    });
  return reads;
}

test('saved UTXO rows remain reachable below the ordinary Send form', async ({}, info) => {
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  const previous = { ...E2E_CONFIG };
  const chain = createPendingNativeChain();
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'SavedUtxoSynthetic!2026',
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let routes: Awaited<ReturnType<typeof installUtxoFixtureRoutes>> | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const auxiliaryReads: string[] = [];
  const observations: unknown[] = [];
  try {
    wallet = await PaliWallet.launch('saved-utxo-reachability', {
      offlineHttpProxy: server.url,
      recordVideo: false,
      viewport: { width: 400, height: 620 },
    });
    const canary = await wallet.context.newPage();
    const denied = await canary.goto('http://pali-proxy-http.invalid/probe');
    expect(denied?.status()).toBe(403);
    await expect(
      canary.goto('https://pali-proxy-connect.invalid/probe')
    ).rejects.toThrow();
    expect(server.blocked).toEqual(expect.arrayContaining(['GET', 'CONNECT']));
    await canary.close();
    routes = await installUtxoFixtureRoutes(
      wallet.context,
      chain.fixture,
      server.url,
      {
        readState: chain.readState,
        onSyntheticBroadcast: chain.acceptBroadcast,
      }
    );
    const auxiliary = startupReads();
    await wallet.context.route('**/*', async (route) => {
      const request = route.request();
      if (request.method() !== 'GET' || !auxiliary.has(request.url()))
        return route.fallback();
      auxiliaryReads.push(request.url());
      return route.fulfill({
        json: auxiliary.get(request.url()),
        headers: { 'access-control-allow-origin': '*' },
      });
    });
    const page = wallet.page;
    await wallet.step(
      'create one retained transaction through normal synthetic signing',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        await page.locator('#send-btn').click();
        await page
          .getByPlaceholder('Receiver', { exact: true })
          .fill(chain.fixture.userAddress);
        await page.locator('#fee-input').fill('0.00000002');
        await page.getByText('MAX', { exact: true }).click();
        await page
          .getByRole('button', { name: en.buttons.next, exact: true })
          .click();
        await expect(page).toHaveURL(/#\/send\/confirm$/);
        await page
          .getByRole('button', { name: en.buttons.confirm, exact: true })
          .click();
        await expect.poll(() => chain.accepted.length).toBe(1);
        await wallet!.ensureOnHome();
        await page.locator('#send-btn').click();
        await expect(page).toHaveURL(/#\/send\/sys$/);
      }
    );

    const summary = page
      .locator('summary')
      .filter({ hasText: en.send.savedUtxo.title });
    const details = summary.locator('..');
    const row = details.getByRole('button', {
      name: new RegExp(chain.accepted[0].txid.slice(0, 8)),
    });
    const scroll = page.locator('[data-navigation-scroll="wallet-layout"]');
    for (const height of [620, 850]) {
      await wallet.step(
        `reach and inspect the real saved row at 400 by ${height}`,
        async () => {
          await page.setViewportSize({ width: 400, height });
          await tabTo(page, summary);
          if ((await details.getAttribute('open')) !== null) {
            await page.keyboard.press('Enter');
            await expect(details).not.toHaveAttribute('open');
          }
          await page.keyboard.press('Enter');
          await expect(details).toHaveAttribute('open', '');
          await expect(row).toBeVisible();
          // Scroll after expansion so the newly loaded saved row participates.
          await page.mouse.move(392, 300);
          await page.mouse.wheel(0, 1200);
          await expect
            .poll(() =>
              scroll.evaluate(
                (element) =>
                  element.scrollTop + element.clientHeight >=
                  element.scrollHeight - 1
              )
            )
            .toBe(true);
          await tabTo(page, row);
          await expect(row).toBeFocused();
          await expect.poll(() => exposed(row)).toBe(true);
          observations.push({ height, row: await row.boundingBox() });
          await row.click();
          await expect(details.getByRole('status')).toHaveText(
            en.send.savedUtxo.seen
          );
          expect(chain.accepted).toHaveLength(1);
        }
      );
    }
    expect(routes.syntheticBroadcasts).toEqual([chain.accepted[0].txid]);
    expect(routes.deniedWrites).toEqual([]);
    expect(routes.deniedUnknown).toEqual([]);
    // Browser background requests and both canaries are denied by the proxy.
    // Wallet requests pass the stricter fixture route above.
    expect(server.blocked).toEqual(expect.arrayContaining(['GET', 'CONNECT']));
    expect(
      server.blocked.every((method) => ['GET', 'CONNECT'].includes(method))
    ).toBe(true);
    expect(extensionEvidence()).toEqual(runtime);
    status = 'passed';
  } finally {
    try {
      await info.attach('saved-utxo-reachability', {
        contentType: 'application/json',
        body: JSON.stringify({
          status,
          runtime,
          observations,
          auxiliaryReads,
          syntheticTransactions: chain.accepted,
          fixtureReads: routes?.reads ?? [],
          deniedWrites: routes?.deniedWrites ?? [],
          deniedUnknown: routes?.deniedUnknown ?? [],
          proxyDeniedConnections: server.blocked,
          forwardedExternalWrites: 0,
        }),
      });
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
  }
});
