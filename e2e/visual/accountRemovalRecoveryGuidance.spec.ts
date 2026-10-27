import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import { HDNodeWallet } from 'ethers';
import fs from 'fs';
import path from 'path';

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

// Never retain tracing/video of input values or the raw disposable profile.
// Screenshots are taken only by the existing masked harness after each step.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

const HD_LABEL = 'Seed-derived recovery control';
const IMPORTED_LABEL = 'Separately backed up synthetic signer';

async function accountProjection(page: Page) {
  return page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const key = `state-vault-${state.vaultGlobal.activeSlip44}`;
    const disk = await chrome.storage.local.get(key);
    const project = (accounts: any) =>
      Object.entries(accounts || {})
        .flatMap(([kind, group]: [string, any]) =>
          Object.values(group || {}).map((account: any) => ({
            kind,
            id: account.id,
            label: account.label,
            address: account.address,
            // Only provenance booleans leave the page, never encrypted key bytes.
            hasSigningRecord: Boolean(account.xprv),
            imported: account.isImported === true,
          }))
        )
        .sort((left, right) =>
          `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`)
        );
    return {
      active: state.vault.activeAccount,
      network: {
        kind: state.vault.activeNetwork.kind,
        chainId: state.vault.activeNetwork.chainId,
      },
      live: project(state.vault.accounts),
      persisted: project(disk[key]?.accounts),
    };
  });
}

