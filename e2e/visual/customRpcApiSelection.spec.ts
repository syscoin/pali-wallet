import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
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

const CHAINS = [
  {
    name: 'API Alpha',
    chainId: 313371,
    symbol: 'AAA',
    rpc: 'https://rpc-api-alpha.synthetic.invalid',
    explorer: 'https://explorer-api-alpha.synthetic.invalid/',
  },
  {
    name: 'API Beta',
    chainId: 313372,
    symbol: 'BBB',
    rpc: 'https://rpc-api-beta.synthetic.invalid',
    explorer: 'https://explorer-api-beta.synthetic.invalid/',
  },
] as const;
const API_A = 'https://api-alpha.synthetic.invalid/api';
const API_B = 'https://api-beta.synthetic.invalid/api';
const CATALOGUE_URL = 'https://chainlist.org/rpcs.json';
const catalogueWire = JSON.stringify(
  CHAINS.map((chain) => ({
    name: chain.name,
    chainId: chain.chainId,
    networkId: chain.chainId,
    nativeCurrency: {
      name: chain.symbol,
      symbol: chain.symbol,
      decimals: 18,
    },
    rpc: [{ url: chain.rpc, tracking: 'none', isOpenSource: true }],
    explorers: [{ name: chain.name + ' explorer', url: chain.explorer }],
  }))
);

// Read only the public account/network and the two public registry entries.
// Never replace controller replies, Redux, Chrome APIs or persisted state.
const publicState = (page: Page) =>
  page.evaluate(
    async (chainIds) => {
      const state = await chrome.runtime.sendMessage({
        type: 'getCurrentState',
      });
      const stored = await chrome.storage.local.get('state');
      const project = (entry: any) =>
        entry
          ? {
              chainId: entry.chainId,
              kind: entry.kind,
              label: entry.label,
              url: entry.url,
              explorer: entry.explorer,
              currency: entry.currency,
              slip44: entry.slip44,
              apiUrl: entry.apiUrl ?? '',
            }
          : null;
      const ref = state.vault.activeAccount;
      return {
        account: {
          id: ref.id,
          type: ref.type,
          address: state.vault.accounts[ref.type][ref.id].address,
        },
        active: project(state.vault.activeNetwork),
        live: chainIds.map((id) =>
          project(state.vaultGlobal.networks.ethereum[id])
        ),
        saved: chainIds.map((id) =>
          project(stored.state?.vaultGlobal?.networks?.ethereum?.[id])
        ),
      };
    },
    CHAINS.map((chain) => chain.chainId)
  );

