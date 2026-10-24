import { expect, test, type Page } from '@playwright/test';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { clickClosingPopup } from '../harness/dismissRejectedApproval';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const BEFORE_REVISION = 'fe41a0ed8d0097d0de9940e9057d44eb6ef60e4d';
const mode = process.env.PALI_HARDWARE_PURCHASE_MODE || 'after';
const vendors = [
  { name: 'Ledger', button: '#ledger-btn', url: 'https://www.ledger.com/' },
  { name: 'Trezor', button: '#trezor-btn', url: 'https://trezor.io/' },
] as const;

// Only the real menu/selection UI is exercised. The device Connect control is
// never activated. Vendor navigation is fulfilled locally behind the launch
// fence, so neither the vendor site nor a hardware transport is contacted.
test('hardware purchase links are keyboard reachable for both vendors', async ({}, info) => {
  test.setTimeout(180_000);
  expect(['before', 'after']).toContain(mode);
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(process.env.PALI_TEST_DAPP_EXTENSION_PATH || '')).toBe(
    true
  );
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  if (mode === 'before') {
    expect(process.env.CI).toBeFalsy();
    expect(process.env.PALI_TEST_DAPP_REVISION).toBe(BEFORE_REVISION);
  }
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'HardwarePurchaseSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let hardware: Page | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const navigations: string[] = [];
  const observations: unknown[] = [];
  const warningMeasurements: unknown[] = [];
  try {
    wallet = await PaliWallet.launch('hardware-purchase-keyboard', {
      offlineHttpProxy: server.url,
      recordVideo: false,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    for (const vendor of vendors) {
      await wallet.context.route(vendor.url, async (route) => {
        expect(route.request().method()).toBe('GET');
        navigations.push(route.request().url());
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><title>Offline vendor link fixture</title><p>Offline vendor link fixture</p>',
        });
      });
    }
    await wallet.step('import a disposable synthetic wallet', async () => {
      await wallet!.importSeedAndCreatePassword();
      await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
      await wallet!.ensureOnHome();
    });

    for (const vendor of vendors) {
      for (const viewport of [
        { width: 400, height: 620 },
        { width: 320, height: 360 },
      ]) {
        const label = `${vendor.name.toLowerCase()}-${viewport.width}x${
          viewport.height
        }`;
        await wallet.step(
          `open ${vendor.name} hardware setup at ${viewport.width}px`,
          async (capture) => {
            await wallet!.gotoRoute('#/home');
            await wallet!.ensureOnHome();
            await wallet!.page
              .getByRole('button', {
                name: en.generalMenu.generalOptions,
                exact: true,
              })
              .click();
            const opened = wallet!.context.waitForEvent('page');
            await wallet!.page
              .getByRole('menuitem', {
                name: en.accountMenu.connectTrezor,
                exact: true,
              })
              .click();
            hardware = await opened;
            await expect(hardware).toHaveURL(
              /\/external\/settings\/account\/hardware$/
            );
            await hardware.setViewportSize(viewport);
            await hardware.locator(vendor.button).click();
            await expect(hardware.locator('#connect-btn')).toBeEnabled();
            await expect
              .poll(() =>
                hardware!.evaluate(() => document.activeElement?.tagName)
              )
              .toBe('BODY');
            const notice = hardware
              .getByText(en.settings.optimalExperience, { exact: true })
              .locator('..');
            const warningIcon = notice.locator('svg');
            await expect(warningIcon).toHaveCount(1);
            await hardware.mouse.move(viewport.width - 8, 16);
            await hardware.mouse.wheel(0, -5000);
            let previousNoticeTop: number | undefined;
            let noticeStable = 0;
            await expect
              .poll(
                async () => {
                  const top = (await notice.boundingBox())!.y;
                  noticeStable =
                    top === previousNoticeTop ? noticeStable + 1 : 0;
                  previousNoticeTop = top;
                  return noticeStable;
                },
                { intervals: [50] }
              )
              .toBeGreaterThanOrEqual(2);
            const warning = await warningIcon.evaluate((element) => {
              const box = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return {
                left: box.left,
                top: box.top,
                right: box.right,
                bottom: box.bottom,
                width: box.width,
                height: box.height,
                flexShrink: style.flexShrink,
              };
            });
            expect(warning.width).toBeGreaterThan(0);
            expect(warning.height).toBeGreaterThan(0);
            expect(warning.left).toBeGreaterThanOrEqual(0);
            expect(warning.top).toBeGreaterThanOrEqual(0);
            expect(warning.right).toBeLessThanOrEqual(viewport.width);
            expect(warning.bottom).toBeLessThanOrEqual(viewport.height);
            if (mode === 'after') {
              expect(warning.width).toBeCloseTo(20, 3);
              expect(warning.height).toBeCloseTo(20, 3);
            }
            warningMeasurements.push({
              vendor: vendor.name,
              viewport,
              mode,
              warning,
            });
            await info.attach(`${mode}-${label}-warning`, {
              body: await hardware.screenshot({ animations: 'disabled' }),
              contentType: 'image/png',
            });
            const buy = hardware.getByText(en.settings.buyNow, { exact: true });
            await expect(buy).toBeVisible();
            await hardware.mouse.move(viewport.width - 8, viewport.height - 16);
            await hardware.mouse.wheel(0, 5000);
            let previousTop: number | undefined;
            let stable = 0;
            await expect
              .poll(
                async () => {
                  const top = (await buy.boundingBox())!.y;
                  stable = top === previousTop ? stable + 1 : 0;
                  previousTop = top;
                  return stable;
                },
                { intervals: [50] }
              )
              .toBeGreaterThanOrEqual(2);
            await info.attach(`${mode}-${label}-selected`, {
              body: await hardware.screenshot({ animations: 'disabled' }),
              contentType: 'image/png',
            });
            await capture(hardware);
          }
        );

        await wallet.step(
          `check ${vendor.name} purchase keyboard controls at ${viewport.width}px`,
          async (capture) => {
            const buy = hardware!.getByText(en.settings.buyNow, {
              exact: true,
            });
            const connect = hardware!.locator('#connect-btn');
            const cancel = hardware!.getByRole('button', {
              name: en.buttons.cancel,
              exact: true,
            });
            await expect(connect).toBeEnabled();
            await expect(cancel).toBeEnabled();
            const semantics = await buy.evaluate((element) => ({
              tag: element.tagName,
              role: element.getAttribute('role'),
              tabIndex: (element as HTMLElement).tabIndex,
              href: element.getAttribute('href'),
              target: element.getAttribute('target'),
              rel: element.getAttribute('rel'),
              bounds: element.getBoundingClientRect().toJSON(),
            }));
            if (mode === 'before') {
              expect(semantics.tag).toBe('SPAN');
              expect(semantics.tabIndex).toBe(-1);
              await expect(
                hardware!.getByRole('link', {
                  name: en.settings.buyNow,
                  exact: true,
                })
              ).toHaveCount(0);
            } else {
              await expect(
                hardware!.getByRole('link', {
                  name: en.settings.buyNow,
                  exact: true,
                })
              ).toHaveCount(1);
              expect(semantics.tag).toBe('A');
              expect(semantics.href).toBe(vendor.url);
              expect(semantics.target).toBe('_blank');
              expect(semantics.rel?.split(/\s+/)).toEqual(
                expect.arrayContaining(['noopener', 'noreferrer'])
              );
            }
            const tabs: unknown[] = [];
            let buyFocused = false;
            let connectFocused = false;
            let cancelFocused = false;
            for (let index = 0; index < 8; index += 1) {
              await hardware!.keyboard.press('Tab');
              const focus = await buy.evaluate((element, cancelLabel) => {
                const active = document.activeElement;
                return {
                  tag: active?.tagName,
                  text: active?.textContent?.trim(),
                  id: active?.id,
                  buyFocused: active === element,
                  connectFocused: active?.id === 'connect-btn',
                  cancelFocused:
                    active?.tagName === 'BUTTON' &&
                    active.textContent?.trim() === cancelLabel,
                };
              }, en.buttons.cancel);
              tabs.push(focus);
              buyFocused ||= focus.buyFocused;
              connectFocused ||= focus.connectFocused;
              cancelFocused ||= focus.cancelFocused;
              if (index === 0) {
                await info.attach(`${mode}-${label}-first-tab`, {
                  body: await hardware!.screenshot({ animations: 'disabled' }),
                  contentType: 'image/png',
                });
              }
            }
            expect(buyFocused).toBe(mode === 'after');
            expect(connectFocused).toBe(true);
            expect(cancelFocused).toBe(true);
            observations.push({
              vendor: vendor.name,
              viewport,
              mode,
              semantics,
              tabs,
            });
            await capture(hardware!);

            if (mode === 'after') {
              for (let index = 0; index < 8; index += 1) {
                if (
                  await buy.evaluate(
                    (element) => element === document.activeElement
                  )
                )
                  break;
                await hardware!.keyboard.press('Tab');
              }
              await expect(buy).toBeFocused();
            }
            const opened = wallet!.context.waitForEvent('page');
            if (mode === 'before') await buy.click();
            else await hardware!.keyboard.press('Enter');
            const vendorPage = await opened;
            await expect(vendorPage).toHaveURL(vendor.url);
            await expect(vendorPage.locator('body')).toHaveText(
              'Offline vendor link fixture'
            );
            if (mode === 'after')
              expect(
                await vendorPage.evaluate(() => window.opener === null)
              ).toBe(true);
            expect(navigations.at(-1)).toBe(vendor.url);
            await vendorPage.close();
            await expect(connect).toBeEnabled();
            await expect(cancel).toBeEnabled();
          }
        );

        await wallet.step(
          `close idle ${vendor.name} setup without connecting`,
          async (capture) => {
            await capture(hardware!);
            const closing = hardware!.waitForEvent('close');
            await clickClosingPopup({
              click: () =>
                hardware!
                  .getByRole('button', { name: en.buttons.cancel, exact: true })
                  .click(),
              isClosed: () => hardware!.isClosed(),
            });
            await closing;
            hardware = undefined;
            expect(wallet!.page.isClosed()).toBe(false);
          }
        );
      }
    }
    await wallet.step(
      'verify local vendor fixtures and read-only wallet behavior',
      async () => {
        expect(navigations).toEqual(
          vendors.flatMap((vendor) => [vendor.url, vendor.url])
        );
        expect(routes.deniedWrites).toEqual([]);
        await info.attach('hardware-purchase-keyboard-evidence', {
          contentType: 'application/json',
          body: JSON.stringify(
            {
              mode,
              runtime: extensionEvidence(),
              observations,
              warningMeasurements,
              navigations,
              fixtureDeniedWrites: routes.deniedWrites,
              proxyDeniedConnections: server.blocked.length,
              hardwareDeviceExercised: false,
              hardwareConnectClicked: false,
              vendorResponsesFulfilledLocally: true,
              controllerStateReplaced: false,
              controllerRepliesReplaced: false,
            },
            null,
            2
          ),
        });
      }
    );
    status = 'passed';
  } finally {
    try {
      if (hardware && !hardware.isClosed()) await hardware.close();
      await wallet?.dispose(status);
    } finally {
      await server.close();
      Object.assign(E2E_CONFIG, previous);
    }
  }
});
