import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { utils as sys } from 'syscoinjs-lib';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const PASSWORD = 'Qa122AccountSynthetic!2026';
async function withWallet(
  name: string,
  info: TestInfo,
  onboard: boolean,
  run: (
    wallet: PaliWallet,
    observations: Record<string, unknown>
  ) => Promise<void>
) {
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: PASSWORD,
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  const observations: Record<string, unknown> = {};
  try {
    wallet = await PaliWallet.launch(name, {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    if (onboard)
      await wallet.step('import disposable public fixture', async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.ensureOnHome();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
      });
    await run(wallet, observations);
    expect(routes.deniedWrites).toEqual([]);
    fs.writeFileSync(
      info.outputPath('runtime-evidence.json'),
      JSON.stringify(
        {
          ...extensionEvidence(),
          observations,
          deniedWrites: routes.deniedWrites,
          proxyDeniedConnections: server.blocked.length,
          simulated: true,
          publicSyntheticOnly: true,
          controllerStateReplaced: false,
        },
        null,
        2
      )
    );
    await wallet.dispose('passed');
    wallet = undefined;
  } catch (error) {
    await wallet?.dispose('failed');
    wallet = undefined;
    throw error;
  } finally {
    await wallet?.context.close();
    await server.close();
    Object.assign(E2E_CONFIG, before);
  }
}
async function capture(page: Page, info: TestInfo, name: string) {
  const file = info.outputPath(`${name}.png`);
  await page.screenshot({
    path: file,
    animations: 'disabled',
    mask: [
      page.locator(
        'input[type=password],#import-account-identifier,textarea,.select-none p,button.min-w-xs'
      ),
    ],
  });
  await info.attach(name, { path: file, contentType: 'image/png' });
}

async function visibleAction(page: Page, action: Locator) {
  await action.scrollIntoViewIfNeeded();
  // Capture the settled scroller, not a compositor overscroll/resize frame.
  await page.waitForTimeout(650);
  const measure = () =>
    action.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2
      );
      return {
        name: element.getAttribute('aria-label'),
        width: rect.width,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        inViewport:
          rect.left >= 0 &&
          rect.top >= 0 &&
          rect.right <= innerWidth &&
          rect.bottom <= innerHeight,
        centerHit: hit !== null && element.contains(hit),
      };
    });
  await expect
    .poll(async () => {
      const geometry = await measure();
      return geometry.inViewport && geometry.centerHit;
    })
    .toBe(true);
  const geometry = await measure();
  expect(geometry.width).toBeGreaterThanOrEqual(44);
  expect(geometry.height).toBeGreaterThanOrEqual(44);
  return geometry;
}

