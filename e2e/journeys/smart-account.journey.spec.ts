import { expect, test } from '@playwright/test';

import { getInfrastructureState, provider } from '../harness/chain';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';

// Full smart-account journey on the live testnet:
//   infra status -> deploy missing infra -> create smart account ->
//   register (deploy) the account -> activity shows the user operations.
//
// This exercises the hardened contracts (rotateValidator account
// implementation), the Multicall3-first metadata hydration, and the
// EntryPoint-log transaction history end to end.
test('smart account: infra deploy, account creation, policy, activity', async () => {
  const wallet = await PaliWallet.launch('smart-account');

  try {
    await wallet.step('onboard and switch network', async () => {
      await wallet.importSeedAndCreatePassword();
      await wallet.switchNetwork(E2E_CONFIG.networkLabel);
    });

    const infraBefore = await wallet.step('read on-chain infra state', () =>
      getInfrastructureState()
    );
    for (const { contract, deployed } of infraBefore) {
      wallet.summary.addAddress(`infra:${contract.id}`, contract.address);
      wallet.finding({
        detail: `${contract.id} @ ${contract.address}: ${
          deployed ? 'deployed' : 'missing'
        }`,
        severity: 'info',
        step: 'infra state (before)',
      });
    }

    await wallet.step(
      'advanced settings shows infrastructure card',
      async () => {
        await wallet.gotoRoute('#/settings/advanced');
        await expect(
          wallet.page.getByText(/smart account setup/i).first()
        ).toBeVisible({ timeout: 60_000 });
      }
    );

    const missing = infraBefore.filter((entry) => !entry.deployed);
    if (missing.length > 0) {
      await wallet.step('deploy missing infrastructure', async () => {
        const deployButton = wallet.page
          .getByRole('button', { name: /deploy/i })
          .first();
        await expect(deployButton).toBeVisible({ timeout: 60_000 });
        await deployButton.click();
        // The deploy pipeline sends one tx per missing contract and the card
        // flips to Ready when every required contract has code.
        await expect(wallet.page.getByText(/^ready$/i).first()).toBeVisible({
          timeout: E2E_CONFIG.slowActionTimeoutMs,
        });
      });

      await wallet.step('verify infra contracts on-chain', async () => {
        const infraAfter = await getInfrastructureState();
        const stillMissing = infraAfter.filter((entry) => !entry.deployed);
        for (const entry of stillMissing) {
          wallet.finding({
            detail: `${entry.contract.id} still missing at ${entry.contract.address} after deploy`,
            severity: 'bug',
            step: 'verify infra contracts on-chain',
          });
        }
        expect(stillMissing).toHaveLength(0);
      });
    } else {
      wallet.finding({
        detail: 'All infrastructure contracts already deployed; skipped deploy',
        severity: 'info',
        step: 'deploy missing infrastructure',
      });
    }

    await wallet.step('create smart account', async () => {
      await wallet.gotoRoute('#/settings/account/new');
      const createSmartAccount = wallet.page
        .getByRole('button', { name: /create smart account/i })
        .first();
      await expect(createSmartAccount).toBeVisible({ timeout: 60_000 });
      await createSmartAccount.click();
      // Counterfactual CREATE2 derivation runs through the background
      // controller; success shows the "Your new account has been created"
      // modal whose Ok button navigates back to home.
      const okButton = wallet.page
        .getByRole('button', { name: /^ok$/i })
        .first();
      await expect(okButton).toBeVisible({
        timeout: E2E_CONFIG.slowActionTimeoutMs,
      });
      await okButton.click();
      await wallet.page.waitForURL(/#\/home/, { timeout: 30_000 });
    });

    await wallet.step('smart account is selectable', async () => {
      await wallet.ensureOnHome();
      // The accounts list lives inside the hamburger (general settings) menu;
      // account rows have stable ids (#account-SmartAccount-N).
      await wallet.page.locator('#general-settings-button').click();
      const smartAccountItem = wallet.page
        .locator('[id^="account-SmartAccount"]')
        .first();
      await expect(smartAccountItem).toBeVisible({ timeout: 30_000 });
      await smartAccountItem.click();
      await wallet.page
        .locator('#home-balance')
        .waitFor({ state: 'visible', timeout: 60_000 });
    });

    const smartAccountAddress = await wallet.step(
      'read smart account address',
      () => wallet.getActiveAccountAddress()
    );
    wallet.summary.addAddress('smartAccount', smartAccountAddress);

    await wallet.step(
      'policy page reachable from manage accounts',
      async () => {
        await wallet.gotoRoute('#/settings/manage-accounts');
        const smartAccountRow = wallet.page
          .locator('li', { hasText: /Smart Account/ })
          .first();
        await expect(smartAccountRow).toBeVisible({ timeout: 30_000 });
        // First icon button on the row is the edit pencil.
        await smartAccountRow.locator('button').first().click();
        await expect(wallet.page).toHaveURL(/settings\/edit-account/, {
          timeout: 30_000,
        });
        await wallet.page
          .getByRole('button', { name: /smart account settings/i })
          .first()
          .click();
        await expect(wallet.page).toHaveURL(/smart-account-policy/, {
          timeout: 30_000,
        });
      }
    );

    await wallet.step('policy page shows approval method card', async () => {
      // A freshly created smart account is counterfactual (not deployed), so
      // the card shows the "Register account" CTA; deployed accounts show the
      // hydrated "Current approval method" with the active validator label.
      const card = wallet.page
        .getByText(/current approval method/i)
        .or(wallet.page.getByText(/register account/i))
        .first();
      await expect(card).toBeVisible({ timeout: 60_000 });
      const deployed = await wallet.page
        .getByText(/current approval method/i)
        .first()
        .isVisible();
      if (deployed) {
        // Hydration resolves the active validator label (Pali wallet for the
        // default ECDSA anchor).
        await expect(
          wallet.page.getByText(/pali wallet|passkey/i).first()
        ).toBeVisible({ timeout: 60_000 });
      }
    });

    await wallet.step('policy page shows modules or register CTA', async () => {
      // Deployed accounts list the module cards ("Sign-in and recovery");
      // counterfactual accounts show the Register CTA instead.
      await expect(
        wallet.page
          .getByText(/sign-in and recovery/i)
          .or(wallet.page.getByRole('button', { name: /register account/i }))
          .first()
      ).toBeVisible({ timeout: 60_000 });
    });

    await wallet.step(
      'register account through 4337 initCode flow',
      async () => {
        // "Register account" submits a no-op UserOperation whose initCode
        // deploys the account through EntryPoint.senderCreator() against the
        // gated factory; the gas payer prefunds the counterfactual address
        // first. Deployed accounts (re-run) skip this step.
        const registerButton = wallet.page
          .getByRole('button', { name: /register account/i })
          .first();
        const alreadyDeployed = !(await registerButton
          .isVisible({ timeout: 5_000 })
          .catch(() => false));
        if (alreadyDeployed) {
          wallet.finding({
            detail: 'Smart account already deployed; skipped registration',
            severity: 'info',
            step: 'register account through 4337 initCode flow',
          });
          return;
        }
        await registerButton.click();
        // Deployment confirms on-chain before the card flips to the hydrated
        // "Current approval method" state.
        await expect(
          wallet.page.getByText(/current approval method/i).first()
        ).toBeVisible({ timeout: E2E_CONFIG.slowActionTimeoutMs });
      }
    );

    await wallet.step('verify smart account code on-chain', async () => {
      const code = await provider.getCode(smartAccountAddress);
      if (code === '0x') {
        wallet.finding({
          detail: `Smart account ${smartAccountAddress} has no code after registration`,
          severity: 'bug',
          step: 'verify smart account code on-chain',
        });
      }
      expect(code).not.toBe('0x');
    });

    await wallet.step('activity panel renders for smart account', async () => {
      await wallet.gotoRoute('#/home');
      await wallet.page.locator('#activity-btn').click();
      // Same content assertion as the onboarding journey: empty state or the
      // explorer link that accompanies transaction rows.
      await expect(
        wallet.page
          .getByText(/you have no transaction history/i)
          .or(wallet.page.getByText(/see all your transactions/i))
          .first()
      ).toBeVisible({ timeout: 30_000 });
    });

    await wallet.dispose('passed');
  } catch (error) {
    await wallet.dispose('failed');
    throw error;
  }
});
