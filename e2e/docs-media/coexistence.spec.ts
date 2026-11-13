import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import { E2E_CONFIG } from '../harness/config';
import { clickClosingPopup } from '../harness/dismissRejectedApproval';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { JourneySummary } from '../harness/summary';
import { startUtxoFixtureServer } from '../harness/utxoFixture';
import {
  createVisualFixture,
  installVisualFixtureRoutes,
  VISUAL_FIXTURE_CHAIN_ID,
  VISUAL_FIXTURE_SEED,
} from '../harness/visualFixture';
import { installOfflineWalletRelease } from '../harness/walletReleaseFixture';

const OUT = process.env.PALI_COEXISTENCE_OUT
  ? path.resolve(process.env.PALI_COEXISTENCE_OUT)
  : path.join(__dirname, 'out', 'coexistence');
const DEMO = 'https://demo.paliwallet.com/coexistence';
const HTML = `<!doctype html><title>Pali coexistence fixture</title><h1>Disposable provider fixture</h1><script>
window.providers = {};
window.requests = {};
window.addEventListener('eip6963:announceProvider', ({detail}) => {
  window.providers[detail.provider.wallet] = detail;
});
window.dispatchEvent(new Event('eip6963:requestProvider'));
</script>`;

function packageIdentity(directory: string) {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) files.push(path.relative(directory, file));
      else throw new Error('Extension package contains a non-file entry');
    }
  };
  visit(directory);
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    hash.update(file + '\0');
    hash.update(fs.readFileSync(path.join(directory, file)));
  }
  return hash.digest('hex');
}

