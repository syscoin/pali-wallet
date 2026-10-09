import { type Locator, type Page, expect, test } from '@playwright/test';

import { type InfrastructureStatus } from '../../source/pages/Settings/SmartAccountInfrastructure';
import {
  getChainId,
  getInfrastructureState,
  getNativeBalance,
} from '../harness/chain';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';

import { resetVisualScroll } from './scrollReset';

// Pixel-baseline walk of the core screens. One onboarding, then every test
// navigates and asserts a masked screenshot against the committed baseline.
//
// Masking policy: anything sourced from live chain/market data is masked --
// balances, fiat values, fee estimates, tx history rows. Addresses and QR
// codes are deterministic for the fixed test seed and stay unmasked so
// regressions in address rendering are caught.

const SELF_ADDRESS = '0xfFC854565ff83a49d3302821c0AD23822ca1A50C';

let wallet: PaliWallet;
let smartAccountCreated = false;

// Matches any "money-looking" number (balances, fiat, fees) anywhere on the
// page. The text engine resolves to the innermost matching elements.
const dynamicNumbers = (page: Page) => page.getByText(/\d[\d,]*\.\d{2,}/);

const commonMasks = (page = wallet.page): Locator[] => [
  dynamicNumbers(page),
  page.locator('#activity-panel-list'),
  page.locator('#activity-panel-empty'),
];

const settle = async (ms = 1200, page = wallet.page) => {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  // SYSCOIN: The last setup click can sit over the balance panel, whose
  // normal hover style dims the dots. Capture the neutral, non-hover state.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(ms);
  // SYSCOIN: Hash routing keeps one document alive across screens, so a scroll
  // container can carry either scroll axis from a previous test into the next
  // capture. Pin every baseline to its initial viewport for determinism.
  await page.evaluate(resetVisualScroll).catch(() => undefined);
  await page.waitForTimeout(150);
};

// Retry only this read-only preflight; never repeat account creation or a
// submitted action because of a transport timeout.
const refreshFixtureInfrastructure = async (page: Page) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response: any = await page.evaluate(async () => {
        let timer: number | undefined;
        try {
          return await Promise.race([
            chrome.runtime.sendMessage({
              type: 'CONTROLLER_ACTION',
              data: {
                methods: ['wallet', 'getSmartAccountInfrastructureStatus'],
                params: [true],
              },
            }),
            new Promise((_, reject) => {
              timer = window.setTimeout(
                () => reject(new Error('Infrastructure status read timed out')),
                22000
              );
            }),
          ]);
        } finally {
          window.clearTimeout(timer);
        }
      });
      if (response?.error) {
        throw new Error(
          typeof response.error === 'string'
            ? response.error
            : response.error.message ||
              response.message ||
              'Infrastructure status read failed'
        );
      }
      expect(
        response?.chainId,
        'Preflight must match the visual fixture network'
      ).toBe(E2E_CONFIG.chainId);
      return;
    } catch (error: any) {
      if (!error?.message?.includes('Infrastructure RPC timed out.'))
        throw error;
      if (attempt === 2) {
        throw new Error(
          'Visual fixture infrastructure RPC timed out after three read-only preflight attempts'
        );
      }
      await page.waitForTimeout(1000 * (attempt + 1));
    }
  }
};

