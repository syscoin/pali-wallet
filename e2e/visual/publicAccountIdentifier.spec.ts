import { expect, test, type Locator, type Page } from '@playwright/test';
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

const BACKENDS = new Set([
  'https://blockbook-dev.syscoin.org',
  'https://explorer-blockbook-dev.syscoin.org',
]);
const SIGNING_LABEL = 'Public fixture WIF account';
const WATCH_LABEL = 'Public fixture address account';

// Project only public identity and a capability boolean. Never return encrypted
// or decrypted private material from the real background controller.
const publicSelection = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const ref = state.vault.activeAccount;
    const account = state.vault.accounts[ref.type][ref.id];
    return {
      ref,
      account: {
        label: account.label,
        address: account.address,
        xpub: account.xpub,
        isImported: !!account.isImported,
        hasSigningKey: !!account.xprv,
      },
      network: {
        kind: state.vault.activeNetwork.kind,
        chainId: state.vault.activeNetwork.chainId,
        url: state.vault.activeNetwork.url,
      },
      switching: !!state.vaultGlobal.isSwitchingAccount,
    };
  });

async function visibleCopyBounds(copy: Locator) {
  await copy.scrollIntoViewIfNeeded();
  return copy.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2
    );
    return {
      x: rect.x,
      y: rect.y,
      right: rect.right,
      bottom: rect.bottom,
      width: innerWidth,
      height: innerHeight,
      receivesPointer: !!hit && element.contains(hit),
    };
  });
}

