import { expect, test } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

for (const action of ['cancel', 'save'] as const) {
  test(`Sentry trusted-service ${action} preserves only the explicitly saved policy when reopening`, async ({}, info) => {
    test.setTimeout(120_000);
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
    expect(E2E_CONFIG.extensionPath).toBe(
      process.env.PALI_TEST_DAPP_EXTENSION_PATH
    );
    const previous = { ...E2E_CONFIG };
    const runtime = extensionEvidence();
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'SentrySettingsSyntheticOnly!2026',
      chainId: 5700,
      networkLabel: 'Syscoin Testnet',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installUtxoFixtureRoutes>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    const observations: Record<string, unknown> = {};
    const draft = {
      serviceUrl: 'https://saved-settings.invalid',
      maxFeeSatoshis: '250000',
    };
    try {
      wallet = await PaliWallet.launch(`sentry-settings-draft-${action}`, {
        offlineHttpProxy: server.url,
        viewport: { width: 400, height: 620 },
      });
      routes = await installUtxoFixtureRoutes(
        wallet.context,
        createUtxoFixture(),
        server.url
      );
      observations.workerIdentity = await verifyExecutingWorker(
        wallet.context,
        wallet.extensionId,
        E2E_CONFIG.extensionPath,
        (identity) => {
          observations.workerIdentity = identity;
        }
      );
      const page = wallet.page;
      const service = page.getByRole('button', {
        name: en.sentry.trustedDataService,
        exact: true,
      });
      const url = page.getByLabel(en.sentry.trustedHTTPSServiceOrigin, {
        exact: true,
      });
      const fee = page.getByLabel(en.sentry.maximumTransactionFeeSatoshis, {
        exact: true,
      });
      let initial!: { maxFeeSatoshis: string; serviceUrl: string };
      await wallet.step(
        `${action}: open real testnet Sentry settings in a fresh fenced wallet`,
        async (capture) => {
          try {
            await wallet!.importSeedAndCreatePassword();
            await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
            await wallet!.ensureOnHome();
            await wallet!.gotoRoute('#/settings/sentry');
            await expect(
              page.getByText(en.sentry.noSentryKeysImportedOnThisNetwork, {
                exact: true,
              })
            ).toBeVisible();
            await service.click();
            initial = {
              serviceUrl: await url.inputValue(),
              maxFeeSatoshis: await fee.inputValue(),
            };
            observations.initial = initial;
            await url.fill(draft.serviceUrl);
            await fee.fill(draft.maxFeeSatoshis);
          } finally {
            if (!page.isClosed()) await capture(page);
          }
        }
      );
      await wallet.step(
        `${action} the service draft through ordinary UI and reopen its real settings`,
        async (capture) => {
          try {
            if (action === 'save') {
              await page
                .getByLabel(en.sentry.walletPassword, { exact: true })
                .fill(E2E_CONFIG.password);
              await page
                .getByRole('button', { name: en.buttons.save, exact: true })
                .click();
              await expect(
                page.getByText(en.sentry.trustedServiceSettingsSaved, {
                  exact: true,
                })
              ).toBeVisible();
            } else {
              await page
                .getByRole('button', { name: en.buttons.cancel, exact: true })
                .click();
            }
            await service.click();
            const reopened = {
              serviceUrl: await url.inputValue(),
              maxFeeSatoshis: await fee.inputValue(),
            };
            observations.reopened = reopened;
            expect(reopened).toEqual(action === 'save' ? draft : initial);
            if (action === 'save') {
              await page.reload();
              await service.click();
              const persisted = {
                serviceUrl: await url.inputValue(),
                maxFeeSatoshis: await fee.inputValue(),
              };
              observations.afterReload = persisted;
              expect(persisted).toEqual(draft);
            }
            expect(routes!.deniedWrites).toEqual([]);
          } finally {
            if (!page.isClosed()) await capture(page);
          }
        }
      );
      status = 'passed';
    } finally {
      try {
        await info.attach('sentry-settings-draft-evidence', {
          body: JSON.stringify(
            {
              ...runtime,
              action,
              status,
              testSourceSha256: createHash('sha256')
                .update(fs.readFileSync(__filename))
                .digest('hex'),
              controllerStateReplaced: false,
              controllerResultsReplaced: false,
              signingOrBroadcastRequested: false,
              settingsWriteThroughNormalUI: action === 'save',
              initialReadFailureBrowserClaim: false,
              observations,
              deniedWrites: routes?.deniedWrites || [],
              proxyDeniedConnections: server.blocked.length,
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
          await server.close();
          Object.assign(E2E_CONFIG, previous);
        }
      }
    }
  });
}