test('old unnamespaced package and new Canary keep provider approvals separate', async () => {
  const previous = { ...E2E_CONFIG };
  const directories = {
    legacy: process.env.PALI_LEGACY_EXTENSION_PATH!,
    canary: process.env.PALI_CANARY_EXTENSION_PATH!,
  };
  for (const directory of Object.values(directories)) {
    expect(path.isAbsolute(directory)).toBe(true);
    expect(fs.realpathSync(directory)).toBe(directory);
  }
  expect(directories.legacy).not.toBe(directories.canary);
  const manifests = Object.fromEntries(
    Object.entries(directories).map(([key, dir]) => [
      key,
      JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')),
    ])
  );
  expect(manifests.legacy.version).toBe('5.0.0.2');
  expect(manifests.canary.version).not.toBe(manifests.legacy.version);
  expect(manifests.canary.name).toContain('Canary');
  const hashes = Object.fromEntries(
    Object.entries(directories).map(([key, dir]) => [key, packageIdentity(dir)])
  );
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(OUT, 'profile-'));
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    chainId: VISUAL_FIXTURE_CHAIN_ID,
    networkLabel: 'zkTanenbaum',
    password: 'CoexistenceDisposable!2026',
    rpcUrl: server.url,
    seedPhrase: VISUAL_FIXTURE_SEED,
  });
  let context: BrowserContext | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const workers: Record<string, unknown> = {};
  const approvalEvidence: unknown[] = [];
  const drivers: PaliWallet[] = [];
  let providers: unknown;
  let routes:
    | Awaited<ReturnType<typeof installVisualFixtureRoutes>>
    | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, {
      chromiumSandbox: true,
      headless: false,
      args: [
        '--headless=new',
        '--disable-quic',
        `--disable-extensions-except=${directories.legacy},${directories.canary}`,
        `--load-extension=${directories.legacy},${directories.canary}`,
      ],
      ignoreDefaultArgs: ['--disable-extensions'],
      proxy: { server: server.url, bypass: '<-loopback>' },
      viewport: { width: 400, height: 620 },
    });
    routes = await installVisualFixtureRoutes(
      context,
      createVisualFixture(),
      server.url
    );
    await expect.poll(() => context!.serviceWorkers().length).toBe(2);
    const discovered = await Promise.all(
      context.serviceWorkers().map(async (worker) => ({
        id: worker.url().split('/')[2],
        version: await worker.evaluate(
          () => chrome.runtime.getManifest().version
        ),
      }))
    );
    const ids: Record<string, string> = {};
    for (const key of ['legacy', 'canary'] as const) {
      const matches = discovered.filter(
        (worker) => worker.version === manifests[key].version
      );
      expect(matches).toHaveLength(1);
      ids[key] = matches[0].id;
      await verifyExecutingWorker(
        context,
        ids[key],
        directories[key],
        (identity) => {
          workers[key] = identity;
        }
      );
      const page = await context.newPage();
      await installOfflineWalletRelease(page);
      // Attach the existing driver to the already-owned shared context. This
      // calls its real constructor; it does not alter extension state or auth.
      const driver = Reflect.construct(PaliWallet, [
        context,
        ids[key],
        page,
        new JourneySummary(`coexistence-${key}`),
        profile,
      ]) as PaliWallet;
      drivers.push(driver);
      await driver.importSeedAndCreatePassword();
      await driver.switchNetwork('zkTanenbaum');
      await driver.ensureOnHome();
      await page.goto('about:blank');
    }
    await context.route(DEMO, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: HTML })
    );
    const dapp = await context.newPage();
    await dapp.goto(DEMO);
    await expect
      .poll(() =>
        dapp.evaluate(() => Object.keys((window as any).providers).sort())
      )
      .toEqual(['pali-canary:pali-v2', 'pali-v2']);
    providers = await dapp.evaluate(() =>
      Object.values((window as any).providers).map((entry: any) => ({
        info: entry.info,
        wallet: entry.provider.wallet,
      }))
    );
    const popupPages: Page[] = [];
    context.on('page', (page) => popupPages.push(page));
    for (const key of ['legacy', 'canary'] as const) {
      const walletId = key === 'legacy' ? 'pali-v2' : 'pali-canary:pali-v2';
      const pendingPopup = context.waitForEvent('page');
      await dapp.evaluate((id) => {
        const scope = window as any;
        scope.requests[id] = { state: 'pending' };
        scope.providers[id].provider
          .request({ method: 'eth_requestAccounts' })
          .then(
            (result: unknown) => {
              scope.requests[id] = { state: 'resolved', result };
            },
            (error: any) => {
              scope.requests[id] = { state: 'rejected', code: error.code };
            }
          );
      }, walletId);
      const popup = await pendingPopup;
      await expect
        .poll(() => popup.url().startsWith(`chrome-extension://${ids[key]}/`))
        .toBe(true);
      await expect(
        popup.getByRole('button', { name: /^(cancel|reject)$/i }).first()
      ).toBeVisible();
      await popup.screenshot({
        path: path.join(OUT, `${key}-approval.png`),
        animations: 'disabled',
      });
      approvalEvidence.push({
        selectedProvider: walletId,
        extensionId: ids[key],
        popupUrl: popup.url(),
      });
      await clickClosingPopup({
        click: () =>
          popup
            .getByRole('button', { name: /^(cancel|reject)$/i })
            .first()
            .click(),
        isClosed: () => popup.isClosed(),
      });
      await expect
        .poll(() =>
          dapp.evaluate((id) => (window as any).requests[id], walletId)
        )
        .toEqual({ state: 'rejected', code: 4001 });
      await dapp.waitForTimeout(500);
      expect(popupPages).toHaveLength(key === 'legacy' ? 1 : 2);
    }
    expect(routes.deniedWrites).toEqual([]);
    for (const key of ['legacy', 'canary'] as const)
      expect(packageIdentity(directories[key])).toBe(hashes[key]);
    status = 'passed';
  } finally {
    fs.writeFileSync(
      path.join(OUT, 'result.json'),
      JSON.stringify(
        {
          status,
          manifests,
          packageHashes: hashes,
          workers,
          providers,
          approvalEvidence,
          deniedWrites: routes?.deniedWrites,
          noPublicNetwork: true,
          transactionsSubmitted: 0,
          completedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
    try {
      for (const driver of drivers) driver.summary.finish(status);
    } finally {
      try {
        await context?.close();
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  }
});
