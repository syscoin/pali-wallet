import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { utils as sys } from 'syscoinjs-lib';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { sptFixtureRead } from '../harness/sptFixture';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Nine digits exercise full identity beyond the old NFT-only eight-digit cue.
// Both values fit uint32 and are therefore ordinary fungible SPTs, not NFTs.
const GUIDS = ['123456789', '987654321'] as const;
const ORIGINS = [
  'https://blockbook-dev.syscoin.org',
  'https://explorer-blockbook-dev.syscoin.org',
];
const BLACKLIST_FEEDS = new Map<string, unknown>([
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

async function publicState(page: Page) {
  return page.evaluate(
    async (guids) => {
      const state = await chrome.runtime.sendMessage({
        type: 'getCurrentState',
      });
      const active = state.vault.activeAccount;
      const key = `state-vault-${state.vaultGlobal.activeSlip44}`;
      const saved = await chrome.storage.local.get([
        key,
        'pali_navigation_state',
      ]);
      const assets = (vault: any) =>
        (vault?.accountAssets?.[active.type]?.[active.id]?.syscoin || [])
          .filter((asset: any) =>
            guids.some((guid) => guid === String(asset.assetGuid))
          )
          .map((asset: any) => ({
            guid: String(asset.assetGuid),
            symbol: asset.symbol,
            balance: String(asset.balance),
            decimals: asset.decimals,
            chainId: asset.chainId,
          }));
      const draft = (value: any) => ({
        selected: value?.selectedAsset
          ? {
              guid: String(value.selectedAsset.assetGuid),
              balance: String(value.selectedAsset.balance),
              symbol: value.selectedAsset.symbol,
            }
          : null,
        amount: value?.formValues?.amount ?? '',
      });
      return {
        active,
        chainId: state.vault.activeNetwork.chainId,
        nativeBalance: String(
          state.vault.accounts[active.type][active.id].balances.syscoin
        ),
        live: assets(state.vault),
        persisted: assets(saved[key]),
        route: { path: location.hash, ...draft(history.state?.usr) },
        savedDraft: {
          path: saved.pali_navigation_state?.currentPath,
          ...draft(saved.pali_navigation_state?.state),
        },
      };
    },
    [...GUIDS]
  );
}

async function nativeOption(
  context: BrowserContext,
  page: Page,
  target: Locator
) {
  const selector = '[role="menuitem"]';
  const index = await target.evaluate(
    (node, query) => Array.from(document.querySelectorAll(query)).indexOf(node),
    selector
  );
  expect(index).toBeGreaterThanOrEqual(0);
  const cdp = await context.newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector,
    });
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', {
      nodeId: nodeIds[index],
      fetchRelatives: true,
    });
    const item = nodes.find(
      (node) => node.role?.value === 'menuitem' && !node.ignored
    );
    expect(item).toBeDefined();
    return {
      text: await target.innerText(),
      name: String(item!.name?.value ?? ''),
      description: String(item!.description?.value ?? ''),
      title: await target.getAttribute('title'),
      descendants: nodes.map((node) => ({
        role: node.role?.value,
        name: node.name?.value,
        ignored: node.ignored,
      })),
    };
  } finally {
    await cdp.detach();
  }
}

