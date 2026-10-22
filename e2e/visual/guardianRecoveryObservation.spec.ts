import { expect, test, type Locator, type Page } from '@playwright/test';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { createGuardianRecoveryFixture } from '../harness/guardianRecoveryFixture';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import { startUtxoFixtureServer } from '../harness/utxoFixture';
import {
  VISUAL_FIXTURE_CHAIN_ID,
  VISUAL_FIXTURE_SEED,
} from '../harness/visualFixture';

const LABEL = 'External recovery savings';
const ZERO = `0x${'00'.repeat(32)}`;
const publicSelection = (page: Page) =>
  page.evaluate(async () => {
    const { vault } = await chrome.runtime.sendMessage({
      type: 'getCurrentState',
    });
    const active = vault.activeAccount;
    return {
      active: {
        ...active,
        address: vault.accounts[active.type][active.id].address,
      },
      hd: {
        address: vault.accounts.HDAccount[0].address,
        label: vault.accounts.HDAccount[0].label,
      },
    };
  });

async function reachable(page: Page, control: Locator) {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function disableCaution(control: Locator) {
  await expect(control).toHaveAccessibleName(
    en.settings.smartAccountGuardianRecoveryDisable
  );
  await expect(control).toHaveAttribute('type', 'button');
  await expect(control).toHaveClass(/\bborder-brand-blue500\b/);
  const cue = control.locator('span[aria-hidden="true"]');
  await expect(cue).toHaveClass(/\btext-brand-yellowInfo\b/);
  await expect(cue.locator('svg')).toBeVisible();
  await expect(control.getByRole('img')).toHaveCount(0);
  return cue.evaluate((element) => ({
    color: getComputedStyle(element).color,
    decorative: element.getAttribute('aria-hidden') === 'true',
  }));
}

test('guardian recovery observes external requests without a local intent and fails closed on unavailable reads', async ({}, info) => {
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const previous = { ...E2E_CONFIG };
  const fixture = createGuardianRecoveryFixture();
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: VISUAL_FIXTURE_SEED,
    password: 'GuardianObservationSynthetic!2026',
    rpcUrl: server.url,
    chainId: VISUAL_FIXTURE_CHAIN_ID,
    networkLabel: 'zkTanenbaum',
  });
  let wallet: PaliWallet | undefined;
  let result: 'passed' | 'failed' = 'failed';
  const evidence: Record<string, unknown> = {
    runtime: extensionEvidence(),
    workingProductionDiff: process.env.PALI_CANDIDATE_SOURCE_DIFF || null,
    chainResponses:
      'synthetic canonical ABI/storage; no public chain or transaction publication',
    controllerStateReplaced: false,
    controllerResultsReplaced: false,
  };
  try {
    wallet = await PaliWallet.launch('guardian-recovery-observation', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    await fixture.install(wallet.context, server.url);
    const page = wallet.page;
    await wallet.step(
      'create the account through the real wallet UI with no local recovery intent',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('zkTanenbaum', 'EVM');
        await wallet!.gotoRoute('#/settings/account/new');
        await page.locator('#account-name-input').fill(LABEL);
        await page
          .getByRole('button', {
            name: new RegExp(`^${en.settings.createSmartAccount}`, 'i'),
          })
          .click();
        const dialog = page
          .getByRole('dialog')
          .filter({ hasText: en.settings.yourNewAccount });
        await expect(
          dialog.getByText(fixture.base.smartAccountAddress, { exact: true })
        ).toBeVisible();
        await dialog.locator('#account-created-ok-btn').click();
        await wallet!.ensureOnHome();
        expect((await publicSelection(page)).active.type).toBe('SmartAccount');
        expect(
          await page.evaluate(() =>
            Object.keys(localStorage).filter((key) =>
              key.startsWith('pali-smart-account-recovery-replacement:')
            )
          )
        ).toEqual([]);
      }
    );
    fixture.hydrationState.deployed = true;
    fixture.hydrationState.guardianInstalled = true;
    await wallet.step(
      'show the externally scheduled recovery and exact deadline without enabling finalization',
      async (capture) => {
        await wallet!.gotoRoute('#/settings/account/smart-account-policy');
        const panel = page.getByTestId('guardian-chain-status');
        await expect(
          panel.getByText(en.settings.smartAccountGuardianExternalPending, {
            exact: true,
          })
        ).toBeVisible();
        await expect(
          panel.getByText(fixture.base.smartAccountAddress, { exact: true })
        ).toBeVisible();
        const deadline = await page.evaluate(
          (timestamp) => new Date(timestamp * 1000).toLocaleString(),
          fixture.state.scheduledAt + 600
        );
        await expect(panel).toContainText(deadline);
        const dates = await page.evaluate(
          (timestamps) =>
            timestamps.map((timestamp) =>
              new Date(timestamp * 1000).toLocaleString()
            ),
          [fixture.state.scheduledAt + 1800, fixture.state.timestamp]
        );
        for (const date of dates) await expect(panel).toContainText(date);
        await expect(panel).not.toContainText('&#');
        await page
          .getByRole('button', {
            name: en.settings.smartAccountGuardianRecoveryContinue,
            exact: true,
          })
          .click();
        await expect(
          page.getByRole('button', {
            name: en.settings.smartAccountGuardianRecoveryFinalize,
            exact: true,
          })
        ).toBeDisabled();
        await capture(page);
        evidence.external = {
          operationId: fixture.operationId,
          scheduledAt: fixture.state.scheduledAt,
          executableAt: fixture.state.scheduledAt + 600,
          localIntent: false,
          finalizeEnabled: false,
        };
      }
    );
    await wallet.step(
      'show a subtle Disable warning without changing the blue action or confirmation',
      async (capture) => {
        const disable = page.getByRole('button', {
          name: en.settings.smartAccountGuardianRecoveryDisable,
          exact: true,
        });
        await reachable(page, disable);
        evidence.disableCaution400 = await disableCaution(disable);
        await capture(page);
        await disable.click();
        const dialog = page.getByRole('dialog').filter({
          hasText: en.settings.smartAccountGuardianRecoveryDisableConfirmTitle,
        });
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText(fixture.base.smartAccountAddress);
        await expect(dialog).toContainText('zkTanenbaum (57057)');
        await expect(dialog).toContainText(
          en.settings.smartAccountGuardianRecoveryInvalidatesPending
        );
        expect(fixture.audit.deniedWrites).toEqual([]);
        await dialog
          .getByRole('button', { name: en.buttons.cancel, exact: true })
          .click();
        await expect(dialog).toBeHidden();
        expect(fixture.audit.deniedWrites).toEqual([]);
      }
    );
    await wallet.step(
      'keep the error and owner intervention reachable at 320 pixels without claiming no recovery',
      async (capture) => {
        await page.setViewportSize({ width: 320, height: 420 });
        fixture.state.failStorage = true;
        await page
          .getByRole('button', {
            name: en.settings.smartAccountGuardianRefreshStatus,
            exact: true,
          })
          .click();
        const panel = page.getByTestId('guardian-chain-status');
        await expect(
          page.getByRole('alert').filter({
            hasText: en.settings.smartAccountGuardianStatusUnavailable,
          })
        ).toBeVisible();
        await expect(
          page.getByText(en.settings.smartAccountGuardianRecoveryNotConnected, {
            exact: true,
          })
        ).toHaveCount(0);
        await reachable(
          page,
          page.getByRole('button', {
            name: en.settings.smartAccountGuardianRefreshStatus,
            exact: true,
          })
        );
        await capture(page);
        const disable = page.getByRole('button', {
          name: en.settings.smartAccountGuardianRecoveryDisable,
          exact: true,
        });
        await reachable(page, disable);
        evidence.disableCaution320 = await disableCaution(disable);
        await capture(page);
        for (let index = 0; index < 32; index++) {
          await page.keyboard.press('Tab');
          if (
            await disable.evaluate(
              (element) => element === document.activeElement
            )
          )
            break;
        }
        await expect(disable).toBeFocused();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog').filter({
          hasText: en.settings.smartAccountGuardianRecoveryDisableConfirmTitle,
        });
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText(fixture.base.smartAccountAddress);
        await capture(page);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        fixture.state.failStorage = false;
        await page
          .getByRole('button', {
            name: en.settings.smartAccountGuardianRefreshStatus,
            exact: true,
          })
          .click();
        await expect(panel).toContainText(
          en.settings.smartAccountGuardianExternalPending
        );
        expect(fixture.audit.deniedWrites).toEqual([]);
      }
    );
    await wallet.step(
      'refresh canceled and expired chain observations without reconstructing a signing intent',
      async () => {
        const panel = page.getByTestId('guardian-chain-status');
        fixture.state.activeOperation = ZERO;
        fixture.state.canceled = true;
        fixture.state.blockNumber++;
        await page
          .getByRole('button', {
            name: en.settings.smartAccountGuardianRefreshStatus,
            exact: true,
          })
          .click();
        await expect(panel).not.toContainText(
          en.settings.smartAccountGuardianExternalPending
        );
        await expect(
          page.getByRole('status').filter({
            hasText: en.settings.smartAccountGuardianRecoveryConnectedStatus,
          })
        ).toBeVisible();
        fixture.state.canceled = false;
        fixture.state.activeOperation = fixture.operationId;
        fixture.state.scheduledAt = fixture.state.timestamp - 1801;
        fixture.state.blockNumber++;
        await page
          .getByRole('button', {
            name: en.settings.smartAccountGuardianRefreshStatus,
            exact: true,
          })
          .click();
        await expect(panel).not.toContainText(
          en.settings.smartAccountGuardianExternalPending
        );
        await expect(
          page.getByRole('status').filter({
            hasText: en.settings.smartAccountGuardianRecoveryConnectedStatus,
          })
        ).toBeVisible();
        await expect(
          page.getByRole('button', {
            name: en.settings.smartAccountGuardianRecoveryFinalize,
            exact: true,
          })
        ).toBeDisabled();
        expect(
          await page.evaluate(() =>
            Object.keys(localStorage).filter((key) =>
              key.startsWith('pali-smart-account-recovery-replacement:')
            )
          )
        ).toEqual([]);
      }
    );
    await wallet.step(
      'retire an in-flight observation after a real account switch',
      async () => {
        // The delayed reply contains a genuinely pending request, not the
        // expired result from the previous step, so stale UI would be visible.
        fixture.state.scheduledAt = fixture.state.timestamp - 100;
        fixture.state.blockNumber++;
        const held = fixture.holdStorage();
        await page
          .getByRole('button', {
            name: en.settings.smartAccountGuardianRefreshStatus,
            exact: true,
          })
          .click();
        await held;
        const { hd } = await publicSelection(page);
        // The policy header has no account chooser. Return through ordinary
        // navigation, then change accounts using the actual Home menu.
        await wallet!.gotoRoute('#/home');
        await wallet!.ensureOnHome();
        await page.locator('#general-settings-button').locator('..').click();
        await page
          .getByRole('menuitem', {
            name: `${hd.label} (${hd.address})`,
            exact: true,
          })
          .click();
        await expect
          .poll(() => publicSelection(page))
          .toMatchObject({
            active: { type: 'HDAccount', id: 0, address: hd.address },
          });
        fixture.releaseStorage();
        await expect(
          page.getByText(en.settings.smartAccountGuardianExternalPending, {
            exact: true,
          })
        ).toHaveCount(0);
        evidence.retiredReadIgnored = true;
      }
    );
    expect(fixture.audit.deniedWrites).toEqual([]);
    expect(
      fixture.audit.deniedUnknown.filter((request) =>
        request.startsWith('rpc:')
      )
    ).toEqual([]);
    evidence.network = fixture.audit;
    await info.attach('guardian-recovery-observation-evidence', {
      body: Buffer.from(JSON.stringify(evidence, null, 2)),
      contentType: 'application/json',
    });
    result = 'passed';
  } finally {
    fixture.releaseStorage();
    fixture.releaseAll();
    if (wallet) await wallet.dispose(result);
    await server.close();
    Object.assign(E2E_CONFIG, previous);
  }
});