test('regenerating a phrase requires fresh acknowledgement and exact-word confirmation', async ({}, info) => {
  test.setTimeout(90000);
  await withWallet(
    'qa122-account-phrase',
    info,
    false,
    async (wallet, observations) => {
      const page = wallet.page;
      await page.addStyleTag({
        content:
          '.select-none p,button.min-w-xs{-webkit-text-security:disc!important}',
      });
      await wallet.step(
        'open new disposable phrase setup without creating a wallet',
        async () => {
          await page.locator('#unlock-btn').click();
          await page.locator('#create-password').fill(PASSWORD);
          await page.locator('#confirm-password').fill(PASSWORD);
          await page.locator('#create-password-action').click();
          await expect(page).toHaveURL(/#\/phrase$/);
          await expect(page.getByRole('checkbox')).toBeEnabled();
          await page
            .getByRole('button', {
              name: en.import.showSeedPhrase,
              exact: true,
            })
            .click();
          await expect(page.locator('.select-none p')).toHaveCount(12);
        }
      );
      const digest = () =>
        page.locator('.select-none p').evaluateAll(async (words) => {
          const values = words.map((word) => word.textContent || '');
          (window as any).__qa122Phrase = values;
          const bytes = await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(values.join(' '))
          );
          return Array.from(new Uint8Array(bytes), (b) =>
            b.toString(16).padStart(2, '0')
          ).join('');
        });
      await wallet.step(
        'regenerate after acknowledgement and require fresh consent',
        async () => {
          const before = await digest();
          const check = page.getByRole('checkbox');
          await check.check();
          await page
            .getByRole('button', { name: en.buttons.generate, exact: true })
            .click();
          await expect(check).toBeEnabled();
          // A new seed resets the reveal state. Only inspect its digest after
          // generation has settled and the ordinary Show action is chosen.
          await page
            .getByRole('button', {
              name: en.import.showSeedPhrase,
              exact: true,
            })
            .click();
          await expect(page.locator('.select-none p')).toHaveCount(12);
          await expect.poll(digest).not.toBe(before);
          observations.checkedAfterRegenerate = await check.isChecked();
          await expect(check).not.toBeChecked();
          await expect(page.locator('#unlock-btn')).toBeDisabled();
          await capture(page, info, 'regenerated-acknowledgement');
          await check.check();
          await page.locator('#unlock-btn').click();
          await expect(page.locator('button.min-w-xs')).toHaveCount(12);
          observations.challengeRequiredBeforeWalletCreation = true;
        }
      );
      await wallet.step(
        'wrong word order cannot finish wallet creation',
        async () => {
          // Keep generated words entirely inside the disposable page; never return them.
          await page.evaluate(async () => {
            const wanted = [...(window as any).__qa122Phrase] as string[];
            const other = wanted.findIndex((value) => value !== wanted[0]);
            [wanted[0], wanted[other]] = [wanted[other], wanted[0]];
            const source = document
              .querySelector('button.min-w-xs')!
              .closest('section')!;
            for (const word of wanted) {
              const button = [...source.querySelectorAll('button')].find(
                (item) => item.textContent === word
              )!;
              button.click();
              await new Promise(requestAnimationFrame);
            }
          });
          await page
            .getByRole('button', { name: en.buttons.validate, exact: true })
            .click();
          await expect(
            page.getByText(en.seedConfirm.seedError, { exact: true })
          ).toBeVisible();
          await expect(page).toHaveURL(/#\/phrase$/);
          observations.wrongOrderRejected = true;
          await capture(page, info, 'wrong-order-blocked');
        }
      );
    }
  );
});

test('account actions are distinct and reachable; private import stays masked across modes', async ({}, info) => {
  test.setTimeout(120000);
  await withWallet(
    'qa122-account-controls',
    info,
    true,
    async (wallet, observations) => {
      const page = wallet.page;
      await wallet.step(
        'create two public fixture accounts and inspect controls',
        async () => {
          for (const label of [
            'Family savings — travel and rainy-day fund 2026',
            'Spending account',
          ]) {
            await wallet.gotoRoute('#/settings/account/new');
            const accountName = page.getByRole('textbox', {
              name: `${en.settings.nameYourNewAccount} (${en.settings.optional})`,
              exact: true,
            });
            await expect(accountName).toHaveAttribute(
              'id',
              'account-name-input'
            );
            await accountName.fill(label);
            await expect(accountName).toHaveAccessibleName(
              `${en.settings.nameYourNewAccount} (${en.settings.optional})`
            );
            observations.accountNameRemainsLabeledAfterEntry = true;
            await page.locator('#create-btn').click();
            await expect(page.getByRole('dialog')).toBeVisible();
            await page
              .getByRole('button', { name: en.buttons.ok, exact: true })
              .click();
          }
          await wallet.gotoRoute('#/settings/manage-accounts');
          for (const width of [320, 400]) {
            await page.setViewportSize({
              width,
              height: width === 320 ? 360 : 620,
            });
            const list = page.locator(
              '[data-navigation-scroll="settings-manage-accounts"]'
            );
            const allTargets = await list
              .locator('button')
              .evaluateAll((items) =>
                items.map((item) => {
                  const rect = item.getBoundingClientRect();
                  return { width: rect.width, height: rect.height };
                })
              );
            for (const target of allTargets) {
              expect(target.width).toBeGreaterThanOrEqual(44);
              expect(target.height).toBeGreaterThanOrEqual(44);
            }
            await expect(
              page.getByRole('button', {
                name: `${en.buttons.edit}: Family savings — travel and rainy-day fund 2026`,
                exact: true,
              })
            ).toHaveCount(1);
            await expect(
              page.getByRole('button', {
                name: `${en.buttons.remove}: Family savings — travel and rainy-day fund 2026`,
                exact: true,
              })
            ).toHaveCount(1);
            // Creation selects the new Spending account. Active accounts must
            // retain their removal protection even though editing is allowed.
            await expect(
              page.getByRole('button', {
                name: `${en.buttons.edit}: Spending account`,
                exact: true,
              })
            ).toHaveCount(1);
            await expect(
              page.getByRole('button', {
                name: `${en.buttons.remove}: Spending account`,
                exact: true,
              })
            ).toHaveCount(0);
            const targets = [];
            for (const name of [
              `${en.buttons.edit}: Family savings — travel and rainy-day fund 2026`,
              `${en.buttons.remove}: Family savings — travel and rainy-day fund 2026`,
            ]) {
              targets.push(
                await visibleAction(
                  page,
                  page.getByRole('button', { name, exact: true })
                )
              );
            }
            await capture(page, info, `account-controls-${width}`);
            targets.push(
              await visibleAction(
                page,
                page.getByRole('button', {
                  name: `${en.buttons.edit}: Spending account`,
                  exact: true,
                })
              )
            );
            await capture(page, info, `active-account-controls-${width}`);
            observations[`manager${width}`] = {
              tree: await list.ariaSnapshot(),
              targets,
            };
          }
          const edit = page.getByRole('button', {
            name: `${en.buttons.edit}: Family savings — travel and rainy-day fund 2026`,
            exact: true,
          });
          await edit.focus();
          await page.keyboard.press('Enter');
          await expect(
            page.getByPlaceholder(en.settings.accountLabel)
          ).toHaveValue('Family savings — travel and rainy-day fund 2026');
          observations.namedEditKeyboardOperable = true;
        }
      );
      await wallet.step(
        'inspect private input presentation without exporting its contents',
        async () => {
          await page.setViewportSize({ width: 400, height: 620 });
          await wallet.gotoRoute('#/settings/account/import');
          const field = page.locator('#import-account-identifier');
          observations.privatePresentation = await field.evaluate(
            (element) => ({
              type: element.getAttribute('type'),
              textSecurity: getComputedStyle(element).getPropertyValue(
                '-webkit-text-security'
              ),
            })
          );
          await expect(field).toHaveAttribute('type', 'password');
          const wif = new sys.HDSigner(UTXO_FIXTURE_SEED, '', true)
            .deriveKeypair("m/84'/1'/7'/0/0")
            .toWIF();
          await field.fill(wif);
          await expect(
            page.getByRole('button', { name: en.buttons.import, exact: true })
          ).toBeEnabled();
          for (const width of [320, 400]) {
            await page.setViewportSize({
              width,
              height: width === 320 ? 360 : 620,
            });
            const show = page.getByRole('button', {
              name: en.sentry.showPrivateKeys,
              exact: true,
            });
            const bounds = await show.boundingBox();
            expect(bounds).not.toBeNull();
            expect(bounds!.width).toBeGreaterThanOrEqual(44);
            expect(bounds!.height).toBeGreaterThanOrEqual(44);
            await show.focus();
            await page.keyboard.press('Space');
            await expect(field).toHaveAttribute('type', 'text');
            await expect(page.getByRole('dialog')).toHaveCount(0);
            await page
              .getByRole('button', {
                name: en.sentry.hidePrivateKeys,
                exact: true,
              })
              .click();
            await expect(field).toHaveAttribute('type', 'password');
            await capture(page, info, `private-import-masked-${width}`);
          }
          await page
            .getByRole('checkbox', { name: 'Watch-only', exact: true })
            .check();
          await expect(field).toHaveAttribute('type', 'password');
          await expect(
            page.getByText(en.settings.invalidWatchOnlyIdentifier, {
              exact: true,
            })
          ).toBeVisible();
          observations.secretRejectedInWatchOnly = true;
          await field.fill('');
          await expect(field).toHaveAttribute('type', 'text');
          observations.publicInputVisibleAfterPrivateDraftCleared = true;
        }
      );
      await wallet.step(
        'Escape cancels recovery and keeps the existing wallet unlockable',
        async () => {
          await wallet.ensureOnHome();
          await page.locator('#general-settings-button').click();
          await page.getByText(en.generalMenu.lock, { exact: true }).click();
          await expect(page.locator('#password')).toBeVisible();
          await page.locator('#import-wallet-link').click();
          await expect(
            page.getByText(en.settings.recoveryLimitations, { exact: true })
          ).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(page.locator('#password')).toBeVisible();
          await page.locator('#password').fill(PASSWORD);
          await page.locator('#unlock-btn').click();
          await expect(page).toHaveURL(/#\/home$/);
          await wallet.ensureOnHome();
          observations.recoveryEscapePreservesWallet = true;
        }
      );
    }
  );
});