// Inspect the actual painted SVG without changing DOM, styles or wallet state.
async function collapsedPickerGeometry(picker: Locator) {
  return picker.evaluate((button) => {
    const svg = button.querySelector('svg');
    const arrow = svg?.querySelector('path');
    if (!svg || !arrow) throw new Error('Actual picker ArrowDownSvg missing');
    const rect = (value: DOMRect) => ({
      x: value.x,
      y: value.y,
      width: value.width,
      height: value.height,
      left: value.left,
      top: value.top,
      right: value.right,
      bottom: value.bottom,
    });
    const buttonBox = button.getBoundingClientRect();
    const svgBox = svg.getBoundingClientRect();
    const paintedBox = arrow.getBoundingClientRect();
    const rawBox = arrow.getBBox();
    const matrix = arrow.getScreenCTM();
    let sample: DOMPoint | undefined;
    // The bounding-box center can be the transparent opening of the V shape.
    // Find an actual interior filled point before testing screen occlusion.
    for (let row = 1; row < 8 && !sample; row++) {
      for (let column = 1; column < 8 && !sample; column++) {
        const point = new DOMPoint(
          rawBox.x + (rawBox.width * column) / 8,
          rawBox.y + (rawBox.height * row) / 8
        );
        if (arrow.isPointInFill(point)) sample = point;
      }
    }
    const screenPoint =
      sample && matrix ? sample.matrixTransform(matrix) : null;
    const hit = screenPoint
      ? document.elementFromPoint(screenPoint.x, screenPoint.y)
      : null;
    const ancestors = [];
    for (let node: Element | null = arrow; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      ancestors.push({
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
      });
    }
    const within = (inner: DOMRect, outer: DOMRect) =>
      inner.left >= outer.left - 0.5 &&
      inner.right <= outer.right + 0.5 &&
      inner.top >= outer.top - 0.5 &&
      inner.bottom <= outer.bottom + 0.5;
    const paintFullyVisible =
      paintedBox.width > 0 &&
      paintedBox.height > 0 &&
      within(paintedBox, svgBox) &&
      within(paintedBox, buttonBox) &&
      paintedBox.left >= 0 &&
      paintedBox.right <= window.innerWidth &&
      paintedBox.top >= 0 &&
      paintedBox.bottom <= window.innerHeight &&
      ancestors.every(
        (style) =>
          style.display !== 'none' &&
          !['hidden', 'collapse'].includes(style.visibility) &&
          Number(style.opacity) > 0
      ) &&
      Boolean(hit && svg.contains(hit));
    const viewBox = svg.viewBox.baseVal;
    return {
      text: button.textContent?.trim(),
      expanded: button.getAttribute('aria-expanded'),
      button: rect(buttonBox),
      svg: rect(svgBox),
      paint: rect(paintedBox),
      viewBox: [viewBox.x, viewBox.y, viewBox.width, viewBox.height],
      rawPathBox: {
        x: rawBox.x,
        y: rawBox.y,
        width: rawBox.width,
        height: rawBox.height,
      },
      screenPoint: screenPoint ? { x: screenPoint.x, y: screenPoint.y } : null,
      sampleHitsActualSvg: Boolean(hit && svg.contains(hit)),
      ancestors,
      paintFullyVisible,
    };
  });
}