test.describe('visual baselines', () => {
  test.beforeAll(async () => {
    // SYSCOIN: These goldens describe the funded public QA fixture, not an
    // empty replacement chain. Fail with the actual missing prerequisite
    // before comparing different account/history states or skipping coverage.
    expect(await getChainId()).toBe(E2E_CONFIG.chainId);
    expect(
      BigInt(await getNativeBalance(SELF_ADDRESS)),
      'Fund the public QA fixture before running funded-state visual baselines'
    ).toBeGreaterThan(BigInt('100000000000000'));
    const missingInfrastructure = (await getInfrastructureState())
      .filter(({ contract, deployed }) => !contract.optional && !deployed)
      .map(({ contract }) => contract.id);
    expect(
      missingInfrastructure,
      'Deploy the normal Pali smart-account infrastructure before visual QA'
    ).toEqual([]);

    wallet = await PaliWallet.launch('visual');
    await wallet.importSeedAndCreatePassword();
    await wallet.switchNetwork(E2E_CONFIG.networkLabel);

    // Create the smart account up front so every account list below renders
    // the same set of rows regardless of test order.
    await wallet.gotoRoute('#/settings/account/new');
    await settle(600);
    const createSmartAccount = wallet.page
      .getByRole('button', { name: /create smart account/i })
      .first();
    const smartAccountsUnavailable = await wallet.page
      .getByText(/smart accounts are not ready on this network yet/i)
      .isVisible()
      .catch(() => false);
    if (
      !smartAccountsUnavailable &&
      (await createSmartAccount.isVisible().catch(() => false))
    ) {
      const unavailableMessage = wallet.page.getByText(
        /smart accounts are not ready on this network yet/i
      );
      const rpcTimeoutMessage = wallet.page.getByText(
        'Infrastructure RPC timed out. Refresh status before retrying.',
        { exact: true }
      );
      const okButton = wallet.page
        .getByRole('button', { name: /^ok$/i })
        .first();
      await refreshFixtureInfrastructure(wallet.page);
      await createSmartAccount.click();
      const outcome = await Promise.race([
        unavailableMessage
          .waitFor({
            state: 'visible',
            timeout: E2E_CONFIG.slowActionTimeoutMs,
          })
          .then(() => 'unavailable' as const),
        rpcTimeoutMessage
          .waitFor({
            state: 'visible',
            timeout: E2E_CONFIG.slowActionTimeoutMs,
          })
          .then(() => 'rpc-timeout' as const),
        okButton
          .waitFor({
            state: 'visible',
            timeout: E2E_CONFIG.slowActionTimeoutMs,
          })
          .then(() => 'dialog' as const),
        wallet.page
          .waitForURL(/#\/home/, { timeout: E2E_CONFIG.slowActionTimeoutMs })
          .then(() => 'home' as const),
      ]);
      if (outcome === 'rpc-timeout') {
        throw new Error(
          'Visual fixture infrastructure RPC timed out after preflight; account creation was not retried'
        );
      }
      if (outcome === 'dialog') {
        await okButton.click();
        await wallet.page.waitForURL(/#\/home/, { timeout: 30_000 });
      }
      if (outcome !== 'unavailable') {
        smartAccountCreated = true;
        // Smart-account creation lands with the new account active; switch
        // back to Account 1 so home/send baselines use the HD account.
        await wallet.ensureOnHome();
        await wallet.page.locator('#general-settings-button').click();
        await wallet.page
          .getByText(/^Account 1 \(/)
          .first()
          .click();
        await wallet.page.waitForTimeout(2500);
      }
    }
    await wallet.ensureOnHome();
    expect(
      smartAccountCreated,
      'The funded visual fixture must have its local smart-account record'
    ).toBe(true);
    await expect(
      wallet.page.getByText('0xfFC8...AD23822ca1A50C', { exact: true }),
      'Visual baselines require the same public QA account identity'
    ).toBeVisible();
    await expect(
      wallet.page.locator('#activity-panel-list'),
      'Funded-state goldens require real confirmed fixture history'
    ).toBeVisible({ timeout: 60_000 });
  });

  test.afterAll(async () => {
    await wallet?.dispose();
  });

  test('home', async () => {
    await wallet.ensureOnHome();
    await settle();
    await expect(wallet.page).toHaveScreenshot(['home.png'], {
      mask: commonMasks(),
    });
  });

  test('settings menu', async () => {
    expect(smartAccountCreated).toBe(true);
    await wallet.ensureOnHome();
    await wallet.page.locator('#general-settings-button').click();
    await settle(600);
    await expect(wallet.page).toHaveScreenshot(['settings-menu.png'], {
      mask: commonMasks(),
    });
    await wallet.page.keyboard.press('Escape');
  });

  test('receive', async () => {
    await wallet.gotoRoute('#/receive');
    await expect(wallet.page.locator('#qr-code')).toBeVisible({
      timeout: 30_000,
    });
    // The header buttons stay disabled until the page fully settles; wait for
    // the copy button so the capture never races the loading state.
    await expect(wallet.page.locator('#copy-address-receive-btn')).toBeVisible({
      timeout: 30_000,
    });
    await settle(1200);
    await expect(wallet.page).toHaveScreenshot(['receive.png'], {
      mask: commonMasks(),
    });
  });

  test('send form', async () => {
    await wallet.ensureOnHome();
    await wallet.page.locator('#send-btn').click();
    await expect(wallet.page).toHaveURL(/send\/eth/, { timeout: 30_000 });
    const nextButton = wallet.page.locator('#send-eth-next-btn');
    // The first render is briefly enabled before the mount effect starts fee
    // initialization. Observe that transition before waiting for the durable
    // ready state so the screenshot cannot capture the loading spinner.
    await expect(nextButton)
      .toBeDisabled({ timeout: 5_000 })
      .catch(() => undefined);
    await expect(nextButton).toBeEnabled({
      timeout: E2E_CONFIG.slowActionTimeoutMs,
    });
    await settle();
    await expect(wallet.page).toHaveScreenshot(['send-eth.png'], {
      mask: commonMasks(),
    });
  });

  test('send confirm', async () => {
    await wallet.ensureOnHome();
    await wallet.page.locator('#send-btn').click();
    await expect(wallet.page).toHaveURL(/send\/eth/, { timeout: 30_000 });
    await wallet.page
      .getByPlaceholder(/receiver/i)
      .first()
      .fill(SELF_ADDRESS);
    await wallet.page
      .getByPlaceholder(/amount/i)
      .first()
      .fill('0.0001');
    await wallet.page.waitForTimeout(2000);
    await expect(
      wallet.page.getByText(/insufficient funds/i),
      'The public fixture must cover the send amount and the current fee'
    ).toHaveCount(0);
    await wallet.page.getByRole('button', { name: /next/i }).first().click();
    await expect(wallet.page).toHaveURL(/send\/confirm/, { timeout: 30_000 });
    // Background fee estimation can outlast a fixed settle delay. Capture
    // the resolved fee layout only; never click Confirm in this visual walk.
    await settle(3000);
    await expect(
      wallet.page.getByText('Calculating...', { exact: true })
    ).toHaveCount(0, { timeout: E2E_CONFIG.slowActionTimeoutMs });
    await expect(
      wallet.page.getByRole('button', { name: 'Confirm', exact: true })
    ).toBeEnabled({ timeout: E2E_CONFIG.slowActionTimeoutMs });
    await expect(wallet.page).toHaveScreenshot(['send-confirm.png'], {
      mask: [...commonMasks(), wallet.page.getByText(/gwei/i)],
    });
    // Leave without submitting.
    await wallet.gotoRoute('#/home');
  });

  test('activity list', async () => {
    await wallet.gotoRoute('#/home?tab=activity');
    await wallet.ensureOnHome();
    await expect(wallet.page.locator('#activity-panel-list')).toBeVisible({
      timeout: 60_000,
    });
    await settle();
    await expect(wallet.page).toHaveScreenshot(['activity.png'], {
      mask: commonMasks(),
    });
  });

  test('tx details', async () => {
    await wallet.gotoRoute('#/home?tab=activity');
    await wallet.ensureOnHome();
    // Rows are not clickable as a whole; the drill-down affordance is the
    // detail arrow (cursor-pointer svg) rendered on confirmed rows.
    const detailArrow = wallet.page
      .locator('#activity-panel-list svg.cursor-pointer')
      .first();
    await expect(
      detailArrow,
      'Transaction-details golden requires a real confirmed history row'
    ).toBeVisible({ timeout: 30_000 });
    await detailArrow.click();
    await expect(wallet.page).toHaveURL(/home\/details/, { timeout: 30_000 });
    await expect(wallet.page.locator('#details-view-content')).toBeVisible({
      timeout: 30_000,
    });
    await settle();
    // The whole detail list is chain data; baseline covers page chrome,
    // header and layout shell.
    await expect(wallet.page).toHaveScreenshot(['tx-details.png'], {
      mask: [...commonMasks(), wallet.page.locator('#details-view-content')],
    });
  });

  test('manage accounts', async () => {
    expect(smartAccountCreated).toBe(true);
    await wallet.gotoRoute('#/settings/manage-accounts');
    await expect(wallet.page.getByText(/^Account 1 \(/).first()).toBeVisible({
      timeout: 30_000,
    });
    await settle(600);
    await expect(wallet.page).toHaveScreenshot(['manage-accounts.png'], {
      mask: commonMasks(),
    });
  });

  test('edit account', async () => {
    await wallet.gotoRoute('#/settings/manage-accounts');
    const account1Row = wallet.page
      .locator('li', { hasText: /Account 1 \(/ })
      .first();
    await expect(account1Row).toBeVisible({ timeout: 30_000 });
    await account1Row.locator('button').first().click();
    await expect(wallet.page).toHaveURL(/settings\/edit-account/, {
      timeout: 30_000,
    });
    await settle(600);
    await expect(wallet.page).toHaveScreenshot(['edit-account.png'], {
      mask: commonMasks(),
    });
  });

  test('smart account policy', async () => {
    await wallet.gotoRoute('#/settings/manage-accounts');
    const smartAccountRow = wallet.page
      .locator('li', { hasText: /Smart Account/ })
      .first();
    await expect(smartAccountRow).toBeVisible();
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
    // Wait out the hydration spinners so the baseline captures settled state.
    await wallet.page
      .getByText(/checking/i)
      .first()
      .waitFor({ state: 'hidden', timeout: 60_000 })
      .catch(() => undefined);
    await settle(1500);
    await expect(wallet.page).toHaveScreenshot(['smart-account-policy.png'], {
      mask: commonMasks(),
      // Policy page scrolls; capture everything for layout coverage.
      fullPage: true,
    });
  });

  for (const ready of [true, false]) {
    test(`advanced settings (${ready ? 'ready' : 'not ready'})`, async () => {
      // A new canonical module is absent from the live testnet until rollout.
      // Pin this read-only UI input and cover both layouts without deploying it.
      const page = await wallet.context.newPage();
      const infrastructureFixture = {
        chainId: E2E_CONFIG.chainId,
        isReady: ready,
      };
      try {
        await page.addInitScript(({ chainId, isReady }) => {
          const sendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
          chrome.runtime.sendMessage = ((...args: any[]) => {
            const [message, callback] = args;
            if (
              location.hash === '#/settings/advanced' &&
              message?.type === 'CONTROLLER_ACTION' &&
              message.data?.methods?.length === 2 &&
              message.data.methods[0] === 'wallet' &&
              message.data.methods[1] === 'getSmartAccountInfrastructureStatus'
            ) {
              // The UI accepts only status for the active fixture network.
              const status: InfrastructureStatus = {
                chainId,
                contracts: [
                  {
                    deployed: isReady,
                    displayName: 'Guardian recovery',
                    id: 'guardian-recovery',
                  },
                ],
                create2Deployer: { deployed: true },
                ready: isReady,
              };
              if (typeof callback === 'function') {
                queueMicrotask(() => callback(status));
                return;
              }
              return Promise.resolve(status);
            }
            return (sendMessage as any)(...args);
          }) as typeof chrome.runtime.sendMessage;
        }, infrastructureFixture);
        await page.goto(wallet.appUrl('#/home'));
        await expect(page.locator('#home-balance')).toBeVisible({
          timeout: 60_000,
        });
        await settle(600, page);
        await page.locator('#general-settings-button').click();
        await page
          .getByRole('menuitem', { name: 'Advanced', exact: true })
          .click();
        await expect(page).toHaveURL(/#\/settings\/advanced$/);
        await expect(
          page.getByText('Smart account setup', { exact: true })
        ).toBeVisible({ timeout: 60_000 });
        await expect(
          page
            .getByRole('status')
            .getByText(
              ready
                ? 'Ready on this network.'
                : 'Needed before smart accounts can be used here.',
              { exact: true }
            )
        ).toBeVisible();
        const checkStatus = page.getByRole('button', {
          name: 'Check status',
          exact: true,
        });
        await expect(checkStatus).toBeEnabled();
        const deploy = page.getByRole('button', {
          name: 'Deploy',
          exact: true,
        });
        if (ready) {
          await expect(deploy).toHaveCount(0);
          await expect(page.getByText(/setup item\(s\) missing/)).toHaveCount(
            0
          );
        } else {
          await expect(
            page.getByText('1 setup item(s) missing.', { exact: true })
          ).toBeVisible();
          await expect(deploy).toBeEnabled();
        }
        // A text locator can pass even when a button is white-on-white.
        for (const action of [checkStatus, ...(ready ? [] : [deploy])]) {
          const contrast = await action.evaluate((button) => {
            const style = getComputedStyle(button);
            const luminance = (color: string) => {
              const channels = color
                .match(/[\d.]+/g)!
                .slice(0, 3)
                .map(Number);
              return channels.reduce((total, channel, index) => {
                const value = channel / 255;
                const linear =
                  value <= 0.04045
                    ? value / 12.92
                    : ((value + 0.055) / 1.055) ** 2.4;
                return total + linear * [0.2126, 0.7152, 0.0722][index];
              }, 0);
            };
            const foreground = luminance(style.color);
            const background = luminance(style.backgroundColor);
            return (
              (Math.max(foreground, background) + 0.05) /
              (Math.min(foreground, background) + 0.05)
            );
          });
          expect(
            contrast,
            'Infrastructure action text must be readable'
          ).toBeGreaterThanOrEqual(4.5);
        }
        // Both the popup and wider extension view must keep Save in flow.
        for (const viewport of [
          { width: 400, height: 620 },
          { width: 600, height: 800 },
        ]) {
          await page.setViewportSize(viewport);
          const save = page.getByRole('button', { name: 'Save', exact: true });
          const autolock = page.getByRole('spinbutton');
          const autolockRow = page
            .locator('#autolock .ant-form-item')
            .filter({ has: autolock });
          await save.scrollIntoViewIfNeeded();
          await expect(save).toBeInViewport({ ratio: 1 });
          await expect(autolockRow).toBeInViewport({ ratio: 1 });
          const saveBox = await save.boundingBox();
          const autolockBox = await autolockRow.boundingBox();
          expect(saveBox!.y).toBeGreaterThanOrEqual(
            autolockBox!.y + autolockBox!.height
          );
        }
        await settle(1500, page);
        await expect(page).toHaveURL(/#\/settings\/advanced$/);
        await expect(page).toHaveScreenshot(
          [ready ? 'advanced.png' : 'advanced-not-ready.png'],
          { mask: commonMasks(page), fullPage: true }
        );
      } finally {
        await page.close();
      }
    });
  }

  test('custom rpc', async () => {
    await wallet.gotoRoute('#/settings/networks/custom-rpc');
    await settle();
    await expect(wallet.page).toHaveScreenshot(['custom-rpc.png'], {
      mask: commonMasks(),
    });
  });
});
