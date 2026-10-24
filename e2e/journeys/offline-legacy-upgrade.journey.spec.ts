import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import net from 'net';
import path from 'path';

import packageJson from '../../package.json';
import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { SPT_GUID, SPT_SYMBOL, sptFixtureRead } from '../harness/sptFixture';
import { startRequest } from '../harness/testDappConformance';
import {
  launchUpgradeBrowser,
  type UpgradeBrowser,
} from '../harness/upgradeBrowser';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const LEGACY_VERSION = process.env.PALI_LEGACY_EXTENSION_VERSION;
const CUSTOM_RPC = 'https://legacy-upgrade.invalid/';
const PASSWORD = 'DisposableLegacyUpgradeOnly!2026';
const historyId = '68'.repeat(32);

// Only immutable extension artifacts are extracted. No chrome.storage,
// controller setters or manually constructed vault state are used by this test.
function extractArtifact(prefix: 'LEGACY' | 'CURRENT', directory: string) {
  const zip = process.env[`PALI_${prefix}_EXTENSION_ZIP`];
  const expected = process.env[`PALI_${prefix}_EXTENSION_SHA256`];
  if (!zip || !path.isAbsolute(zip) || !/^[a-f0-9]{64}$/.test(expected || ''))
    throw new Error(`Pin the absolute ${prefix} ZIP and its SHA256`);
  const bytes = fs.readFileSync(zip);
  if (!/^\d+\.\d+\.\d+$/.test(LEGACY_VERSION || ''))
    throw new Error('Pin the observed legacy/store manifest version');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  expect(sha256).toBe(expected);
  const entries = execFileSync('unzip', ['-Z1', zip], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  })
    .trim()
    .split('\n');
  if (
    entries.length > 10000 ||
    entries.some(
      (entry) =>
        entry.startsWith('/') ||
        entry.includes('\\') ||
        entry.split('/').includes('..')
    )
  )
    throw new Error('Unsafe extension archive entry');
  const archiveMetadata = execFileSync('unzip', ['-Z', '-l', zip], {
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  });
  if (/^l[rwx-]{9}\s/m.test(archiveMetadata))
    throw new Error('Archive symlink refused before extraction');
  fs.mkdirSync(directory, { recursive: false });
  execFileSync('unzip', ['-q', zip, '-d', directory]);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8')
  );
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.version).toBe(
    prefix === 'LEGACY' ? LEGACY_VERSION : packageJson.version
  );
  for (const entry of entries) {
    const stat = fs.lstatSync(path.join(directory, entry));
    if (stat.isSymbolicLink()) throw new Error('Archive symlink refused');
  }
  return { bytes: bytes.length, sha256, version: manifest.version };
}

async function physicalDenial(
  server: Awaited<ReturnType<typeof startUtxoFixtureServer>>,
  method: 'GET' | 'CONNECT'
) {
  const proxy = new URL(server.url),
    before = server.blocked.length;
  expect(proxy.protocol).toBe('http:');
  expect(proxy.hostname).toBe('127.0.0.1');
  const receipt = await new Promise<{
    connectionClosed: boolean;
    statusCode: number;
  }>((resolve, reject) => {
    const socket = net.createConnection({
      host: '127.0.0.1',
      port: Number(proxy.port),
    });
    let bytes = Buffer.alloc(0),
      ended = false,
      settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(2000, () =>
      fail(new Error('Physical deny-proxy canary timed out'))
    );
    socket.once('error', fail);
    socket.once('connect', () =>
      socket.write(
        `${method} ${
          method === 'GET'
            ? 'http://token-feedback-denied.invalid/'
            : 'token-feedback-denied.invalid:443'
        } HTTP/1.0\r\nHost: token-feedback-denied.invalid\r\nConnection: close\r\n\r\n`
      )
    );
    socket.on('data', (chunk: Buffer) => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length > 4096)
        fail(new Error('Physical canary response too large'));
    });
    socket.once('end', () => {
      ended = true;
    });
    socket.once('close', (hadError) => {
      if (settled) return;
      settled = true;
      try {
        expect(hadError).toBe(false);
        expect(ended).toBe(true);
        const text = bytes.toString('utf8'),
          separator = text.indexOf('\r\n\r\n');
        expect(separator).toBeGreaterThanOrEqual(0);
        expect(text.slice(0, separator).split('\r\n')[0]).toMatch(
          /^HTTP\/1\.[01] 403 Forbidden$/
        );
        expect(text.slice(0, separator)).toMatch(
          /\r\nConnection: close(?:\r\n|$)/i
        );
        expect(text.slice(separator + 4)).toBe(
          method === 'GET' ? 'Offline fixture only' : ''
        );
        resolve({ connectionClosed: true, statusCode: 403 });
      } catch (error) {
        reject(error);
      }
    });
  });
  expect(server.blocked.slice(before)).toEqual([method]);
  return { method, ...receipt };
}