test('Your Keys distinguishes a signing WIF public address from an HD xpub without bypassing authentication', async ({}, info) => {
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
  const sourceHash = () =>
    createHash('sha256').update(fs.readFileSync(info.file)).digest('hex');
  const sourceSha256 = sourceHash();
  const previous = { ...E2E_CONFIG };
  const fixture = createIsolatedVaultFixture();
  // Disposable key derived only from the already-public harness mnemonic.
  // It is imported normally but never used to sign, decrypt or broadcast.
  const signer = new sys.HDSigner(UTXO_FIXTURE_SEED, '', true);
  const key = signer.deriveKeypair("m/84'/1'/7'/0/0");
  const signingAddress = sys.bitcoinjs.payments.p2wpkh({
    pubkey: key.publicKey,
    network: sys.syscoinNetworks.testnet,
  }).address!;
  const allowedCopies = [
    fixture.utxo.userXpub,
    signingAddress,
    fixture.watchAddress,
  ];
  const observations: Record<string, unknown> = {};
  const signingReads: Array<{ details: string | null; kind: string }> = [];
  const forbiddenRequests: string[] = [];
  let server: Awaited<ReturnType<typeof startUtxoFixtureServer>> | undefined;
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'PublicIdentifierSynthetic!2026',
      chainId: 5700,
      networkLabel: 'Syscoin Testnet',
      rpcUrl: server.url,
    });
    wallet = await PaliWallet.launch('public-account-identifier', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
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
        // Ordinary read-only REST requests have no JSON request body.
      }
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    // Only this extra synthetic account's public Blockbook reads are added.
    // All other traffic still passes through the existing launch-time fence.
    await wallet.context.route(
      (url) =>
        BACKENDS.has(url.origin) &&
        /^\/api\/v2\/(?:xpub|address|utxo)\//.test(url.pathname),
      async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const match = url.pathname.match(
          /^\/api\/v2\/(xpub|address|utxo)\/(.+)$/
        );
        if (
          request.method() !== 'GET' ||
          !match ||
          decodeURIComponent(match[2]) !== signingAddress
        )
          return route.fallback();
        const details = url.searchParams.get('details');
        signingReads.push({ kind: match[1], details });
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify(
            match[1] === 'utxo'
              ? []
              : {
                  address: signingAddress,
                  balance: '0',
                  unconfirmedBalance: '0',
                  totalReceived: '0',
                  totalSent: '0',
                  txs: 0,
                  unconfirmedTxs: 0,
                  usedTokens: 0,
                  tokens: [],
                  tokensAsset: [],
                  ...(details?.startsWith('txs') ? { transactions: [] } : {}),
                }
          ),
        });
      }
    );
    const page = wallet.page;
    const observePublicCopy = (allowed: string[]) => {
      const original = navigator.clipboard.writeText.bind(navigator.clipboard);
      const audit = { copies: [] as string[], unexpectedValues: 0 };
      (window as any).__publicIdentifierCopies = audit;
      navigator.clipboard.writeText = async (text) => {
        await original(text);
        if (allowed.includes(text)) audit.copies.push(text);
        else audit.unexpectedValues++;
      };
    };
    // This wrapper observes the native clipboard's completed result, never
    // substitutes it. Unexpected content is counted, never retained in artifacts.
    await wallet.context.addInitScript(observePublicCopy, allowedCopies);
    await page.evaluate(observePublicCopy, allowedCopies);
    const step = (name: string, action: () => Promise<void>) =>
      wallet!.step(name, async (capture) => {
        await action();
        await capture(page);
      });
    const openMenuItem = async (name: string) => {
      await expect(page).toHaveURL(/#\/home$/);
      await page
        .getByRole('button', {
          name: en.generalMenu.generalOptions,
          exact: true,
        })
        .click();
      await page.getByRole('menuitem', { name, exact: true }).click();
    };
    const backHome = async () => {
      await page
        .getByRole('button', { name: en.buttons.back, exact: true })
        .click();
      await expect(page).toHaveURL(/#\/home$/);
    };
    const expectPublicView = async (
      identifier: string,
      addressView: boolean,
      signing: boolean
    ) => {
      await expect(page).toHaveURL(/#\/settings\/account\/private-key$/);
      const label = addressView
        ? en.settings.yourPublicAddress
        : en.settings.yourXpub;
      await expect(page.getByText(label, { exact: true })).toBeVisible();
      await expect(
        page.getByText(
          addressView ? en.settings.yourXpub : en.settings.yourPublicAddress,
          { exact: true }
        )
      ).toHaveCount(0);
      await expect(page.getByTitle(identifier, { exact: true })).toBeVisible();
      await expect(
        page.getByText(en.settings.itIsntAReceivingAddress, { exact: false })
      ).toHaveCount(addressView ? 0 : 1);
      const password = page.getByPlaceholder(en.settings.enterYourPassword, {
        exact: true,
      });
      await expect(password).toHaveCount(signing ? 1 : 0);
      if (signing) {
        await expect(password).toHaveAttribute('type', 'password');
        await expect(password).toHaveValue('');
      }
      await expect(
        page.getByRole('button', { name: /^(Show|Hide)$/ })
      ).toHaveCount(0);
      await expect(
        page.getByText(en.settings.watchOnlyNoPrivateKey, { exact: true })
      ).toHaveCount(signing ? 0 : 1);
      const link = page.getByRole('link', {
        name: en.settings.seeOnExplorer,
        exact: true,
      });
      const href = await link.getAttribute('href');
      expect(href).not.toBeNull();
      const state = await publicSelection(page);
      const expectedUrl = new URL(
        `${state.network.url}/${
          addressView ? 'address' : 'xpub'
        }/${encodeURIComponent(identifier)}`
      );
      expect(new URL(href!).href).toBe(expectedUrl.href);
      expect(state.account.hasSigningKey).toBe(signing);
      return {
        label,
        href,
        identifier,
        passwordPresent: signing,
        passwordEmpty: signing ? (await password.inputValue()) === '' : null,
        state,
      };
    };
    const copyIdentifier = async (identifier: string, keyboard: boolean) => {
      const label =
        identifier === fixture.utxo.userXpub
          ? en.settings.yourXpub
          : en.settings.yourPublicAddress;
      const copy = page.getByRole('button', {
        name: `${en.buttons.copy} ${label}`,
        exact: true,
      });
      await expect(copy).toBeEnabled();
      if (keyboard) {
        // Native backward Tab traversal starts at the untouched password field.
        await page.getByPlaceholder(en.settings.enterYourPassword).click();
        for (let attempt = 0; attempt < 20; attempt++) {
          await page.keyboard.press('Shift+Tab');
          if (
            await copy.evaluate((element) => element === document.activeElement)
          )
            break;
        }
        await expect(copy).toBeFocused();
      }
      const bounds = await visibleCopyBounds(copy);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(bounds.width);
      expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
      expect(bounds.receivesPointer).toBe(true);
      const before = await page.evaluate(
        () => (window as any).__publicIdentifierCopies.copies.length
      );
      if (keyboard) await page.keyboard.press('Enter');
      else await copy.click();
      await expect
        .poll(() =>
          page.evaluate(() => (window as any).__publicIdentifierCopies.copies)
        )
        .toHaveLength(before + 1);
      expect(
        await page.evaluate(() =>
          (window as any).__publicIdentifierCopies.copies.at(-1)
        )
      ).toBe(identifier);
      return { keyboard, bounds, copiedPublicIdentifier: identifier };
    };
    const importAccount = async (watchOnly: boolean) => {
      await openMenuItem(en.accountMenu.importAccount);
      await expect(page).toHaveURL(/#\/settings\/account\/import$/);
      await page
        .locator('#account-name-input')
        .fill(watchOnly ? WATCH_LABEL : SIGNING_LABEL);
      const watchToggle = page.locator('#import-account-watch-only');
      if (watchOnly) await watchToggle.check();
      else await expect(watchToggle).not.toBeChecked();
      const input = page.locator('#import-account-identifier');
      if (!watchOnly) await expect(input).toHaveAttribute('type', 'password');
      await input.fill(watchOnly ? fixture.watchAddress : key.toWIF());
      const submit = page.getByRole('button', {
        name: en.buttons.import,
        exact: true,
      });
      await expect(submit).toBeEnabled();
      await submit.click();
      await expect(
        page.getByText(en.settings.accountImported, { exact: true })
      ).toBeVisible();
      await page
        .getByRole('button', { name: en.buttons.ok, exact: true })
        .click();
      await wallet!.ensureOnHome();
      const expectedAddress = watchOnly ? fixture.watchAddress : signingAddress;
      await expect
        .poll(() => publicSelection(page))
        .toMatchObject({
          ref: { type: 'Imported' },
          account: {
            label: watchOnly ? WATCH_LABEL : SIGNING_LABEL,
            address: expectedAddress,
            xpub: expectedAddress,
            isImported: true,
            hasSigningKey: !watchOnly,
          },
          switching: false,
          network: { kind: 'syscoin', chainId: 5700 },
        });
      return publicSelection(page);
    };

    await step(
      'onboard a disposable HD account through ordinary UI',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        await expect
          .poll(() => publicSelection(page))
          .toMatchObject({
            ref: { type: 'HDAccount', id: 0 },
            account: { xpub: fixture.utxo.userXpub, isImported: false },
            network: { kind: 'syscoin', chainId: 5700 },
            switching: false,
          });
        observations.hdAccount = await publicSelection(page);
      }
    );
    const worker = wallet.context.serviceWorkers()[0];
    expect(worker).toBeDefined();
    // Additive observation only: no response, method, result or state replaced.
    // Store method names only, never import parameters or exported values.
    await worker.evaluate(() => {
      const methods: string[] = [];
      (globalThis as any).__publicIdentifierSecretRequests = methods;
      chrome.runtime.onMessage.addListener((message) => {
        if (message?.type !== 'CONTROLLER_ACTION') return;
        const methodPath: unknown = message.data?.methods;
        if (
          Array.isArray(methodPath) &&
          methodPath.some(
            (part) =>
              typeof part === 'string' &&
              /^(getPrivateKeyByAccountId|getSeed|exportPrivateKey|exportSeed|decrypt.*|sign.*)$/i.test(
                part
              )
          )
        )
          methods.push(methodPath.join('.'));
      });
    });
    await step(
      'HD public xpub keeps its indexer warning and authentication',
      async () => {
        await openMenuItem(en.accountMenu.yourKeys);
        observations.hdView = await expectPublicView(
          fixture.utxo.userXpub,
          false,
          true
        );
        observations.hdCopy = await copyIdentifier(
          fixture.utxo.userXpub,
          false
        );
        observations.hdImage = await wallet!.shot('hd-public-xpub');
        await backHome();
      }
    );
    await step(
      'import a disposable WIF through the normal account form',
      async () => {
        observations.signingImport = await importAccount(false);
      }
    );
    await step(
      'signing import shows its public address while retaining password authentication',
      async () => {
        await openMenuItem(en.accountMenu.yourKeys);
        observations.signing400 = await expectPublicView(
          signingAddress,
          true,
          true
        );
        observations.signingCopy400 = await copyIdentifier(
          signingAddress,
          false
        );
      }
    );
    await step(
      'narrow-window native keyboard copies only the signing account public address',
      async () => {
        await page.setViewportSize({ width: 320, height: 600 });
        observations.signing320 = await expectPublicView(
          signingAddress,
          true,
          true
        );
        observations.signingCopy320 = await copyIdentifier(
          signingAddress,
          true
        );
        observations.signing320Image = await wallet!.shot(
          'signing-public-address-320'
        );
        await backHome();
        expect(await publicSelection(page)).toEqual(observations.signingImport);
      }
    );
    await step(
      'import an ordinary watch address without signing capability',
      async () => {
        await page.setViewportSize({ width: 400, height: 620 });
        observations.watchImport = await importAccount(true);
      }
    );
    await step(
      'watch address keeps the same public view without a private-key password',
      async () => {
        await openMenuItem(en.accountMenu.yourKeys);
        observations.watchView = await expectPublicView(
          fixture.watchAddress,
          true,
          false
        );
        observations.watchCopy = await copyIdentifier(
          fixture.watchAddress,
          false
        );
        observations.watchImage = await wallet!.shot('watch-public-address');
        await backHome();
        expect(await publicSelection(page)).toEqual(observations.watchImport);
      }
    );
    observations.clipboard = await page.evaluate(
      () => (window as any).__publicIdentifierCopies
    );
    expect(observations.clipboard).toEqual({
      copies: [
        fixture.utxo.userXpub,
        signingAddress,
        signingAddress,
        fixture.watchAddress,
      ],
      unexpectedValues: 0,
    });
    observations.secretRequests = await worker.evaluate(
      () => (globalThis as any).__publicIdentifierSecretRequests
    );
    expect(observations.secretRequests).toEqual([]);
    expect(signingReads.length).toBeGreaterThan(0);
    expect(routes.reads.length).toBeGreaterThan(0);
    expect(routes.deniedWrites).toEqual([]);
    expect(forbiddenRequests).toEqual([]);
    observations.worker = await verifyExecutingWorker(
      wallet.context,
      wallet.extensionId,
      E2E_CONFIG.extensionPath,
      (value) => {
        observations.worker = value;
      }
    );
    expect(extensionEvidence()).toEqual(runtime);
    expect(sourceHash()).toBe(sourceSha256);
    if (info.errors.length === 0) status = 'passed';
  } finally {
    try {
      await info.attach('public-account-identifier-evidence', {
        contentType: 'application/json',
        body: Buffer.from(
          JSON.stringify(
            {
              status,
              runtime,
              finalRuntime: extensionEvidence(),
              sourceSha256,
              finalSourceSha256: sourceHash(),
              signingAddress,
              observations,
              signingReads,
              fixtureReads: routes?.reads,
              deniedWrites: routes?.deniedWrites,
              forbiddenRequests,
              proxyBlocked: server?.blocked,
              controllerOrStoreReplaced: false,
              privateKeysRevealedOrExported: false,
              signaturesOrBroadcastsRequested: false,
            },
            null,
            2
          )
        ),
      });
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
});
