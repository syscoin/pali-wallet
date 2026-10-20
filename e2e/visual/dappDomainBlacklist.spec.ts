import { expect, test } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { clickClosingPopup } from '../harness/dismissRejectedApproval';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import {
  extensionEvidence,
  popupFor,
  rpcObservation,
  settle,
  startRequest,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('listed hostnames remain blocked across ports and terminal DNS dots', async ({}, info) => {
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'DomainBlacklistSynthetic!2026',
    rpcUrl: server.url,
  });
  const safe = [
    'https://ordinary.synthetic.invalid:8443',
    'https://metmask.com.attacker.synthetic.invalid:8443',
  ];
  // This domain is a built-in local blacklist entry, not remote feed state.
  // Every document below is fulfilled with our local fixture HTML. The
  // launch-time deny proxy prevents any request reaching these public hosts.
  const blocked = [
    'https://metmask.com',
    'https://metmask.com:8443',
    'https://metmask.com.',
    'https://metmask.com.:8443',
    'https://sub.metmask.com:8443',
  ];
  const observations: unknown[] = [];
  const deniedWrites: string[] = [];
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    const html = await (await fetch(server.url)).text();
    wallet = await PaliWallet.launch('dapp-domain-blacklist', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    await wallet.context.route(
      (url) => [...safe, ...blocked].includes(url.origin),
      (route) => {
        if (route.request().method() !== 'GET') {
          deniedWrites.push(route.request().method());
          return route.abort('blockedbyclient');
        }
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: html,
        });
      }
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.switchNetwork('Syscoin NEVM Testnet', 'EVM');
    await wallet.ensureOnHome();
    for (const origin of safe) {
      await wallet.step(
        `safe origin reaches ordinary consent: ${origin}`,
        async () => {
          const dapp = await wallet!.context.newPage();
          await dapp.goto(origin);
          await dapp.waitForFunction(() =>
            Boolean((window as any).pali?.request)
          );
          const id = await startRequest(dapp, 'wallet_watchAsset', [
            {
              type: 'ERC20',
              options: { address: `0x${'ab'.repeat(20)}`, decimals: 18 },
            },
          ]);
          const popup = await popupFor(wallet!.context, dapp, id);
          const cancel = popup.getByRole('button', {
            name: en.buttons.cancel,
            exact: true,
          });
          await expect(cancel).toBeEnabled();
          await clickClosingPopup({
            click: () => cancel.click(),
            isClosed: () => popup.isClosed(),
          });
          const result = await settle(dapp, id);
          // connectionMiddleware maps cancelled Connect to unauthorized,
          // distinct from its hostname-block message and no-popup path.
          expect(result.error?.code).toBe(4100);
          expect(result.error?.message).toBe('Connection required');
          observations.push({
            origin,
            error: result.error,
            ordinaryConsent: true,
          });
          await dapp.close();
        }
      );
    }
    for (const origin of blocked) {
      await wallet.step(
        `deny listed hostname before consent: ${origin}`,
        async () => {
          const dapp = await wallet!.context.newPage();
          await dapp.goto(origin);
          await dapp.waitForFunction(() =>
            Boolean((window as any).pali?.request)
          );
          const pages = new Set(wallet!.context.pages());
          const id = await startRequest(dapp, 'wallet_watchAsset', [
            {
              type: 'ERC20',
              options: { address: `0x${'ab'.repeat(20)}`, decimals: 18 },
            },
          ]);
          await expect
            .poll(
              async () =>
                (await rpcObservation(dapp, id)).settled ||
                wallet!.context.pages().some((page) => !pages.has(page))
            )
            .toBe(true);
          expect(
            wallet!.context.pages().filter((page) => !pages.has(page))
          ).toEqual([]);
          const result = await settle(dapp, id);
          expect(result.error?.code).toBe(4100);
          expect(result.error?.message).toContain('Connection blocked:');
          expect(result.result).toBeUndefined();
          observations.push({
            origin,
            error: result.error,
            approvalOpened: false,
          });
          await dapp.close();
        }
      );
    }
    expect(deniedWrites).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    status = 'passed';
  } finally {
    try {
      await info.attach('domain-blacklist-admission-evidence', {
        body: JSON.stringify(
          {
            ...extensionEvidence(),
            testSourceSha256: createHash('sha256')
              .update(fs.readFileSync(__filename))
              .digest('hex'),
            syntheticDocumentsOnly: true,
            controllerStateReplaced: false,
            controllerResultsReplaced: false,
            noSigningApproved: true,
            observations,
            deniedWrites: [...deniedWrites, ...(routes?.deniedWrites || [])],
            proxyDeniedConnections: server.blocked.length,
            status,
          },
          null,
          2
        ),
        contentType: 'application/json',
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