// Narrow, public read-only projection. The worker returns state only to its own
// extension page; private fields never leave that page or enter test artifacts.
async function projection(page: Page) {
  return page.evaluate(
    () =>
      new Promise<any>((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'getCurrentState' }, (state) => {
          if (chrome.runtime.lastError || !state?.vault)
            return reject(new Error('Public upgrade projection unavailable'));
          const vault = state.vault;
          const ref = vault.activeAccount;
          const selected = vault.accounts?.[ref.type]?.[ref.id];
          if (!selected) return reject(new Error('Selected account missing'));
          const assets = vault.accountAssets?.[ref.type]?.[ref.id];
          resolve({
            chainId: vault.activeNetwork.chainId,
            kind: vault.activeNetwork.kind || null,
            networkLabel: vault.activeNetwork.label,
            networkUrl: vault.activeNetwork.url,
            slip44: state.vaultGlobal.activeSlip44,
            advanced: {
              autolock: state.vaultGlobal.advancedSettings.autolock,
              refresh: state.vaultGlobal.advancedSettings.refresh,
            },
            selected: {
              type: ref.type,
              id: ref.id,
              address: selected.address,
              label: selected.label,
            },
            selectedNativeBalance:
              selected.balances?.[
                vault.isBitcoinBased ? 'syscoin' : 'ethereum'
              ] ?? null,
            balanceLoading:
              state.vaultGlobal.loadingStates?.isLoadingBalances ?? null,
            accounts: Object.entries(vault.accounts || {}).flatMap(
              ([type, entries]) =>
                Object.values(entries || {}).map((account: any) => ({
                  type,
                  id: account.id,
                  label: account.label,
                  address: account.address,
                }))
            ),
            tokens: (assets?.syscoin || []).map((token: any) => ({
              guid: String(token.assetGuid),
              symbol: token.symbol,
              chainId: token.chainId,
            })),
            builtInExplorerApis: Object.fromEntries(
              [1, 8453, 42161].map((chainId) => [
                chainId,
                state.vaultGlobal.networks.ethereum[chainId]?.apiUrl || null,
              ])
            ),
            grants: Object.values(state.dapp?.dapps || {}).map(
              (grant: any) => ({
                host: grant.host,
                accountId: grant.accountId,
                accountType: grant.accountType,
                chain: grant.chain,
                chainId: grant.chainId,
              })
            ),
          });
        });
      })
  );
}