test('account removal explains private-import backup needs and Cancel preserves both account kinds', async ({}, info) => {
  expect(process.version).toBe('v26.12.1');
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  const sourceSha256 = createHash('sha256')
    .update(fs.readFileSync(info.file))
    .digest('hex');
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'RemovalCopySyntheticOnly!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = { runtime, sourceSha256 };
  const forbiddenRequests: string[] = [];
  const pageErrors: string[] = [];
  let profileRemoved = false;
  try {
    wallet = await PaliWallet.launch('account-removal-recovery-guidance', {
      offlineHttpProxy: server.url,
      recordVideo: false,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    observations.workerIdentity = await verifyExecutingWorker(
      wallet.context,
      wallet.extensionId,
      E2E_CONFIG.extensionPath,
      (value) => {
        observations.workerIdentity = value;
      }
    );
    const page = wallet.page;
    page.on('pageerror', (error) => pageErrors.push(error.message));
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
        /* ordinary GET */
      }
    });
    const openGeneral = async (name: string) => {
      await wallet!.ensureOnHome();
      await page
        .getByRole('button', {
          name: en.generalMenu.generalOptions,
          exact: true,
        })
        .click();
      await page.getByRole('menuitem', { name, exact: true }).click();
    };
    const selectAnchor = async () => {
      await wallet!.ensureOnHome();
      await page.locator('#general-settings-button').click();
      await page
        .locator('#account-HDAccount-0')
        .getByRole('menuitem')
        .first()
        .click();
      await expect
        .poll(async () => (await accountProjection(page)).active)
        .toEqual({ id: 0, type: 'HDAccount' });
      await wallet!.ensureOnHome();
    };
    await wallet.step(
      'create a normal seed-derived account for the healthy cancellation control',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await openGeneral(en.accountMenu.createNewAccount);
        await page.locator('#account-name-input').fill(HD_LABEL);
        await page.locator('#create-btn').click();
        await page
          .getByRole('button', { name: en.buttons.ok, exact: true })
          .click();
        await selectAnchor();
      }
    );
    const openAndCancel = async (
      label: string,
      kind: 'HDAccount' | 'Imported'
    ) => {
      await openGeneral(en.accountMenu.manageAccounts);
      const before = await accountProjection(page);
      const target = before.live.find(
        (account) => account.kind === kind && account.label === label
      );
      expect(target).toBeDefined();
      expect(before.persisted).toContainEqual(target!);
      await page
        .getByRole('button', {
          name: `${en.buttons.remove}: ${label} (${target!.address})`,
          exact: true,
        })
        .click();
      const dialog = page.getByRole('dialog', {
        name: en.settings.removeAccount,
        exact: true,
      });
      await expect(dialog).toBeVisible();
      const copy = await dialog.innerText();
      expect(copy).toContain(`${label} (${target!.address})`);
      if (kind === 'Imported') {
        expect(target!.hasSigningRecord).toBe(true);
        expect(target!.imported).toBe(true);
        // Preserve the original before-state checks and require the exact
        // localized warning while retaining real Cancel/persistence evidence.
        expect.soft(copy).toMatch(/private key/i);
        expect.soft(copy).toMatch(/backup|back up/i);
        expect.soft(copy).toMatch(/recovery phrase|seed/i);
        expect.soft(copy).toContain(en.settings.importedAccountRemovalWarning);
        await page.setViewportSize({ width: 320, height: 360 });
        await expect(
          dialog.getByRole('button', { name: en.buttons.cancel, exact: true })
        ).toBeInViewport();
        await expect(
          dialog.getByRole('button', { name: en.buttons.remove, exact: true })
        ).toBeInViewport();
        await wallet!.shot('imported-removal-public-guidance-short');
        await page.setViewportSize({ width: 400, height: 620 });
      }
      await wallet!.shot(`${kind}-removal-public-guidance`);
      await dialog
        .getByRole('button', { name: en.buttons.cancel, exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      const after = await accountProjection(page);
      expect(after).toEqual(before);
      observations[kind] = {
        copy,
        target,
        before,
        after,
        destructiveConfirmationClicked: false,
      };
      await wallet!.ensureOnHome();
    };
    await wallet.step(
      'inspect and cancel the healthy HD removal confirmation',
      async () => {
        await openAndCancel(HD_LABEL, 'HDAccount');
      }
    );
    await wallet.step(
      'import a separate synthetic private account through the ordinary form',
      async () => {
        await openGeneral(en.accountMenu.importAccount);
        await expect(page).toHaveURL(/#\/settings\/account\/import$/);
        await page.locator('#account-name-input').fill(IMPORTED_LABEL);
        const input = page.locator('#import-account-identifier');
        await expect(input).toHaveAttribute('type', 'password');
        // Derivation index seven is separate from the two HD accounts above.
        // The source phrase is the existing public disposable fixture; never
        // attach the key, raw state, profile or an input trace to the report.
        let syntheticKey = HDNodeWallet.fromPhrase(
          UTXO_FIXTURE_SEED,
          undefined,
          "m/44'/60'/0'/0/7"
        ).privateKey;
        await input.fill(syntheticKey).catch(() => {
          throw new Error('Synthetic key entry failed');
        });
        syntheticKey = '';
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
        await selectAnchor();
      }
    );
    await wallet.step(
      'inspect imported-key recovery guidance and cancel without removing it',
      async () => {
        await openAndCancel(IMPORTED_LABEL, 'Imported');
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    expect(forbiddenRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    expect(
      createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
    ).toBe(sourceSha256);
    status = info.errors.length ? 'failed' : 'passed';
  } finally {
    try {
      await wallet?.dispose(status);
      if (wallet) {
        const profiles = path.resolve(E2E_CONFIG.artifactsDir, 'profiles');
        const profile = path.resolve(wallet.profileDir);
        const relative = path.relative(profiles, profile);
        if (
          !relative ||
          relative.startsWith('..') ||
          path.isAbsolute(relative) ||
          relative.includes(path.sep) ||
          fs.realpathSync(profiles) !== profiles ||
          !fs.lstatSync(profile).isDirectory() ||
          fs.lstatSync(profile).isSymbolicLink() ||
          fs.realpathSync(profile) !== profile
        )
          throw new Error('Disposable profile cleanup path refused');
        // Closed, test-owned direct child only. The raw profile is never an artifact.
        fs.rmSync(profile, { recursive: true, force: true });
        profileRemoved = true;
      }
    } finally {
      try {
        await info.attach('account-removal-recovery-guidance', {
          contentType: 'application/json',
          body: JSON.stringify({
            status,
            observations,
            forbiddenRequests,
            pageErrors,
            fixtureReads: routes?.reads,
            deniedWrites: routes?.deniedWrites,
            proxyRefusals: server.blocked.length,
            traceRetained: false,
            videoRetained: false,
            rawProfileRemoved: profileRemoved,
            syntheticPrivateInputOnly: true,
            destructiveConfirmationClicked: false,
            controllerStateReplaced: false,
          }),
        });
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  }
});
