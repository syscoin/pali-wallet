import { expect, test, type Page, type Worker } from '@playwright/test';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
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
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const CHAIN_ID = 2;
const LABEL = 'Synthetic LTC removal';
const RPC = 'https://network-removal.synthetic.invalid';
const VAULT_KEY = 'state-vault-2';
const PROFILE_KEY = `${VAULT_KEY}-passkey-profile`;
const FAILURE = 'Synthetic network removal storage refusal';

function litecoinFixture() {
  const config = getNetworkConfig(CHAIN_ID, 'Litecoin');
  // The same public synthetic seed and installed derivation parameters as
  // normal wallet creation, never an exported key from the browser wallet.
  const hd = new (sys.HDSigner as any)(
    UTXO_FIXTURE_SEED,
    null,
    false,
    config.networks,
    CHAIN_ID,
    config.types.zPubType,
    84
  );
  const key = hd.deriveKeypair("m/84'/2'/0'/0/0");
  return {
    xpub: hd.getAccountXpub() as string,
    address: sys.bitcoinjs.payments.p2wpkh({
      pubkey: key.publicKey,
      network: config.networks.mainnet,
    }).address!,
  };
}

const snapshot = (page: Page) =>
  page.evaluate(
    async ({ chainId, vaultKey, profileKey }) => {
      const live = await chrome.runtime.sendMessage({
        type: 'getCurrentState',
      });
      const stored = await chrome.storage.local.get([
        'state',
        vaultKey,
        profileKey,
      ]);
      const network = (entry: any) =>
        entry
          ? {
              chainId: entry.chainId,
              kind: entry.kind,
              label: entry.label,
              slip44: entry.slip44,
              url: entry.url,
            }
          : null;
      const vault = stored[vaultKey];
      // Only public account identity and key presence leave the browser.
      return {
        live: network(live.vaultGlobal.networks.syscoin[chainId]),
        saved: network(stored.state?.vaultGlobal?.networks?.syscoin?.[chainId]),
        active: network(live.vault.activeNetwork),
        activeSlip44: live.vaultGlobal.activeSlip44,
        vault: vault
          ? {
              network: network(vault.activeNetwork),
              accounts: Object.entries(vault.accounts).flatMap(
                ([type, accounts]: [string, any]) =>
                  Object.values(accounts).map((account: any) => ({
                    type,
                    id: account.id,
                    address: account.address,
                    xpub: account.xpub,
                  }))
              ),
            }
          : null,
        profilePresent: Boolean(stored[profileKey]),
        vaultTombstone: stored[vaultKey] === null,
        profileTombstone: stored[profileKey] === null,
      };
    },
    { chainId: CHAIN_ID, vaultKey: VAULT_KEY, profileKey: PROFILE_KEY }
  );

