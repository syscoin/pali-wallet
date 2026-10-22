import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { dismissRejectedApproval } from '../harness/dismissRejectedApproval';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import {
  approve,
  extensionEvidence,
  popupFor,
  settle,
  startRequest,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const FLAGGED = `0x${'22'.repeat(20)}`;
const SAFE = `0x${'33'.repeat(20)}`;
const CONTRACT = `0x${'44'.repeat(20)}`;
const REASON = 'Synthetic typed recipient advisory';
const MEW_ADDRESSES =
  'https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json';
const BLACKLIST_FEEDS = new Map<string, unknown>([
  [MEW_ADDRESSES, [{ address: FLAGGED, comment: REASON }]],
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

const publicState = (page: Page, origin: string) =>
  page.evaluate(async (host) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const saved = (await chrome.storage.local.get('state')).state;
    const { activeAccount: ref, activeNetwork } = state.vault;
    const grant = (value: any) => {
      const connection = value?.dapp?.dapps?.[host];
      return connection
        ? {
            accountId: connection.accountId,
            accountType: connection.accountType,
            chain: connection.chain,
          }
        : null;
    };
    const target = state.vaultGlobal.networks.ethereum[1];
    return {
      network: {
        chainId: activeNetwork.chainId,
        kind: activeNetwork.kind,
        url: activeNetwork.url,
      },
      account: {
        ...ref,
        address: state.vault.accounts[ref.type][ref.id].address,
      },
      target: target
        ? { chainId: target.chainId, kind: target.kind, label: target.label }
        : null,
      liveGrant: grant(state),
      savedGrant: grant(saved),
    };
  }, origin);

async function connect(wallet: PaliWallet, origin: string, method: string) {
  const dapp = await wallet.context.newPage();
  await dapp.goto(origin);
  await dapp.waitForFunction(() => Boolean((window as any).pali?.request));
  const response = await approve(
    wallet.context,
    dapp,
    await startRequest(dapp, method)
  );
  expect(response.error).toBeUndefined();
  expect(response.result).toHaveLength(1);
  return { dapp, address: response.result[0] as string };
}

async function reject(popup: Page, dapp: Page, id: number) {
  const response = await dismissRejectedApproval({
    click: () =>
      popup
        .getByRole('button', { name: en.buttons.cancel, exact: true })
        .click(),
    isClosed: () => popup.isClosed(),
    settle: () => settle(dapp, id),
  });
  expect(response.error?.code).toBe(4001);
  expect(response.result).toBeUndefined();
  return response;
}

test('cross-family switch preview uses the registered Ethereum target icon and Cancel preserves UTXO', async ({}, info) => {
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  const sourceSha256 = createHash('sha256')
    .update(fs.readFileSync(info.file))
    .digest('hex');
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'ApprovalPreviewSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  const observations: Record<string, unknown> = {};
  try {
    wallet = await PaliWallet.launch('cross-family-preview-identity', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    await wallet.step(
      'connect the disposable UTXO account normally',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
      }
    );
    const { dapp, address } = await connect(
      wallet,
      server.url,
      'sys_requestAccounts'
    );
    const before = await publicState(wallet.page, server.url);
    expect(before.network.kind).toBe('syscoin');
    expect(before.account.address).toBe(address);
    expect(before.target).toEqual({
      chainId: 1,
      kind: 'ethereum',
      label: 'Ethereum Mainnet',
    });
    const id = await startRequest(dapp, 'eth_changeUTXOEVM', [{ chainId: 1 }]);
    const popup = await popupFor(wallet.context, dapp, id);
    await wallet.step(
      'inspect the real registered target and reject the switch',
      async (capture) => {
        const destination = popup
          .locator('div.flex-col.pt-2')
          .filter({ hasText: en.settings.newChain });
        await expect(destination).toHaveCount(1);
        await expect(destination).toContainText('Ethereum Mainnet');
        await expect(
          destination.getByText('EVM', { exact: true })
        ).toBeVisible();
        // Exact path from the existing EthChainSvg asset; no golden changes or
        // replacement icon. Bitcoin's same-numeric-ID icon cannot satisfy it.
        await expect(
          destination.locator('svg path[fill="#627EEA"]')
        ).toHaveAttribute(
          'd',
          'M49.9999 99.9999C77.6141 99.9999 99.9999 77.6141 99.9999 49.9999C99.9999 22.3857 77.6141 0 49.9999 0C22.3857 0 0 22.3857 0 49.9999C0 77.6141 22.3857 99.9999 49.9999 99.9999Z'
        );
        await expect(
          popup.getByRole('button', { name: en.buttons.change, exact: true })
        ).toBeEnabled();
        await capture(popup);
        observations.rejection = await reject(popup, dapp, id);
        expect(await publicState(wallet!.page, server.url)).toEqual(before);
        observations.before = before;
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    expect(
      createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
    ).toBe(sourceSha256);
    status = 'passed';
  } finally {
    try {
      await info.attach('cross-family-preview-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          status,
          runtime,
          sourceSha256,
          observations,
          fixtureReads: routes?.reads,
          deniedWrites: routes?.deniedWrites,
          signingOrBroadcastRequested: false,
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

test('generic typed recipient uses the real blacklist advisory while the safe control stays clear', async ({}, info) => {
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  const sourceSha256 = createHash('sha256')
    .update(fs.readFileSync(info.file))
    .digest('hex');
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'TypedAdvisorySynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  const feedReads: string[] = [];
  const deniedFeedMethods: string[] = [];
  const observations: unknown[] = [];
  let restartedWorker:
    | Awaited<ReturnType<typeof verifyExecutingWorker>>
    | undefined;
  try {
    wallet = await PaliWallet.launch('typed-recipient-advisory', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    // Only these five real feed URLs are fulfilled. Every other network request
    // retains the existing fixture route or the launch-time refusing proxy.
    await wallet.context.route(
      (url) => BLACKLIST_FEEDS.has(url.href),
      async (route) => {
        const request = route.request();
        if (request.method() !== 'GET') {
          deniedFeedMethods.push(`${request.method()} ${request.url()}`);
          return route.abort('blockedbyclient');
        }
        feedReads.push(request.url());
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(BLACKLIST_FEEDS.get(request.url())),
        });
      }
    );
    await wallet.step(
      'restart the disposable worker under the installed feed routes',
      async () => {
        const cdp = await wallet!.context.newCDPSession(wallet!.page);
        try {
          const { targetInfos } = await cdp.send('Target.getTargets');
          const worker = targetInfos.find(
            (target) =>
              target.type === 'service_worker' &&
              target.url.startsWith(
                `chrome-extension://${wallet!.extensionId}/`
              )
          );
          expect(worker).toBeDefined();
          expect(
            (
              await cdp.send('Target.closeTarget', {
                targetId: worker!.targetId,
              })
            ).success
          ).toBe(true);
        } finally {
          await cdp.detach();
        }
        await wallet!.page.reload();
        await wallet!.waitAppReady();
        restartedWorker = await verifyExecutingWorker(
          wallet!.context,
          wallet!.extensionId,
          E2E_CONFIG.extensionPath,
          (identity) => wallet!.summary.setWorkerIdentity(identity)
        );
        expect(restartedWorker.actual.sha256).toBe(
          runtime.bundleHashes.background
        );
        await expect
          .poll(() => new Set(feedReads).size)
          .toBe(BLACKLIST_FEEDS.size);
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
        // Completed HTTP dispatch is not proof of cache ingestion. Observe the
        // real read-only controller result before testing the approval itself.
        await expect
          .poll(() =>
            wallet!.page.evaluate(async (address) => {
              const result = await chrome.runtime.sendMessage({
                type: 'CONTROLLER_ACTION',
                data: {
                  methods: ['wallet', 'checkAddressBlacklist'],
                  params: [address],
                },
              });
              if (result?.error) throw new Error('Blacklist read failed');
              return {
                isBlacklisted: result?.isBlacklisted,
                reason: result?.reason,
                severity: result?.severity,
              };
            }, FLAGGED)
          )
          .toEqual({ isBlacklisted: true, reason: REASON, severity: 'high' });
      }
    );
    const { dapp, address } = await connect(
      wallet,
      server.url,
      'eth_requestAccounts'
    );
    const before = await publicState(wallet.page, server.url);
    for (const recipient of [SAFE, FLAGGED]) {
      const flagged = recipient === FLAGGED;
      await wallet.step(
        flagged
          ? 'show the generic recipient advisory and reject signing'
          : 'keep the safe generic recipient clear and reject signing',
        async (capture) => {
          const data = {
            types: {
              EIP712Domain: [
                { name: 'name', type: 'string' },
                { name: 'version', type: 'string' },
                { name: 'chainId', type: 'uint256' },
                { name: 'verifyingContract', type: 'address' },
              ],
              Delivery: [{ name: 'recipient', type: 'address' }],
            },
            primaryType: 'Delivery',
            domain: {
              name: 'Synthetic Delivery',
              version: '1',
              chainId: 5700,
              verifyingContract: CONTRACT,
            },
            message: { recipient },
          };
          const id = await startRequest(dapp, 'eth_signTypedData_v4', [
            address,
            JSON.stringify(data),
          ]);
          const popup = await popupFor(wallet!.context, dapp, id);
          if (flagged) {
            const warning = popup.getByRole('dialog');
            await expect(warning).toBeVisible();
            await expect(warning).toContainText(REASON);
            await expect(warning).toContainText(FLAGGED);
            await expect(warning).toContainText(
              en.blacklist.typedDataAddressWarning.replace(
                '{{field}}',
                'recipient'
              )
            );
            await capture(popup);
            await warning.locator('#got-it-btn').click();
            await expect(warning).toBeHidden();
            await expect(
              popup.getByText('Recipient address', { exact: true })
            ).toBeVisible();
            await expect(
              popup.getByText(REASON, { exact: false })
            ).toBeVisible();
          } else {
            await expect(popup.getByRole('dialog')).toHaveCount(0);
            await expect(popup.getByText(REASON, { exact: true })).toHaveCount(
              0
            );
            await capture(popup);
          }
          await expect(
            popup.getByRole('heading', {
              name: en.send.signTypedData,
              exact: true,
            })
          ).toBeVisible();
          await expect(
            popup.getByRole('button', { name: en.buttons.confirm, exact: true })
          ).toBeEnabled();
          const response = await reject(popup, dapp, id);
          expect(await publicState(wallet!.page, server.url)).toEqual(before);
          observations.push({ recipient, flagged, response });
        }
      );
    }
    expect(routes.deniedWrites).toEqual([]);
    expect(deniedFeedMethods).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    expect(
      createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
    ).toBe(sourceSha256);
    status = 'passed';
  } finally {
    try {
      await info.attach('typed-recipient-advisory-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          status,
          runtime,
          sourceSha256,
          observations,
          restartedWorker,
          feedReads,
          deniedFeedMethods,
          fixtureReads: routes?.reads,
          deniedWrites: routes?.deniedWrites,
          controllerStateReplaced: false,
          controllerResultsReplaced: false,
          signingOrBroadcastRequested: false,
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