for (const mode of ['field', 'durable'] as const) {
  test(
    mode === 'field'
      ? 'custom RPC catalogue changes clear the previous API and retain an explicit new-chain API'
      : 'custom RPC catalogue changes never durably associate the previous chain API with a new chain',
    async ({}, info) => {
      test.setTimeout(120_000);
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
      let server:
        | Awaited<ReturnType<typeof startUtxoFixtureServer>>
        | undefined;
      let wallet: PaliWallet | undefined;
      let routes:
        | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
        | undefined;
      let status: 'passed' | 'failed' = 'failed';
      let phase = 'onboarding';
      const reads: Array<{ body?: unknown; phase: string; url: string }> = [];
      const deniedRequests: string[] = [];
      const observations: Record<string, unknown> = {};
      try {
        server = await startUtxoFixtureServer();
        Object.assign(E2E_CONFIG, {
          seedPhrase: UTXO_FIXTURE_SEED,
          password: 'CustomRpcApiSelectionSynthetic!2026',
          rpcUrl: server.url,
        });
        wallet = await PaliWallet.launch('custom-rpc-api-selection-' + mode, {
          offlineHttpProxy: server.url,
          viewport: { width: 400, height: 620 },
        });
        routes = await installIsolatedVaultRoutes(
          wallet.context,
          createIsolatedVaultFixture(),
          server.url
        );
        await wallet.context.route(CATALOGUE_URL, async (route) => {
          const request = route.request();
          if (request.method() !== 'GET' || request.url() !== CATALOGUE_URL) {
            deniedRequests.push(request.method() + ' ' + request.url());
            return route.abort('blockedbyclient');
          }
          reads.push({ phase, url: request.url() });
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: catalogueWire,
          });
        });
        for (const chain of CHAINS) {
          await wallet.context.route(chain.rpc + '/', async (route) => {
            const request = route.request();
            let payload: any;
            try {
              payload = request.postDataJSON();
            } catch {
              deniedRequests.push('non-JSON RPC ' + request.url());
              return route.abort('blockedbyclient');
            }
            const calls = Array.isArray(payload) ? payload : [payload];
            if (
              request.method() !== 'POST' ||
              !calls.length ||
              !calls.every(
                (call) =>
                  call?.jsonrpc === '2.0' &&
                  Array.isArray(call.params) &&
                  call.params.length === 0 &&
                  ['eth_chainId', 'eth_blockNumber', 'net_version'].includes(
                    call.method
                  )
              )
            ) {
              deniedRequests.push('non-allowlisted RPC ' + request.url());
              return route.abort('blockedbyclient');
            }
            reads.push({ phase, url: request.url(), body: payload });
            const replies = calls.map((call) => ({
              jsonrpc: '2.0',
              id: call.id,
              result:
                call.method === 'eth_blockNumber'
                  ? '0x1'
                  : call.method === 'net_version'
                  ? String(chain.chainId)
                  : '0x' + chain.chainId.toString(16),
            }));
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              headers: { 'access-control-allow-origin': '*' },
              body: JSON.stringify(
                Array.isArray(payload) ? replies : replies[0]
              ),
            });
          });
        }
        for (const endpoint of [API_A, API_B]) {
          await wallet.context.route(endpoint + '?*', async (route) => {
            const request = route.request();
            const url = new URL(request.url());
            const module = url.searchParams.get('module');
            const action = url.searchParams.get('action');
            if (
              request.method() !== 'GET' ||
              url.origin + url.pathname !== endpoint ||
              url.username ||
              url.password ||
              url.hash ||
              [...url.searchParams.keys()].some(
                (key) => !['module', 'action'].includes(key)
              ) ||
              !(
                (module === 'block' && action === 'eth_block_number') ||
                (module === 'proxy' && action === 'eth_blockNumber')
              )
            ) {
              deniedRequests.push(request.method() + ' ' + request.url());
              return route.abort('blockedbyclient');
            }
            reads.push({ phase, url: request.url() });
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                status: '1',
                message: 'OK',
                result: '0x1',
              }),
            });
          });
        }
        const page = wallet.page;
        const label = page.getByRole('combobox', {
          name: en.settings.label,
          exact: true,
        });
        const api = page.locator('#rpc_apiUrl');
        const save = page.getByRole('button', {
          name: en.buttons.save,
          exact: true,
        });
        let initial: Awaited<ReturnType<typeof publicState>>;
        const unchanged = async () => {
          const current = await publicState(page);
          expect(current.account).toEqual(initial.account);
          expect(current.active).toEqual(initial.active);
        };
        const select = async (chain: (typeof CHAINS)[number]) => {
          await label.fill('');
          await label.fill(chain.name);
          const option = page.getByRole('option').filter({
            has: page.getByText(chain.name, { exact: true }),
          });
          await expect(option).toHaveCount(1);
          await option.click();
          await expect(label).toHaveValue(chain.name);
          await expect(page.locator('#rpc_url')).toHaveValue(chain.rpc);
          await expect(page.locator('#rpc_chainId')).toHaveValue(
            String(chain.chainId)
          );
          await expect(page.locator('#rpc_symbol')).toHaveValue(chain.symbol);
          await expect(save).toBeEnabled();
          expect(
            reads.filter(
              (read) => read.phase === phase && read.url === chain.rpc + '/'
            ).length
          ).toBeGreaterThanOrEqual(3);
        };
        await wallet.step(
          mode + ': open the ordinary custom RPC form in a fenced wallet',
          async () => {
            await wallet!.importSeedAndCreatePassword();
            await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
            await wallet!.ensureOnHome();
            initial = await publicState(page);
            expect(initial.active).toMatchObject({
              kind: 'syscoin',
              chainId: 5700,
            });
            expect(initial.live).toEqual([null, null]);
            expect(initial.saved).toEqual([null, null]);
            await page
              .getByRole('button')
              .filter({ has: page.locator('#network-settings-btn') })
              .click();
            await page
              .getByRole('menuitem', {
                name: en.networkMenu.customRpc,
                exact: true,
              })
              .click();
            await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
            await expect(api).toBeVisible();
            await expect
              .poll(() => reads.some((read) => read.url === CATALOGUE_URL))
              .toBe(true);
            await unchanged();
            observations.initial = initial;
          }
        );
        await wallet.step(
          mode +
            ': retain the manually entered API when reselecting the same catalogue chain',
          async () => {
            phase = 'select-alpha';
            await select(CHAINS[0]);
            await api.fill(API_A);
            phase = 'reselect-alpha';
            await select(CHAINS[0]);
            await expect(api).toHaveValue(API_A);
            await unchanged();
            observations.sameChain = { api: await api.inputValue() };
          }
        );
        await wallet.step(
          mode +
            ': select a different catalogue chain without changing the active wallet',
          async () => {
            phase = 'select-beta';
            await select(CHAINS[1]);
            await api.scrollIntoViewIfNeeded();
            observations.afterDifferentChain = {
              api: await api.inputValue(),
              rpc: await page.locator('#rpc_url').inputValue(),
              chainId: await page.locator('#rpc_chainId').inputValue(),
            };
            await unchanged();
            if (mode === 'field') {
              // This direct UI regression fails before the production fix.
              await expect(api).toHaveValue('');
              await api.fill(API_B);
              await expect(api).toHaveValue(API_B);
            }
            // The durable case deliberately does not assert, clear or overwrite
            // this field, so its baseline failure proves the real saved result.
          }
        );
        await wallet.step(
          mode +
            ': save the selected chain and verify its exact durable API association',
          async () => {
            phase = 'save-beta';
            const expectedApi = mode === 'field' ? API_B : '';
            const expected = {
              chainId: CHAINS[1].chainId,
              kind: 'ethereum',
              label: CHAINS[1].name,
              url: CHAINS[1].rpc,
              explorer: CHAINS[1].explorer,
              currency: CHAINS[1].symbol.toLowerCase(),
              slip44: 60,
              apiUrl: expectedApi,
            };
            await save.click();
            await expect(page).toHaveURL(/#\/home$/);
            await expect
              .poll(async () => {
                const current = await publicState(page);
                observations.afterSave = current;
                return { live: current.live, saved: current.saved };
              })
              .toEqual({ live: [null, expected], saved: [null, expected] });
            await unchanged();
            const apiReads = reads.filter((read) =>
              [API_A, API_B].includes(read.url.split('?')[0])
            );
            if (mode === 'field') {
              expect(apiReads.length).toBeGreaterThan(0);
              expect(
                apiReads.every((read) => read.url.startsWith(API_B + '?'))
              ).toBe(true);
            } else expect(apiReads).toEqual([]);
            await wallet!.gotoRoute('#/settings/networks/edit');
            const row = page.locator('li').filter({
              has: page.getByText(CHAINS[1].name, { exact: true }),
            });
            await expect(row).toHaveCount(1);
            await row.locator('button').first().click();
            await expect(api).toHaveValue(expectedApi);
            await unchanged();
            expect(deniedRequests).toEqual([]);
            expect(routes!.deniedWrites).toEqual([]);
            expect(extensionEvidence()).toEqual(runtime);
          }
        );
        status = 'passed';
      } finally {
        try {
          await info.attach('custom-rpc-api-selection-' + mode, {
            contentType: 'application/json',
            body: JSON.stringify({
              status,
              mode,
              runtime,
              testSourceSha256: createHash('sha256')
                .update(fs.readFileSync(info.file))
                .digest('hex'),
              catalogueWireSha256: createHash('sha256')
                .update(catalogueWire)
                .digest('hex'),
              observations,
              reads,
              deniedRequests,
              fixtureReads: routes?.reads || [],
              deniedWrites: routes?.deniedWrites || [],
              proxyDeniedRequests: server?.blocked || [],
              syntheticHttpOnly: true,
              controllerStateReplaced: false,
              controllerResultsReplaced: false,
              chromeApiReplaced: false,
              storageReplaced: false,
              signingOrBroadcastRequested: false,
            }),
          });
        } catch (error) {
          status = 'failed';
          throw error;
        } finally {
          try {
            await wallet?.dispose(status);
          } finally {
            try {
              await server?.close();
            } finally {
              Object.assign(E2E_CONFIG, previous);
            }
          }
        }
      }
    }
  );
}