test('published legacy wallet upgrades in-place without reimporting its vault', async () => {
  test.setTimeout(300000);
  const run = path.resolve(E2E_CONFIG.artifactsDir);
  const testSourceSha256 = createHash('sha256')
    .update(fs.readFileSync(__filename))
    .digest('hex');
  const relativeRun = path.relative(
    path.resolve(E2E_CONFIG.repoRoot, 'e2e/artifacts'),
    run
  );
  if (!relativeRun || relativeRun.includes(path.sep) || relativeRun === '..')
    throw new Error('Upgrade run must be a direct child of harness artifacts');
  fs.mkdirSync(run, { recursive: true });
  // Fixed child names intentionally fail on reuse rather than inheriting state.
  const stablePath = path.join(run, 'upgrade-extension');
  const nextPath = path.join(run, 'current-unpacked');
  const legacyArtifact = extractArtifact('LEGACY', stablePath);
  const currentArtifact = extractArtifact('CURRENT', nextPath);
  const before = { ...E2E_CONFIG };
  const fixture = createIsolatedVaultFixture();
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath: stablePath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: PASSWORD,
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
    rpcUrl: server.url,
  });
  let context: BrowserContext | undefined;
  let owner: UpgradeBrowser | undefined;
  let page: Page;
  let extensionId = '';
  let profileDir = '';
  const steps: any[] = [];
  const snapshots: any[] = [];
  const workerIdentities: any[] = [];
  const physicalCanaries: ({ launch: number } & Awaited<
    ReturnType<typeof physicalDenial>
  >)[] = [];
  const observations: any[] = [];
  let historyAvailable = true;
  let blockedHistoryReads = 0;
  const installRoutes = async () => {
    const routes = await installIsolatedVaultRoutes(
      context!,
      fixture,
      server.url
    );
    observations.push(routes);
    await context!.route(
      (url) =>
        [
          'https://blockbook-dev.syscoin.org',
          'https://explorer-blockbook-dev.syscoin.org',
        ].includes(url.origin) &&
        /^\/api\/v2\/(xpub|address)\//.test(url.pathname),
      async (route) => {
        const request = route.request();
        const body = sptFixtureRead(
          fixture.utxo,
          request.url(),
          request.method()
        ) as any;
        if (!body) return route.fallback();
        if (!historyAvailable) {
          blockedHistoryReads++;
          return route.abort('blockedbyclient');
        }
        const tx = {
          txid: historyId,
          vin: [],
          vout: [],
          direction: 'received',
          valueIn: '0',
          value: '100000',
          addressValueIn: '0',
          addressValueOut: '100000',
          fees: '226',
          blockTime: 1791600000,
          confirmations: 5,
          blockHeight: 1,
          blockHash: '69'.repeat(32),
        };
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({
            ...body,
            txs: 1,
            transactions: [tx],
            txids: [historyId],
          }),
        });
      }
    );
    // A custom RPC still uses standard JSON-RPC reads, locally fulfilled. The
    // launch proxy prevents forwarding even before Playwright routes attach.
    await context!.route(
      (url) => url.href === CUSTOM_RPC,
      async (route) => {
        if (route.request().method() !== 'POST') return route.abort();
        const data = route.request().postDataJSON();
        const calls = Array.isArray(data) ? data : [data];
        if (
          calls.some((call: any) =>
            /^(?:eth_send|wallet_send|personal_sign|eth_sign|sys_sign)/i.test(
              call?.method || ''
            )
          )
        )
          routes.deniedWrites.push('custom-rpc-write-or-sign');
        const results: Record<string, unknown> = {
          ['eth_chainId']: '0xfde9',
          ['net_version']: '65001',
          ['eth_blockNumber']: '0x1',
          ['eth_getBalance']: '0x0',
          ['eth_getTransactionCount']: '0x0',
          ['eth_gasPrice']: '0x3b9aca00',
          ['eth_maxPriorityFeePerGas']: '0x3b9aca00',
          ['eth_getCode']: '0x',
          ['eth_getLogs']: [],
          ['eth_call']: '0x',
          ['web3_clientVersion']: 'PaliOfflineUpgradeFixture',
        };
        if (
          !calls.length ||
          calls.some(
            (call: any) =>
              !call ||
              call.jsonrpc !== '2.0' ||
              !Object.prototype.hasOwnProperty.call(results, call.method)
          )
        )
          return route.abort('blockedbyclient');
        const replies = calls.map((call: any) => ({
          jsonrpc: '2.0',
          id: call.id,
          result: results[call.method],
        }));
        routes.reads.push(
          ...calls.map((call: any) => 'custom-rpc:' + call.method)
        );
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify(Array.isArray(data) ? replies : replies[0]),
        });
      }
    );
  };
  const shot = async (name: string) => {
    const file = path.join(
      run,
      `${String(steps.length).padStart(2, '0')}-${name}.png`
    );
    await page.screenshot({
      path: file,
      fullPage: true,
      animations: 'disabled',
      mask: [page.locator('textarea,input[type="password"]')],
    });
    return path.basename(file);
  };
  const step = async (name: string, work: () => Promise<void>) => {
    const started = Date.now();
    try {
      await work();
      steps.push({
        name,
        status: 'passed',
        durationMs: Date.now() - started,
        screenshot: await shot(name),
      });
    } catch (error) {
      steps.push({
        name,
        status: 'failed',
        durationMs: Date.now() - started,
        screenshot: await shot('failed-' + name).catch(() => null),
      });
      throw error;
    }
  };
  const home = async () => {
    await expect(
      page.locator('#home-balance, #home-balance-pending').first()
    ).toBeVisible({ timeout: 60000 });
    for (let i = 0; i < 5; i++) {
      const close = page
        .getByRole('button', { name: /^(cancel|close|not now|skip)$/i })
        .first();
      if (await close.isVisible().catch(() => false)) {
        // Some legacy first-network prompts dismiss themselves during a
        // hydration render. A vanished button is not a wallet operation retry.
        await close.click({ timeout: 1500 }).catch(() => undefined);
        continue;
      }
      if (
        await page
          .locator('[role="dialog"]')
          .first()
          .isVisible()
          .catch(() => false)
      ) {
        await page.keyboard.press('Escape');
        continue;
      }
      break;
    }
  };
  const route = async (hash: string) => {
    await page.goto(`chrome-extension://${extensionId}/app.html${hash}`);
  };
  const switchNetwork = async (
    label: string,
    group: string,
    expectedFallbackChainId?: number
  ) => {
    await home();
    const button = page.getByRole('button').filter({ hasText: /UTXO|EVM/ });
    await expect(button).toHaveCount(1);
    if ((await button.innerText()).includes(label)) return;
    await button.click();
    // The store baseline exposes family buttons and plain li choices. The
    // current wallet uses native buttons registered as accessible menuitems.
    const family = page
      .locator('button')
      .filter({ hasText: new RegExp('^' + group + ' Networks$', 'i') });
    await expect(family).toHaveCount(1);
    const expanded = await family.getAttribute('aria-expanded');
    if (expanded !== 'true') await family.click();
    if (expanded !== null)
      await expect(family).toHaveAttribute('aria-expanded', 'true');
    const currentChoice = page
      .getByRole('menuitem', { name: label, exact: true })
      .and(page.locator('button'));
    const legacyChoice = page.locator('li').filter({
      has: page.getByText(label, { exact: true }).and(page.locator('span')),
    });
    const choice = currentChoice.or(legacyChoice);
    await expect(choice).toHaveCount(1);
    if (expectedFallbackChainId !== undefined) {
      // Reproduce the settled custom-network icon that adds numeric SVG text
      // to the raw row text, without making it part of the accessible name.
      await expect(currentChoice).toHaveCount(1);
      await expect(legacyChoice).toHaveCount(0);
      await expect(currentChoice.locator('svg text')).toHaveText(
        String(expectedFallbackChainId)
      );
    }
    await choice.click();
    await expect(button).toContainText(label, { timeout: 60000 });
    await home();
  };
  const createAccount = async (label: string) => {
    await page.locator('#general-settings-button').click();
    await page
      .getByText(en.accountMenu.createNewAccount, { exact: true })
      .click();
    await page.locator('#account-name-input').fill(label);
    await page.locator('#create-btn').click();
    await page.getByRole('button', { name: /^ok$/i }).first().click();
    await home();
  };
  const openWalletPopup = async () => {
    // The currently distributed 4.0.0 intentionally refuses app.html in a TAB
    // context. Open its real browser-action popup, the normal user entrypoint.
    for (const tab of context!.pages()) {
      if (tab.url().startsWith(`chrome-extension://${extensionId}/app.html`))
        await tab.close();
    }
    await owner!.triggerAction();
    await context!.unrouteAll({ behavior: 'wait' });
    context = await owner!.adoptPopup();
    await installRoutes();
    const popup = context
      .pages()
      .find((candidate) =>
        candidate.url().startsWith(`chrome-extension://${extensionId}/app.html`)
      );
    if (!popup) throw new Error('Actual action popup not discovered over CDP');
    page = popup;
    const worker = context
      .serviceWorkers()
      .find((value) =>
        value.url().startsWith(`chrome-extension://${extensionId}/`)
      );
    if (!worker) throw new Error('Missing executing popup worker');
    const popupContexts = await worker.evaluate(
      async () =>
        (
          await chrome.runtime.getContexts({})
        ).filter(
          (value) =>
            value.contextType === 'POPUP' &&
            value.documentUrl?.includes('/app.html')
        ).length
    );
    expect(popupContexts).toBe(1);
    await expect(page).toHaveURL(
      new RegExp(`^chrome-extension://${extensionId}/app.html`)
    );
    await route('#/');
  };
  const launch = async (resumed: boolean, activatePackage = false) => {
    const launchNumber = physicalCanaries.length / 2 + 1;
    for (const method of ['GET', 'CONNECT'] as const)
      physicalCanaries.push({
        launch: launchNumber,
        ...(await physicalDenial(server, method)),
      });
    const result = await launchUpgradeBrowser(
      stablePath,
      server.url,
      resumed ? profileDir : undefined
    );
    owner = result;
    context = result.context;
    if (resumed) {
      expect(result.extensionId).toBe(extensionId);
      expect(result.profileDir).toBe(profileDir);
    } else {
      extensionId = result.extensionId;
      profileDir = result.profileDir;
    }
    let previousVersion: string | undefined;
    if (activatePackage) {
      const oldWorker = context
        .serviceWorkers()
        .find((worker) =>
          worker.url().startsWith(`chrome-extension://${result.extensionId}/`)
        );
      if (!oldWorker) throw new Error('Package activation worker missing');
      previousVersion = await oldWorker.evaluate(
        () => chrome.runtime.getManifest().version
      );
      const activated = await result.activatePackage();
      expect(activated.id).toBe(extensionId);
    }
    await openWalletPopup();
    await verifyExecutingWorker(
      context!,
      result.extensionId,
      stablePath,
      (value) => workerIdentities.push(value)
    );
    if (activatePackage) {
      const currentVersion = await context!
        .serviceWorkers()
        .find((worker) =>
          worker.url().startsWith(`chrome-extension://${extensionId}/`)
        )!
        .evaluate(() => chrome.runtime.getManifest().version);
      expect(currentVersion).toBe(packageJson.version);
      snapshots.push({
        phase: 'package-update-activation',
        previousVersion,
        currentVersion,
        normalChromeLoadUnpacked: true,
      });
    }
  };
  const capture = async (phase: string) => {
    const value = await projection(page);
    const captured = {
      phase,
      ...value,
      uiNativeBalance: await page
        .locator('#home-balance')
        .evaluateAll((nodes) => nodes[0]?.textContent ?? null),
      uiNativeBalancePending:
        (await page.locator('#home-balance-pending').count()) > 0,
    };
    snapshots.push(captured);
    return captured;
  };
  const unlock = async () => {
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('#home-balance')).toHaveCount(0);
    await page.locator('#password').fill('WrongUpgradePassword!2026');
    await page.locator('#unlock-btn').click();
    await expect(
      page.getByText('Invalid password', { exact: true })
    ).toBeVisible();
    await page.locator('#password').fill(PASSWORD);
    await page.locator('#unlock-btn').click();
    await home();
  };
  const openDapp = async () => {
    const dapp = await context!.newPage();
    await dapp.goto(server.url);
    await dapp.waitForFunction(() =>
      Boolean((window as any).ethereum?.request)
    );
    // This changes only the runner's own local dapp transport. window.pali
    // exposes the UTXO provider; standard EVM requests use window.ethereum.
    await dapp.evaluate(() => {
      (window as any).__paliConformanceProvider = {
        request: async (args: any) => {
          const rows = (window as any).__paliConformance.requests;
          const row: any = {
            id: rows.length,
            method: args.method,
            started: Date.now(),
          };
          rows.push(row);
          try {
            return (row.result = await (window as any).ethereum.request(args));
          } catch (error) {
            row.error = { code: error.code, message: String(error.message) };
            throw error;
          } finally {
            row.settled = true;
            row.durationMs = Date.now() - row.started;
          }
        },
      };
    });
    return dapp;
  };
  const readDappIdentity = async (dapp: Page, connected = true) => {
    // Inspect standard responses in the dapp page. Only validated public
    // addresses and a leakage boolean cross into runner failure reports.
    const value = await dapp.evaluate(async () => {
      const provider = (window as any).ethereum;
      const accounts = await provider.request({ method: 'eth_accounts' });
      const permissions = await provider.request({
        method: 'wallet_getPermissions',
      });
      const grant = permissions.find(
        (item: any) => item.parentCapability === 'eth_accounts'
      );
      const publicAddresses = (input: any) =>
        Array.isArray(input)
          ? input.map((address) =>
              typeof address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(address)
                ? address.toLowerCase()
                : '[invalid-address]'
            )
          : [];
      return {
        accounts: publicAddresses(accounts),
        permittedAccounts: publicAddresses(grant?.caveats?.[0]?.value),
        privateFieldDetected:
          /(?:xprv|mnemonic|seedPhrase|vault|encryptedMnemonic)/i.test(
            JSON.stringify({ accounts, permissions })
          ),
      };
    });
    expect(value).toEqual({
      accounts: connected ? [fixture.evmAddresses[1].toLowerCase()] : [],
      permittedAccounts: connected
        ? [fixture.evmAddresses[1].toLowerCase()]
        : [],
      privateFieldDetected: false,
    });
  };
  const grantDappNormally = async (dapp: Page) => {
    for (const tab of context!.pages())
      if (tab.url().startsWith(`chrome-extension://${extensionId}/app.html`))
        await tab.close();
    const requestId = await startRequest(dapp, 'eth_requestAccounts');
    const requestSettled = () =>
      dapp.evaluate(
        (id) =>
          Boolean((window as any).__paliConformance.requests[id]?.settled),
        requestId
      );
    let popup: Page | undefined;
    await expect
      .poll(() => {
        popup = context!
          .pages()
          .find((candidate) => candidate.url().includes('/external'));
        return Boolean(popup);
      })
      .toBe(true);
    for (let i = 0; i < 3 && !popup!.isClosed(); i++) {
      if (await requestSettled()) break;
      const confirm = popup!
        .getByRole('button', {
          name: /(?:^|\s)(confirm|approve|connect|proceed)$/i,
        })
        .last();
      await expect(confirm).toBeVisible();
      await expect(confirm).toBeEnabled();
      await confirm.click();
      await expect
        .poll(
          async () =>
            popup!.isClosed() ||
            (await requestSettled()) ||
            (await confirm.isEnabled().catch(() => false))
        )
        .toBe(true);
    }
    await expect.poll(requestSettled).toBe(true);
    await readDappIdentity(dapp);
    await dapp.close();
    await openWalletPopup();
    await route('#/home');
    await home();
  };
  let passed = false;
  try {
    await launch(false);
    await step('legacy-normal-ui-wallet-import', async () => {
      await page.locator('#import-wallet-link').click();
      await page.addStyleTag({
        content: 'textarea { -webkit-text-security: disc !important; }',
      });
      await page.locator('#import-wallet-input').fill(UTXO_FIXTURE_SEED);
      await page.locator('#import-wallet-action').click();
      // Older releases reused an id for the two fields. Their normal form order
      // is stable, unlike the corrected ids in the current build.
      await page.locator('input[type="password"]').nth(0).fill(PASSWORD);
      await page.locator('input[type="password"]').nth(1).fill(PASSWORD);
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await home();
      await switchNetwork('Syscoin Testnet', 'UTXO');
      expect((await capture('legacy-first-utxo')).selected.address).toBe(
        fixture.utxo.userAddress
      );
    });
    await step('legacy-custom-token-second-utxo-and-settings', async () => {
      await page.locator('#assets-btn').click();
      await page.getByText('Import Token', { exact: true }).click();
      // The old IconButton shim dropped its aria-label. Select its visible
      // token row and ordinary trailing Import control, without changing it.
      const token = page
        .locator('li')
        .filter({ hasText: SPT_SYMBOL })
        .getByRole('button')
        .last();
      await token.click();
      await expect(token).toBeDisabled();
      await route('#/home');
      expect(
        (await capture('legacy-token')).tokens.map((asset: any) => asset.guid)
      ).toContain(SPT_GUID);
      await home();
      await page.locator('#activity-btn').click();
      await expect(
        page.getByText(`${historyId.slice(0, 4)}...${historyId.slice(-14)}`, {
          exact: true,
        })
      ).toBeVisible();
      await createAccount('Legacy UTXO two');
      expect((await capture('legacy-second-utxo')).selected.address).toBe(
        fixture.secondUtxo.address
      );
      await route('#/settings/advanced');
      await page.locator('input[type="number"]').fill('17');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.getByRole('button', { name: /^ok$/i }).first().click();
      await route('#/home');
      expect((await capture('legacy-settings')).advanced.autolock).toBe(17);
    });
    await step('legacy-evm-identities-and-custom-network', async () => {
      await switchNetwork('Syscoin NEVM Testnet', 'EVM');
      expect((await capture('legacy-first-evm')).selected.address).toBe(
        fixture.evmAddresses[0]
      );
      await createAccount('Legacy EVM two');
      expect((await capture('legacy-second-evm')).selected.address).toBe(
        fixture.evmAddresses[1]
      );
      await route('#/settings/networks/custom-rpc');
      await page.locator('#rpc_label input').fill('Legacy upgrade network');
      await page.locator('#rpc_url').fill(CUSTOM_RPC);
      await page.locator('#rpc_chainId').fill('65001');
      await page.locator('#rpc_symbol').fill('UPG');
      await page
        .locator('#rpc_explorer')
        .fill('https://legacy-explorer.invalid/');
      await page.getByRole('button', { name: /^(save|add)$/i }).click();
      const ok = page.getByRole('button', { name: /^ok$/i }).first();
      if (await ok.isVisible().catch(() => false)) await ok.click();
      await route('#/home');
      await switchNetwork('Legacy upgrade network', 'EVM');
      const value = await capture('legacy-custom-network');
      expect(value.chainId).toBe(65001);
      expect(value.networkUrl).toBe(CUSTOM_RPC);
      expect(value.selected.address).toBe(fixture.evmAddresses[1]);
    });
    await step(
      'legacy-normal-dapp-account-permission-without-signing',
      async () => {
        const dapp = await openDapp();
        // Older popup coordination rejects an existing ordinary app tab too.
        // Real users close their wallet popup before connecting a dapp. Do
        // the same through normal browser UI rather than changing any flag.
        for (const tab of context!.pages()) {
          if (
            tab.url().startsWith(`chrome-extension://${extensionId}/app.html`)
          )
            await tab.close();
        }
        const requestId = await startRequest(dapp, 'eth_requestAccounts');
        const requestSettled = () =>
          dapp.evaluate(
            (id) =>
              Boolean((window as any).__paliConformance.requests[id]?.settled),
            requestId
          );
        let popup: Page | undefined;
        await expect
          .poll(() => {
            popup = context!
              .pages()
              .find((candidate) => candidate.url().includes('/external'));
            return !!popup;
          })
          .toBe(true)
          .catch(async () => {
            const diagnostic = await dapp.evaluate((id) => {
              const value = (window as any).__paliConformance.requests[id];
              return {
                settled: Boolean(value?.settled),
                errorCode: value?.error?.code || null,
                hasResult: value?.result !== undefined,
              };
            }, requestId);
            snapshots.push({
              phase: 'legacy-dapp-no-popup',
              ...diagnostic,
              pagePaths: context!
                .pages()
                .map((candidate) => new URL(candidate.url()).pathname),
            });
            throw new Error(
              'Legacy dapp connection popup unavailable: ' +
                JSON.stringify(diagnostic)
            );
          });
        for (let i = 0; i < 3 && !popup!.isClosed(); i++) {
          if (await requestSettled()) break;
          const confirm = popup!
            .getByRole('button', {
              name: /(?:^|\s)(confirm|approve|connect|proceed)$/i,
            })
            .last();
          await expect(confirm).toBeVisible();
          await expect(confirm).toBeEnabled();
          await confirm.click();
          await expect
            .poll(
              async () =>
                popup!.isClosed() ||
                (await requestSettled()) ||
                (await confirm.isEnabled().catch(() => false))
            )
            .toBe(true);
        }
        await expect
          .poll(() =>
            dapp.evaluate(
              (id) =>
                Boolean(
                  (window as any).__paliConformance.requests[id]?.settled
                ),
              requestId
            )
          )
          .toBe(true);
        await readDappIdentity(dapp);
        await dapp.close();
        await openWalletPopup();
        await route('#/home');
        await home();
        await capture('legacy-dapp-grant');
      }
    );
    await step('legacy-lock-and-cold-close-before-upgrade', async () => {
      await page.locator('#general-settings-button').click();
      await page.getByText(en.generalMenu.lock, { exact: true }).click();
      await expect(page.locator('#password')).toBeVisible();
    });
    await owner!.context.close();
    owner = undefined;
    context = undefined;
    historyAvailable = false;
    fs.renameSync(stablePath, path.join(run, 'retained-legacy-extension'));
    fs.renameSync(nextPath, stablePath);
    await launch(true, true);
    await step(
      'upgraded-build-starts-locked-and-restores-custom-evm-account',
      async () => {
        await unlock();
        const value = await capture('current-custom-network');
        expect(value.chainId).toBe(65001);
        expect(value.networkUrl).toBe(CUSTOM_RPC);
        expect(value.selected.address).toBe(fixture.evmAddresses[1]);
        expect(value.accounts).toEqual(
          snapshots.find((item) => item.phase === 'legacy-custom-network')
            .accounts
        );
        expect(value.advanced.autolock).toBe(17);
        expect(value.builtInExplorerApis).toEqual({
          '1': 'https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api',
          '8453': null,
          '42161': null,
        });
        expect(value.grants).toEqual(
          snapshots.find((item) => item.phase === 'legacy-dapp-grant').grants
        );
        const dapp = await openDapp();
        // The old host:port grant did not bind scheme. Never silently expand
        // it into an authorization for a new HTTP/HTTPS origin.
        expect(value.grants[0].host).toBe(new URL(server.url).host);
        await readDappIdentity(dapp, false);
        expect(
          context!
            .pages()
            .filter((candidate) => candidate.url().includes('/external'))
        ).toEqual([]);
        await dapp.close();
        await openWalletPopup();
        await route('#/home');
        await home();
      }
    );
    await step(
      'upgrade-requires-explicit-full-origin-dapp-reconnection',
      async () => {
        await grantDappNormally(await openDapp());
        const value = await capture('current-full-origin-grant');
        expect(
          value.grants.some(
            (grant: any) =>
              grant.host === new URL(server.url).origin && grant.accountId === 1
          )
        ).toBe(true);
      }
    );
    await step(
      'upgraded-utxo-family-account-and-token-remain-separate',
      async () => {
        await switchNetwork('Syscoin Testnet', 'UTXO');
        const value = await capture('current-second-utxo');
        expect(value.selected.address).toBe(fixture.secondUtxo.address);
        expect(value.accounts).toEqual(
          snapshots.find((item) => item.phase === 'legacy-second-utxo').accounts
        );
        await page.locator('#general-settings-button').click();
        // The center of this compact row is the separate Copy button. Select
        // the account's icon area instead, as an ordinary user would.
        await page
          .locator('#account-HDAccount-0')
          .click({ position: { x: 20, y: 14 } });
        await home();
        await expect
          .poll(async () => (await projection(page)).selected.address, {
            timeout: 15000,
          })
          .toBe(fixture.utxo.userAddress);
        const first = await capture('current-first-utxo');
        expect(first.selected.address).toBe(fixture.utxo.userAddress);
        expect(first.tokens.map((token: any) => token.guid)).toContain(
          SPT_GUID
        );
        await page.locator('#activity-btn').click();
        await expect(
          page.getByText(`${historyId.slice(0, 4)}...${historyId.slice(-14)}`, {
            exact: true,
          })
        ).toBeVisible();
        expect(blockedHistoryReads).toBeGreaterThan(0);
        // A denied refresh is not a read of zero. Legacy balances have no new
        // cache timestamp, so this can be explicitly unknown or a retained
        // known balance, but it must not be silently promoted to loaded zero.
        const deniedRead = await capture('current-denied-native-read');
        expect(['-1', '0.001']).toContain(
          String(deniedRead.selectedNativeBalance)
        );
        if (deniedRead.uiNativeBalance === null) {
          expect(deniedRead.uiNativeBalancePending).toBe(true);
        } else {
          expect(deniedRead.uiNativeBalance).toBe('0.001');
        }
        historyAvailable = true;
      }
    );
    await step('lock-upgraded-wallet-before-controlled-restart', async () => {
      await page.locator('#general-settings-button').click();
      await page.getByText(en.generalMenu.lock, { exact: true }).click();
      await expect(page.locator('#password')).toBeVisible();
      // Do not confuse upgrade preservation with a later uncheckpointed
      // account-selection crash test. Lock performs a real emergency save. Observe
      // only its public selected-id field before closing the browser.
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              new Promise<number | null>((resolve) => {
                chrome.storage.local.get(['state-vault-1'], (values) =>
                  resolve(values['state-vault-1']?.activeAccount?.id ?? null)
                );
              })
          )
        )
        .toBe(0);
    });
    await owner!.context.close();
    owner = undefined;
    context = undefined;
    await launch(true);
    await step(
      'second-cold-start-remains-locked-and-restores-upgraded-wallet',
      async () => {
        await unlock();
        const value = await capture('current-second-cold-start');
        expect(value.selected.address).toBe(fixture.utxo.userAddress);
        expect(value.tokens.map((token: any) => token.guid)).toContain(
          SPT_GUID
        );
        expect(value.advanced.autolock).toBe(17);
        const storage = await page.evaluate(
          () =>
            new Promise<any>((resolve) => {
              chrome.storage.local.get(
                ['state', 'state-vault-1', 'state-vault-60', '4.0.72'],
                (values) =>
                  resolve({
                    globalStateHasInlineVault:
                      Object.prototype.hasOwnProperty.call(
                        values.state || {},
                        'vault'
                      ),
                    separateUtxoVault: Boolean(values['state-vault-1']),
                    separateEvmVault: Boolean(values['state-vault-60']),
                    explorerMigrationMarked: values['4.0.72'] === 'migrated',
                  })
              );
            })
        );
        expect(storage).toEqual({
          globalStateHasInlineVault: false,
          separateUtxoVault: true,
          separateEvmVault: true,
          explorerMigrationMarked: true,
        });
        snapshots.push({ phase: 'current-storage-placement', ...storage });
        expect(
          observations.flatMap((observation) => observation.deniedWrites)
        ).toEqual([]);
      }
    );
    await step(
      'reconfirmed-origin-permission-survives-upgraded-cold-restart',
      async () => {
        await switchNetwork('Legacy upgrade network', 'EVM', 65001);
        const dapp = await openDapp();
        await readDappIdentity(dapp);
        expect(
          context!
            .pages()
            .filter((candidate) => candidate.url().includes('/external'))
        ).toEqual([]);
        await dapp.close();
        await openWalletPopup();
        await route('#/home');
        await home();
        await capture('current-cold-restart-origin-grant');
      }
    );
    expect(
      createHash('sha256').update(fs.readFileSync(__filename)).digest('hex')
    ).toBe(testSourceSha256);
    passed = true;
  } finally {
    await owner?.context.close();
    fs.writeFileSync(
      path.join(run, 'legacy-upgrade.json'),
      JSON.stringify(
        {
          status: passed ? 'passed' : 'failed',
          legacyArtifact,
          currentArtifact,
          extensionId,
          sameExtensionPathAndId: workerIdentities.length >= 2,
          sameDisposableProfile: workerIdentities.length >= 2,
          normalLegacyUICreatedWallet: steps.some(
            (value) =>
              value.name === 'legacy-normal-ui-wallet-import' &&
              value.status === 'passed'
          ),
          testSourceSha256,
          vaultInjectedOrReimported: false,
          physicalHardware: false,
          signaturesRequested: false,
          chainBroadcast: false,
          steps,
          snapshots,
          workerIdentities,
          fixtureReads: observations.flatMap((value) => value.reads),
          deniedWrites: observations.flatMap((value) => value.deniedWrites),
          proxyDeniedConnections: server.blocked.length,
          proxyDeniedMethods: server.blocked.slice(),
          physicalCanaries,
          blockedHistoryReads,
          browserQaSessionsClosed: true,
        },
        null,
        2
      ),
      { flag: 'wx', mode: 0o600 }
    );
    Object.assign(E2E_CONFIG, before);
    await server.close();
  }
});
