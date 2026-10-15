import { expect, test } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import packageJson from '../../package.json';
import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { waitForFixtureInterception } from '../harness/fixtureReadiness';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('offline cold browser restart stays locked and unlocks the same synthetic account', async () => {
  test.setTimeout(180000);
  const extensionPath = process.env.PALI_TEST_DAPP_EXTENSION_PATH;
  if (!extensionPath || !path.isAbsolute(extensionPath))
    throw new Error('Pin the exact built extension');
  if (!/^[a-f0-9]{40}$/i.test(process.env.PALI_TEST_DAPP_REVISION || ''))
    throw new Error('Pin the exact built source revision');
  const evidence = extensionEvidence();
  expect(evidence.version).toBe(packageJson.version);
  const before = { ...E2E_CONFIG };
  const fixture = createUtxoFixture();
  const server = await startUtxoFixtureServer();
  const password = 'OfflineColdRestartOnly!2026';
  Object.assign(E2E_CONFIG, {
    extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password,
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
    rpcUrl: server.url,
  });
  const observations: Array<
    Awaited<ReturnType<typeof installUtxoFixtureRoutes>>
  > = [];
  let wallet: PaliWallet | undefined;
  try {
    wallet = await PaliWallet.launch('offline-cold-restart-before', {
      offlineHttpProxy: server.url,
    });
    observations.push(
      await installUtxoFixtureRoutes(wallet.context, fixture, server.url)
    );
    const sameAccount = async () => {
      await expect(wallet!.page).toHaveURL(/#\/home$/, { timeout: 30000 });
      await wallet!.ensureOnHome();
      await expect(wallet!.page.locator('#home-balance')).toHaveText('0.001');
      await wallet!.gotoRoute('#/receive');
      await expect(wallet!.page.locator('#qr-code')).toBeVisible();
      await expect(
        wallet!.page.getByText(fixture.userAddress, { exact: true })
      ).toBeVisible();
      await wallet!.gotoRoute('#/home');
    };
    const locked = async () => {
      await expect(wallet!.page.locator('#password')).toBeVisible();
      await expect(wallet!.page.locator('#unlock-btn')).toBeVisible();
      await expect(wallet!.page.locator('#home-balance')).toHaveCount(0);
    };
    const wrongPassword = async () => {
      await wallet!.page.locator('#password').fill('WrongColdRestartOnly!2026');
      await wallet!.page.locator('#unlock-btn').click();
      await expect(
        wallet!.page
          .locator('#login')
          .getByText('Invalid password', { exact: true })
      ).toBeVisible();
      await locked();
    };
    await wallet.step(
      'import the public synthetic fixture and verify its account',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await sameAccount();
      }
    );
    await wallet.step(
      'Lock refuses the wrong password and correct unlock precedes the cold close',
      async () => {
        await wallet!.page.locator('#general-settings-button').click();
        await wallet!.page
          .getByText(en.generalMenu.lock, { exact: true })
          .click();
        await locked();
        await wrongPassword();
        await wallet!.page.locator('#password').fill(password);
        await wallet!.page.locator('#unlock-btn').click();
        await sameAccount();
      }
    );
    const profileDir = wallet.profileDir;
    const extensionId = wallet.extensionId;
    const closedContext = wallet.context;
    const closedPage = wallet.page;
    await wallet.step(
      'close the unlocked persistent browser before reopening its same disposable profile',
      async (capture) => {
        // Capture before close: the step must not screenshot a dead page.
        await expect(closedPage).toHaveURL(/#\/home$/);
        await expect(closedPage.locator('#home-balance')).toHaveText('0.001');
        await capture(closedPage);
        let closeObserved = false;
        closedContext.once('close', () => {
          closeObserved = true;
        });
        await closedContext.close();
        expect(closeObserved).toBe(true);
        expect(closedPage.isClosed()).toBe(true);
        expect(closedContext.pages()).toHaveLength(0);
      }
    );
    wallet.summary.finish('passed');
    wallet = undefined;

    // launchPersistentContext starts a new browser; this is not a page reload or
    // connection to the previous context. The deny proxy is installed at launch.
    wallet = await PaliWallet.launch('offline-cold-restart-after', {
      offlineHttpProxy: server.url,
      resumeProfileDir: profileDir,
    });
    observations.push(
      await installUtxoFixtureRoutes(wallet.context, fixture, server.url)
    );
    expect(wallet.context).not.toBe(closedContext);
    expect(wallet.profileDir).toBe(profileDir);
    expect(wallet.extensionId).toBe(extensionId);
    const readiness = await waitForFixtureInterception(
      wallet.context,
      wallet.extensionId,
      async (attempt) => {
        fs.writeFileSync(
          path.join(
            E2E_CONFIG.artifactsDir,
            `cold-route-readiness-${attempt.attempt}.json`
          ),
          JSON.stringify(attempt, null, 2),
          { flag: 'wx', mode: 0o600 }
        );
      }
    );
    await wallet.step(
      'the new browser starts locked and still rejects the wrong password',
      async () => {
        await locked();
        await expect(wallet!.page.locator('#password')).toHaveValue('');
        await wrongPassword();
      }
    );
    await wallet.step(
      'correct normal unlock restores the same account, network and fixture balance',
      async () => {
        await wallet!.page.locator('#password').fill(password);
        await wallet!.page.locator('#unlock-btn').click();
        await sameAccount();
        expect(await wallet!.getActiveNetworkLabel()).toBe('Syscoin Testnet');
        for (const observation of observations)
          expect(observation.deniedWrites).toEqual([]);
      }
    );
    await wallet.dispose('passed');
    wallet = undefined;
    fs.writeFileSync(
      path.join(E2E_CONFIG.artifactsDir, 'offline-cold-restart.json'),
      JSON.stringify(
        {
          ...evidence,
          testSourceSha256: createHash('sha256')
            .update(fs.readFileSync(__filename))
            .digest('hex'),
          simulated: true,
          normalUIOnly: true,
          publicSyntheticSeedOnly: true,
          sameDisposableProfileReopened: true,
          closedWhileUnlocked: true,
          coldPersistentBrowserRestart: true,
          coldRouteReadiness: readiness,
          profile: path.relative(E2E_CONFIG.artifactsDir, profileDir),
          accountAddress: fixture.userAddress,
          signaturesRequested: false,
          chainBroadcast: false,
          seedOrPrivateKeyReported: false,
          fixtureReads: observations.flatMap(
            (observation) => observation.reads
          ),
          deniedWrites: observations.flatMap(
            (observation) => observation.deniedWrites
          ),
          proxyDeniedConnections: server.blocked.length,
          browserQaSessionsClosed: true,
        },
        null,
        2
      ),
      { flag: 'wx', mode: 0o600 }
    );
  } catch (error) {
    await wallet?.dispose('failed');
    throw error;
  } finally {
    Object.assign(E2E_CONFIG, before);
    await server.close();
  }
});