async function tabTo(page: Page, target: Locator) {
  for (let index = 0; index < 40; index++) {
    if (await target.evaluate((node) => node === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}
const activeItem = async (menu: Locator, item: Locator) =>
  Boolean(await menu.getAttribute('aria-activedescendant')) &&
  (await menu.getAttribute('aria-activedescendant')) ===
    (await item.getAttribute('id'));

for (const scenario of [
  { name: 'equal symbols', symbols: ['DUP', 'DUP'] },
  { name: 'equal truncated prefixes', symbols: ['ABCDEFGH1', 'ABCDEFGH2'] },
] as const) {
  test(`SPT Send picker exposes exact GUID identity for ${scenario.name}`, async ({}, info) => {
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
    expect(E2E_CONFIG.extensionPath).toBe(
      process.env.PALI_TEST_DAPP_EXTENSION_PATH
    );
    const runtime = extensionEvidence();
    expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
    const sourceSha256 = createHash('sha256')
      .update(fs.readFileSync(info.file))
      .digest('hex');
    const previous = { ...E2E_CONFIG };
    const fixture = createIsolatedVaultFixture();
    const config = getNetworkConfig(57, 'sys');
    const initialXpub = new sys.HDSigner(
      UTXO_FIXTURE_SEED,
      '',
      false,
      config.networks,
      57,
      config.types.zPubType,
      84
    ).getAccountXpub();
    const startupQueries = new Set([
      'details=tokenBalances&tokens=used',
      'details=txsummary&pageSize=30',
      'details=tokenBalances&tokens=nonzero',
      'details=txslight&pageSize=30',
    ]);
    const tickerUrls = new Set([
      'https://blockbook.syscoin.org/api/v2/tickers/currency',
      'https://blockbook-dev.syscoin.org/api/v2/tickers/currency',
    ]);
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'SptPickerIdentitySynthetic!2026',
      rpcUrl: server.url,
      chainId: 5700,
      networkLabel: 'Syscoin Testnet',
    });
    const reads: Array<Record<string, unknown>> = [];
    const walletHttp: Array<{ method: string; url: string }> = [];
    const unexpectedWalletHttpFailures: Array<{ method: string; url: string }> =
      [];
    const forbiddenRequests: string[] = [];
    const pageErrors: string[] = [];
    const observations: Record<string, any> = {
      scenario,
      runtime,
      sourceSha256,
      guids: GUIDS,
      milestones: {},
    };
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    try {
      wallet = await PaliWallet.launch(
        `spt-picker-${scenario.name.replace(/ /g, '-')}`,
        { offlineHttpProxy: server.url, viewport: { width: 400, height: 620 } }
      );
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url
      );
      wallet.context.on('request', (request) => {
        const url = new URL(request.url());
        if (['http:', 'https:'].includes(url.protocol))
          walletHttp.push({ method: request.method(), url: request.url() });
        if (/\/sendtx(?:\/|$)/i.test(url.pathname))
          forbiddenRequests.push('sendtx');
        try {
          const body = request.postDataJSON();
          for (const call of Array.isArray(body) ? body : [body])
            if (
              /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
                call?.method || ''
              )
            )
              forbiddenRequests.push(call.method);
        } catch {
          /* Ordinary REST has no JSON body. */
        }
      });
      wallet.context.on('requestfailed', (request) => {
        if (/^https?:/.test(request.url()))
          unexpectedWalletHttpFailures.push({
            method: request.method(),
            url: request.url(),
          });
      });
      await wallet.context.route(
        (url) =>
          BLACKLIST_FEEDS.has(url.href) ||
          tickerUrls.has(url.href) ||
          (url.origin === 'https://blockbook.syscoin.org' &&
            url.pathname === `/api/v2/xpub/${initialXpub}` &&
            startupQueries.has(url.searchParams.toString())),
        async (route) => {
          const request = route.request(),
            url = new URL(request.url());
          if (request.method() !== 'GET') return route.fallback();
          const body = BLACKLIST_FEEDS.has(url.href)
            ? BLACKLIST_FEEDS.get(url.href)
            : tickerUrls.has(url.href)
            ? { ts: 1, rates: { usd: 1 } }
            : {
                address: initialXpub,
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
              };
          reads.push({ family: 'startup-public-read', url: url.href });
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify(body),
          });
        }
      );
      // Only public HTTP data varies. Both assets are genuine-shaped fungible
      // holdings with equal display balance2.5 but distinct GUIDs/precisions.
      const metadata = (index: number) => ({
        assetGuid: GUIDS[index],
        symbol: scenario.symbols[index],
        decimals: index === 0 ? 2 : 8,
        balance: index === 0 ? '250' : '250000000',
        unconfirmedBalance: '0',
        totalReceived: index === 0 ? '250' : '250000000',
        totalSent: '0',
        transfers: 1,
        type: 'SPTAllocated',
      });
      await wallet.context.route(
        (url) =>
          ORIGINS.includes(url.origin) &&
          (/^\/api\/v2\/asset\/\d+$/.test(url.pathname) ||
            [
              `/api/v2/xpub/${fixture.utxo.userXpub}`,
              `/api/v2/address/${fixture.utxo.userAddress}`,
            ].includes(url.pathname)),
        async (route) => {
          const request = route.request(),
            url = new URL(request.url());
          if (request.method() !== 'GET') return route.fallback();
          const rawGuid = url.pathname.match(/^\/api\/v2\/asset\/(\d+)$/)?.[1];
          if (rawGuid !== undefined) {
            const index = GUIDS.indexOf(rawGuid as (typeof GUIDS)[number]);
            if (index < 0) return route.fallback();
            expect(url.searchParams.get('details')).toBe('basic');
            reads.push({
              family: 'spt-metadata',
              guid: rawGuid,
              url: url.href,
            });
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              headers: { 'access-control-allow-origin': '*' },
              body: JSON.stringify({
                asset: {
                  ...metadata(index),
                  maxSupply: '1000000000000',
                  totalSupply: '1000000000000',
                  metaData: '',
                },
              }),
            });
          }
          const original = sptFixtureRead(
            fixture.utxo,
            request.url(),
            request.method()
          ) as { tokensAsset?: Array<Record<string, unknown>> } | undefined;
          if (!original?.tokensAsset) return route.fallback();
          // Keep original native-account/history DTO fields. Replace only its
          // token inventory with the two stated public synthetic SPT holdings.
          const template = original.tokensAsset[0];
          reads.push({ family: 'spt-inventory', guids: GUIDS, url: url.href });
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify({
              ...original,
              tokensAsset: GUIDS.map((_, index) => ({
                ...template,
                ...metadata(index),
              })),
            }),
          });
        }
      );
      observations.workerIdentity = await verifyExecutingWorker(
        wallet.context,
        wallet.extensionId,
        E2E_CONFIG.extensionPath,
        (value) => {
          observations.workerIdentity = value;
        }
      );
      const page = wallet.page;
      page.on('pageerror', (error) => pageErrors.push(error.message));
      const expectedAssets = GUIDS.map((guid, index) => ({
        guid,
        symbol: scenario.symbols[index],
        balance: '2.5',
        decimals: index === 0 ? 2 : 8,
        chainId: 5700,
      }));
      await wallet.step(
        `${scenario.name}: import both equal-balance SPTs through ordinary Add Custom`,
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
          await wallet!.ensureOnHome();
          await page.locator('#assets-btn').click();
          await page
            .getByRole('button', { name: en.home.importToken, exact: true })
            .click();
          await page
            .getByRole('button', { name: en.tokens.addCustomTab, exact: true })
            .click();
          for (let index = 0; index < GUIDS.length; index++) {
            await page
              .getByRole('textbox', { name: en.tokens.assetGuid, exact: true })
              .fill(GUIDS[index]);
            const action = page.getByRole('button', {
              name: en.tokens.importNamedToken.replace(
                '{{symbol}}',
                scenario.symbols[index]
              ),
              exact: true,
            });
            await expect(
              page.getByText(`${en.tokens.assetGuid}: ${GUIDS[index]}`, {
                exact: true,
              })
            ).toBeVisible();
            await expect(action).toBeEnabled();
            await expect(
              action
                .locator('xpath=ancestor::li')
                .locator('span.text-brand-white.font-medium')
            ).toHaveText('2.5');
            await action.click();
            await expect(action).toBeDisabled();
            await expect
              .poll(async () => {
                const state = await publicState(page);
                return { live: state.live, persisted: state.persisted };
              })
              .toEqual({
                live: expectedAssets.slice(0, index + 1),
                persisted: expectedAssets.slice(0, index + 1),
              });
          }
          observations.imported = await publicState(page);
          await page
            .getByRole('button', { name: en.buttons.back, exact: true })
            .click();
          await wallet!.ensureOnHome();
          await page.locator('#send-btn').click();
          await expect(page).toHaveURL(/#\/send\/sys$/);
          observations.milestones.ordinaryImportHealthy = true;
        }
      );
      const picker = page.locator('#send-form button[aria-haspopup="menu"]');
      const menu = page.getByRole('menu');
      const options = menu.getByRole('menuitem');
      const amount = page.locator('#with-max-button');
      const max = page.getByRole('button', { name: en.send.max, exact: true });
      const openKeyboard = async () => {
        await page.mouse.move(0, 0);
        await tabTo(page, picker);
        await page.keyboard.press('Enter');
        await expect(menu).toBeFocused();
        await expect.poll(() => activeItem(menu, options.nth(0))).toBe(true);
      };
      const selected = async (guid: string | null, value: string) => {
        await expect(amount).toHaveValue(value);
        const expected = {
          selected:
            guid === null
              ? null
              : {
                  guid,
                  balance: '2.5',
                  symbol:
                    scenario.symbols[
                      GUIDS.indexOf(guid as (typeof GUIDS)[number])
                    ],
                },
          amount: value,
        };
        await expect
          .poll(async () => {
            const state = await publicState(page);
            return {
              route: {
                selected: state.route.selected,
                amount: state.route.amount,
              },
              saved: {
                selected: state.savedDraft.selected,
                amount: state.savedDraft.amount,
              },
            };
          })
          .toEqual({ route: expected, saved: expected });
      };
      await wallet.step(
        `${scenario.name}: inspect real visible and native accessibility identity before selecting`,
        async (capture) => {
          await picker.click();
          await expect(options).toHaveCount(3);
          await expect(options.nth(0)).toContainText('TSYS');
          const identities = [];
          for (let index = 0; index < GUIDS.length; index++) {
            const option = options.nth(index + 1);
            expect(await option.evaluate((node) => node.tagName)).toBe(
              'BUTTON'
            );
            await expect(option).toHaveAttribute('type', 'button');
            const identity = await nativeOption(wallet!.context, page, option);
            identities.push({ expectedGuid: GUIDS[index], ...identity });
            // Soft only the identity regression. Missing attributes alone are
            // not a finding: require a full visible GUID and a native AX cue.
            expect.soft(identity.text).toContain(GUIDS[index]);
            expect
              .soft(`${identity.name} ${identity.description}`)
              .toContain(GUIDS[index]);
          }
          observations.identities = identities;
          await capture(page);
          await page.keyboard.press('Escape');
          await expect(menu).toHaveCount(0);
          await expect(picker).toBeFocused();
        }
      );
      await wallet.step(
        `${scenario.name}: pointer and native keyboard select exact public GUIDs and MAX balances`,
        async () => {
          await picker.click();
          await options.nth(2).click();
          await expect(menu).toHaveCount(0);
          await max.click();
          await selected(GUIDS[1], '2.5');
          observations.pointerSelection = await publicState(page);
          await openKeyboard();
          await page.keyboard.press('Home');
          await page.keyboard.press('ArrowDown');
          await expect.poll(() => activeItem(menu, options.nth(1))).toBe(true);
          await page.keyboard.press('Enter');
          await expect(menu).toHaveCount(0);
          await max.click();
          await selected(GUIDS[0], '2.5');
          observations.keyboardSelection = await publicState(page);
          observations.milestones.exactSelectionsHealthy = true;
        }
      );
      await wallet.step(
        `${scenario.name}: Escape preserves manual draft and native MAX remains healthy without submission`,
        async () => {
          await amount.fill('1.23');
          await selected(GUIDS[0], '1.23');
          const beforeEscape = await publicState(page);
          await openKeyboard();
          await page.keyboard.press('Home');
          await page.keyboard.press('ArrowDown');
          await page.keyboard.press('ArrowDown');
          await expect.poll(() => activeItem(menu, options.nth(2))).toBe(true);
          await page.keyboard.press('Escape');
          await expect(menu).toHaveCount(0);
          await expect(picker).toBeFocused();
          await selected(GUIDS[0], '1.23');
          const afterEscape = await publicState(page);
          expect(afterEscape).toEqual(beforeEscape);
          observations.afterEscape = afterEscape;
          await picker.click();
          await options.nth(0).click();
          await max.click();
          const current = await publicState(page);
          expect(current.nativeBalance).toMatch(/^0\.0010*$/);
          await selected(null, current.nativeBalance);
          observations.nativeSelection = await publicState(page);
          observations.milestones.escapeAndNativeHealthy = true;
        }
      );
      const geometryObservations: {
        chosen: Awaited<ReturnType<typeof collapsedPickerGeometry>>;
        short: Awaited<ReturnType<typeof collapsedPickerGeometry>>;
        width: number;
      }[] = [];
      observations.collapsedPickerGeometry = geometryObservations;
      try {
        for (const width of [320, 400]) {
          await wallet.step(
            `${scenario.name}: record collapsed picker arrow at ${width}px`,
            async (capture) => {
              await page.setViewportSize({ width, height: 620 });
              const before = await publicState(page);
              await selected(null, before.nativeBalance);
              await expect(menu).toHaveCount(0);
              const short = await collapsedPickerGeometry(picker);
              // Hard setup control: the real short-symbol arrow is painted.
              expect(short.viewBox).toEqual([0, 0, 24, 25]);
              expect(short.paintFullyVisible).toBe(true);
              expect(short.expanded).toBe('false');

              await picker.click();
              await options.nth(1).click();
              await max.click();
              await selected(GUIDS[0], '2.5');
              await expect(picker).toContainText(scenario.symbols[0]);
              await expect(menu).toHaveCount(0);
              const chosen = await collapsedPickerGeometry(picker);
              expect(chosen.viewBox).toEqual(short.viewBox);
              expect(chosen.expanded).toBe('false');
              geometryObservations.push({ width, short, chosen });
              await capture(page);

              // Restore the exact original healthy native selection through
              // the actual menu; later controls keep their original state.
              await picker.click();
              await options.nth(0).click();
              await max.click();
              await selected(null, before.nativeBalance);
              expect(await publicState(page)).toEqual(before);
            }
          );
        }
      } finally {
        await wallet.step(
          `${scenario.name}: restore the original viewport after arrow inspection`,
          async () => {
            await page.setViewportSize({ width: 400, height: 620 });
          }
        );
      }
      await expect(page).toHaveURL(/#\/send\/sys$/);
      expect(
        wallet.context
          .pages()
          .some((candidate) => candidate.url().includes('/external'))
      ).toBe(false);
      expect(routes.deniedWrites).toEqual([]);
      expect(forbiddenRequests).toEqual([]);
      expect(unexpectedWalletHttpFailures).toEqual([]);
      expect(pageErrors).toEqual([]);
      expect(extensionEvidence()).toEqual(runtime);
      expect(
        createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
      ).toBe(sourceSha256);
      observations.milestones.safetyHealthy = true;
      await wallet.step(
        `${scenario.name}: verify collapsed arrows after all healthy controls`,
        async () => {
          // Assert only after both viewport observations and all original
          // safety/selection controls. No silent soft layout failure remains.
          expect(
            geometryObservations.map(({ width, short, chosen }) => ({
              width,
              paintFullyVisible: chosen.paintFullyVisible,
              svgNoNarrowerThanShort: chosen.svg.width >= short.svg.width - 0.5,
              paintNoNarrowerThanShort:
                chosen.paint.width >= short.paint.width - 0.5,
              paintNoShorterThanShort:
                chosen.paint.height >= short.paint.height - 0.5,
            }))
          ).toEqual(
            [320, 400].map((width) => ({
              width,
              paintFullyVisible: true,
              svgNoNarrowerThanShort: true,
              paintNoNarrowerThanShort: true,
              paintNoShorterThanShort: true,
            }))
          );
          observations.milestones.collapsedArrowGeometryHealthy = true;
        }
      );
      status = info.errors.length ? 'failed' : 'passed';
    } finally {
      try {
        await info.attach('spt-send-picker-identity', {
          contentType: 'application/json',
          body: JSON.stringify({
            ...observations,
            status,
            reads,
            walletHttp,
            unexpectedWalletHttpFailures,
            forbiddenRequests,
            pageErrors,
            fixtureReads: routes?.reads ?? [],
            deniedWrites: routes?.deniedWrites ?? [],
            proxyDeniedConnections: server.blocked.length,
            proxyCountIsPlatformEvidenceOnly: true,
            controllerResultsReplaced: false,
            walletStateReplaced: false,
            nextOrConfirmClicked: false,
            signingOrBroadcastRequested: false,
          }),
        });
      } finally {
        try {
          await wallet?.dispose(status);
        } finally {
          await server.close();
          Object.assign(E2E_CONFIG, previous);
        }
      }
    }
  });
}