test('inactive custom UTXO network removal retains its vault after storage refusal and survives retry and restart', async ({}, info) => {
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const previous = { ...E2E_CONFIG };
  const fixture = litecoinFixture();
  const server = await startUtxoFixtureServer();
  const reads: string[] = [];
  const deniedWrites: string[] = [];
  const observations: Record<string, unknown> = {};
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'NetworkRemovalSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let worker: Worker | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('network-removal-durability', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    await wallet.context.route(`${RPC}/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        request.method() !== 'GET' ||
        /\/(?:sendtx|sendrawtransaction)(?:\/|$)/i.test(url.pathname)
      ) {
        deniedWrites.push('attempted-write');
        return route.abort('blockedbyclient');
      }
      let body: unknown;
      if (url.pathname === '/api/v2' || url.pathname === '/api/v2/') {
        body = {
          blockbook: { coin: 'Litecoin', inSync: true, bestHeight: 1 },
          backend: { chain: 'main', blocks: 1 },
        };
      } else {
        const match = url.pathname.match(
          /^\/api\/v2\/(xpub|address|utxo)\/(.+)$/
        );
        const identifier = match && decodeURIComponent(match[2]);
        if (
          match &&
          (identifier === fixture.xpub || identifier === fixture.address)
        ) {
          body =
            match[1] === 'utxo'
              ? []
              : {
                  address: identifier,
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
        } else if (/^\/api\/v2\/estimatefee\/[126]$/.test(url.pathname)) {
          body = { result: '0.00001' };
        }
      }
      if (body === undefined) return route.abort('blockedbyclient');
      reads.push(url.pathname);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(body),
      });
    });
    const page = wallet.page;
    const row = () =>
      page
        .locator('li')
        .filter({ has: page.getByText(LABEL, { exact: true }) });
    const remove = async () => {
      await expect(row()).toHaveCount(1);
      await expect(row().locator('button').last()).toBeEnabled();
      await row().locator('button').last().click();
      const title = en.settings.confirmRemoveNetwork.replace(
        '{{networkName}}',
        LABEL
      );
      const dialog = page.getByRole('dialog', { name: title, exact: true });
      await expect(dialog).toBeVisible();
      await dialog.locator('#confirm-btn').click();
      await expect(dialog).toHaveCount(0);
    };
    await wallet.step(
      'add a custom UTXO network through the real RPC form',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.gotoRoute('#/settings/networks/custom-rpc');
        const kind = page.getByRole('switch', {
          name: en.settings.networkFamilyLabel.replace('{{family}}', 'Syscoin'),
          exact: true,
        });
        if ((await kind.getAttribute('aria-checked')) !== 'true')
          await kind.click();
        await expect(kind).toHaveAttribute('aria-checked', 'true');
        await page
          .getByRole('combobox', { name: en.settings.label, exact: true })
          .fill(LABEL);
        await page.locator('input#rpc_symbol').fill('LTC');
        const rpc = page.locator('input#rpc_url');
        await rpc.fill(RPC);
        await rpc.press('Tab');
        await expect.poll(() => reads.includes('/api/v2')).toBe(true);
        await expect(page.locator('input#rpc_chainId')).toHaveValue(
          String(CHAIN_ID)
        );
        const save = page.getByRole('button', {
          name: en.buttons.save,
          exact: true,
        });
        await expect(save).toBeEnabled();
        await save.click();
        await expect(page).toHaveURL(/#\/home$/);
        await expect
          .poll(async () => (await snapshot(page)).saved?.url)
          .toBe(RPC);
      }
    );
    await wallet.step(
      'create its real vault by switching, then leave it inactive',
      async () => {
        await wallet!.switchNetwork(LABEL, 'UTXO');
        await expect
          .poll(async () => (await snapshot(page)).activeSlip44)
          .toBe(CHAIN_ID);
        const active = await snapshot(page);
        expect(active.vault?.accounts).toContainEqual({
          type: 'HDAccount',
          id: 0,
          address: fixture.address,
          xpub: fixture.xpub,
        });
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.gotoRoute('#/settings/networks/edit');
        const before = await snapshot(page);
        expect(before.activeSlip44).toBe(1);
        expect(before.vault).not.toBeNull();
        expect(before.live?.url).toBe(RPC);
        expect(before.saved).toEqual(before.live);
        observations.before = before;
      }
    );
    worker = wallet.context
      .serviceWorkers()
      .find((candidate) =>
        candidate.url().startsWith(`chrome-extension://${wallet!.extensionId}/`)
      );
    expect(worker).toBeDefined();
    await worker!.evaluate(
      ({ chainId, vaultKey, profileKey, failure }) => {
        const local = chrome.storage.local;
        const set = local.set;
        const removeKeys = local.remove;
        const probe = {
          failures: 0,
          removalBatches: [] as boolean[],
          separateRemovals: [] as string[],
          restore: () => {
            local.set = set;
            local.remove = removeKeys;
            delete (globalThis as any).__networkRemovalStorage;
          },
        };
        (globalThis as any).__networkRemovalStorage = probe;
        local.set = ((items: Record<string, any>, ...args: any[]) => {
          if (
            items.state &&
            !items.state.vaultGlobal?.networks?.syscoin?.[chainId]
          ) {
            probe.removalBatches.push(
              items[vaultKey] === null && items[profileKey] === null
            );
            if (!probe.failures) {
              probe.failures += 1;
              throw new Error(failure);
            }
          }
          return (set as any).call(local, items, ...args);
        }) as typeof local.set;
        local.remove = ((keys: string | string[], ...args: any[]) => {
          probe.separateRemovals.push(
            ...[keys]
              .flat()
              .filter((key) => key === vaultKey || key === profileKey)
          );
          return (removeKeys as any).call(local, keys, ...args);
        }) as typeof local.remove;
      },
      {
        chainId: CHAIN_ID,
        vaultKey: VAULT_KEY,
        profileKey: PROFILE_KEY,
        failure: FAILURE,
      }
    );
    await wallet.step(
      'refused removal retains the registry and owned vault for the same visible retry',
      async () => {
        await remove();
        const error = page.getByText(en.settings.networkRemovalIncomplete, {
          exact: true,
        });
        await expect(error).toBeVisible();
        expect(await snapshot(page)).toEqual(observations.before);
        await expect(row()).toHaveCount(1);
        await expect(row().locator('button').last()).toBeEnabled();
        observations.refused = await snapshot(page);
        await error.click();
        await expect(error).toBeHidden();
      }
    );
    await wallet.step(
      'retry commits registry removal and both owned-vault tombstones together',
      async () => {
        await remove();
        await expect(row()).toHaveCount(0);
        await expect
          .poll(async () => {
            const state = await snapshot(page);
            return [
              state.live,
              state.saved,
              state.vault,
              state.profilePresent,
              state.vaultTombstone,
              state.profileTombstone,
            ];
          })
          .toEqual([null, null, null, false, true, true]);
        const removed = await snapshot(page);
        expect(removed.active).toEqual((observations.before as any).active);
        expect(removed.activeSlip44).toBe(1);
        observations.removed = removed;
        observations.storage = await worker!.evaluate(() => {
          const probe = (globalThis as any).__networkRemovalStorage;
          const result = {
            failures: probe.failures,
            removalBatches: probe.removalBatches,
            separateRemovals: probe.separateRemovals,
          };
          probe.restore();
          return result;
        });
        expect(observations.storage).toEqual({
          failures: 1,
          removalBatches: [true, true],
          separateRemovals: [],
        });
      }
    );
    await wallet.step(
      'a cold background worker cannot restore the removed network or its owned vault',
      async () => {
        const cdp = await wallet!.context.newCDPSession(page);
        try {
          const { targetInfos } = await cdp.send('Target.getTargets');
          const target = targetInfos.find(
            (entry) =>
              entry.type === 'service_worker' &&
              entry.url.startsWith(`chrome-extension://${wallet!.extensionId}/`)
          );
          expect(target).toBeDefined();
          expect(
            (
              await cdp.send('Target.closeTarget', {
                targetId: target!.targetId,
              })
            ).success
          ).toBe(true);
        } finally {
          await cdp.detach();
        }
        await page.reload();
        await wallet!.waitAppReady();
        if (await page.locator('#unlock-btn').isVisible())
          await wallet!.unlock();
        await wallet!.ensureOnHome();
        await verifyExecutingWorker(
          wallet!.context,
          wallet!.extensionId,
          E2E_CONFIG.extensionPath,
          (identity) => {
            observations.restartedWorker = identity;
          }
        );
        expect(await snapshot(page)).toEqual(observations.removed);
        await wallet!.gotoRoute('#/settings/networks/edit');
        await expect(row()).toHaveCount(0);
      }
    );
    expect(reads).toContain(`/api/v2/xpub/${fixture.xpub}`);
    expect(deniedWrites).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    status = 'passed';
  } finally {
    try {
      await info.attach('network-removal-durability-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          runtime: extensionEvidence(),
          observations,
          reads,
          deniedWrites: [...deniedWrites, ...(routes?.deniedWrites || [])],
          proxyDeniedConnections: server.blocked.length,
          controllerStateReplaced: false,
        }),
      });
    } finally {
      await worker
        ?.evaluate(() => (globalThis as any).__networkRemovalStorage?.restore())
        .catch(() => undefined);
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
