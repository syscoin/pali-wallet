import { expect, test, type Page } from '@playwright/test';
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
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const PADDED_LABEL = '  Family savings  ';

async function publicAccounts(page: Page) {
  return page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const key = `state-vault-${state.vaultGlobal.activeSlip44}`;
    const saved = (await chrome.storage.local.get(key))[key];
    const project = (accounts: any) =>
      Object.fromEntries(
        ['HDAccount', 'Imported'].map((type) => [
          type,
          Object.values(accounts[type] || {})
            .filter((account: any) => account?.address)
            .map((account: any) => ({
              id: account.id,
              label: account.label,
              address: account.address,
              xpub: account.xpub,
              watchOnly: type === 'Imported' && !account.xprv,
            }))
            .sort((a, b) => a.id - b.id),
        ])
      );
    return {
      active: state.vault.activeAccount,
      slip44: state.vaultGlobal.activeSlip44,
      live: project(state.vault.accounts),
      saved: project(saved.accounts),
    };
  });
}

test('optional account names use native defaults without trimming meaningful names', async ({}, info) => {
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  const sourceHash = createHash('sha256')
    .update(fs.readFileSync(info.file))
    .digest('hex');
  const fixture = createIsolatedVaultFixture();
  // Derive only public fixture identifiers from the committed disposable seed.
  // No private key import, reveal, signing or broadcast operation is requested.
  const signer = new sys.HDSigner(UTXO_FIXTURE_SEED, '', true);
  const derived = [1, 2, 3].map((id) => {
    signer.createAccountAtIndex(id, 84);
    return {
      id,
      address: sys.bitcoinjs.payments.p2wpkh({
        pubkey: signer.deriveKeypair(`m/84'/1'/${id}'/0/0`).publicKey,
        network: sys.syscoinNetworks.testnet,
      }).address!,
      xpub: signer.getAccountXpub(),
    };
  });
  expect(derived[0]).toMatchObject(fixture.secondUtxo);
  const watchAddresses = [0x22, 0x33, 0x44].map(
    (value) =>
      sys.bitcoinjs.payments.p2wpkh({
        hash: Buffer.alloc(20, value),
        network: sys.syscoinNetworks.testnet,
      }).address!
  );
  expect(
    new Set([...derived.map((a) => a.address), ...watchAddresses]).size
  ).toBe(6);
  const allowed = new Set([
    ...derived.flatMap((a) => [a.address, a.xpub]),
    ...watchAddresses,
  ]);
  const reads: string[] = [],
    denied: string[] = [],
    forbiddenRequests: string[] = [];
  const observations: Record<string, unknown> = {};
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'OptionalLabelSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('account-entry-optional-label', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    await wallet.context.route('**/*', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (
        ![
          'https://blockbook-dev.syscoin.org',
          'https://explorer-blockbook-dev.syscoin.org',
        ].includes(url.origin)
      )
        return route.fallback();
      const match = url.pathname.match(
        /^\/api\/v2\/(xpub|address|utxo)\/([^/]+)$/
      );
      if (!match || !allowed.has(decodeURIComponent(match[2])))
        return route.fallback();
      if (request.method() !== 'GET') {
        denied.push(request.method() + ' ' + request.url());
        return route.abort('blockedbyclient');
      }
      reads.push(request.url());
      const body =
        match[1] === 'utxo'
          ? []
          : {
              address: decodeURIComponent(match[2]),
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
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(body),
      });
    });
    wallet.context.on('request', (request) => {
      if (/\/sendtx(?:\/|$)/i.test(request.url()))
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
        /* Ordinary GET requests have no JSON body. */
      }
    });
    const page = wallet.page;
    const open = async (action: string) => {
      await wallet!.ensureOnHome();
      await page
        .getByRole('button', {
          name: en.generalMenu.generalOptions,
          exact: true,
        })
        .click();
      await page.getByRole('menuitem', { name: action, exact: true }).click();
    };
    const assertAddition = async (
      before: Awaited<ReturnType<typeof publicAccounts>>,
      type: 'HDAccount' | 'Imported',
      expected: {
        address: string;
        id: number;
        label: string;
        watchOnly: boolean;
        xpub: string;
      }
    ) => {
      const after = await publicAccounts(page);
      expect(after.slip44).toBe(1);
      expect(after.active).toEqual({ id: expected.id, type });
      expect(after.live).toEqual(after.saved);
      expect(after.live[type]).toEqual([...before.live[type], expected]);
      const other = type === 'HDAccount' ? 'Imported' : 'HDAccount';
      expect(after.live[other]).toEqual(before.live[other]);
      return after;
    };
    const assertManagerTargets = async (
      state: Awaited<ReturnType<typeof publicAccounts>>
    ) => {
      await open(en.accountMenu.manageAccounts);
      await expect(page).toHaveURL(/#\/settings\/manage-accounts$/);
      const list = page.locator(
        '[data-navigation-scroll="settings-manage-accounts"]'
      );
      const expected = [...state.live.HDAccount, ...state.live.Imported]
        .map(
          (account) =>
            `${en.buttons.edit}: ${account.label} (${account.address})`
        )
        .sort();
      const readNames = () =>
        list.locator('button').evaluateAll(
          (buttons, prefix) =>
            buttons
              .map((button) => button.getAttribute('aria-label') || '')
              .filter((name) => name.startsWith(prefix))
              .sort(),
          `${en.buttons.edit}: `
        );
      await expect.poll(readNames).toEqual(expected);
      expect(await publicAccounts(page)).toEqual(state);
      return readNames();
    };
    await wallet.step(
      'optional-name setup retains the original default account',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        const before = await publicAccounts(page);
        expect(before.active).toEqual({ id: 0, type: 'HDAccount' });
        expect(before.live).toEqual(before.saved);
        expect(before.live.HDAccount).toHaveLength(1);
        expect(before.live.HDAccount[0].label).toBe('SYS-T 1');
        expect(before.live.Imported).toEqual([]);
        observations.before = before;
      }
    );
    const createCases = [
      { name: 'omitted', input: undefined, label: 'SYS-T 2' },
      { name: 'spaces', input: '   ', label: 'SYS-T 3' },
      { name: 'padded', input: PADDED_LABEL, label: PADDED_LABEL },
    ];
    for (const [index, scenario] of createCases.entries()) {
      await wallet.step(
        `ordinary-create ${scenario.name} keeps the exact native account name`,
        async () => {
          const before = await publicAccounts(page);
          await open(en.accountMenu.createNewAccount);
          await expect(page).toHaveURL(/#\/settings\/account\/new$/);
          if (scenario.input !== undefined)
            await page.locator('#account-name-input').fill(scenario.input);
          await page.locator('#create-btn').click();
          await expect(page.getByRole('dialog')).toBeVisible();
          const expected = {
            ...derived[index],
            label: scenario.label,
            watchOnly: false,
          };
          const accepted = await assertAddition(before, 'HDAccount', expected);
          observations[`create-${scenario.name}`] = accepted;
          await page
            .getByRole('button', { name: en.buttons.ok, exact: true })
            .click();
          observations[`ui-create-${scenario.name}`] =
            await assertManagerTargets(accepted);
        }
      );
    }
    for (const [index, scenario] of [
      { name: 'spaces', input: '   ', label: 'Watch-only 1' },
      { name: 'nbsp', input: '\u00a0\u00a0', label: 'Watch-only 2' },
      { name: 'padded', input: PADDED_LABEL, label: PADDED_LABEL },
    ].entries()) {
      await wallet.step(
        `watch-import ${scenario.name} keeps the exact native account name`,
        async () => {
          const before = await publicAccounts(page);
          await open(en.accountMenu.importAccount);
          await expect(page).toHaveURL(/#\/settings\/account\/import$/);
          await page.locator('#account-name-input').fill(scenario.input);
          await page
            .getByRole('checkbox', { name: 'Watch-only', exact: true })
            .check();
          await page
            .locator('#import-account-identifier')
            .fill(watchAddresses[index]);
          const submit = page.getByRole('button', {
            name: en.buttons.import,
            exact: true,
          });
          await expect(submit).toBeEnabled();
          await submit.click();
          await expect(
            page.getByText(en.settings.accountImported, { exact: true })
          ).toBeVisible();
          const expected = {
            id: index,
            label: scenario.label,
            address: watchAddresses[index],
            xpub: watchAddresses[index],
            watchOnly: true,
          };
          const accepted = await assertAddition(before, 'Imported', expected);
          observations[`watch-${scenario.name}`] = accepted;
          await page
            .getByRole('button', { name: en.buttons.ok, exact: true })
            .click();
          observations[`ui-watch-${scenario.name}`] =
            await assertManagerTargets(accepted);
        }
      );
    }
    observations.worker = await verifyExecutingWorker(
      wallet.context,
      wallet.extensionId,
      E2E_CONFIG.extensionPath,
      () => undefined
    );
    expect(extensionEvidence()).toEqual(runtime);
    expect(
      createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
    ).toBe(sourceHash);
    expect(routes.deniedWrites).toEqual([]);
    expect(denied).toEqual([]);
    expect(forbiddenRequests).toEqual([]);
    expect(reads.some((url) => url.includes('/address/'))).toBe(true);
    status = 'passed';
  } finally {
    try {
      await info.attach('account-entry-optional-label-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          status,
          runtime,
          sourceHash,
          observations,
          derived,
          watchAddresses,
          reads,
          denied,
          forbiddenRequests,
          fixtureReads: routes?.reads ?? [],
          fixtureDeniedWrites: routes?.deniedWrites ?? [],
          proxyDeniedConnections: server.blocked.length,
          controllerStateReplaced: false,
          controllerResultsReplaced: false,
          chromeApiReplaced: false,
          privateKeyImportOrRevealRequested: false,
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
