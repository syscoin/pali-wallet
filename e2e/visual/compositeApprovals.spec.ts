import {
  type Locator,
  type Page,
  type TestInfo,
  expect,
  test,
} from '@playwright/test';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const address = (value: number) => `0x${value.toString(16).padStart(40, '0')}`;
const outputDirectory =
  process.env.PALI_COMPOSITE_VISUAL_OUTPUT ||
  path.join(E2E_CONFIG.artifactsDir, 'composite-approvals');
const metadata = {
  auth: { data: '0x', module: 'composite', validator: address(3) },
  chainId: 57057,
  contractVersion: 'synthetic-visual-fixture',
  deploymentSalt: '0x' + '00'.repeat(32),
  isDeployed: true,
  installedModules: [
    {
      address: address(1),
      config: { owners: [address(80)], threshold: 1 },
      data: '0x',
      id: 'ecdsa',
      type: 'validator',
    },
    {
      address: address(2),
      config: {
        keyId: 'synthetic-only',
        parameterSet: 'SLH-DSA-SHA2-128-24',
        pkRoot: '0x' + '11'.repeat(16),
        pkSeed: '0x' + '22'.repeat(16),
        signatureLimit: 1,
      },
      data: '0x',
      id: 'slh-dsa',
      type: 'validator',
    },
    {
      address: address(3),
      config: { childValidators: [address(1), address(2)], threshold: 2 },
      data: '0x',
      id: 'composite',
      type: 'validator',
    },
  ],
};

const visibleHitTarget = (locator: Locator) =>
  locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const target = document.elementFromPoint(
      box.x + box.width / 2,
      box.y + box.height / 2
    );
    return (
      box.width > 0 &&
      box.height > 0 &&
      box.x >= 0 &&
      box.y >= 0 &&
      box.right <= innerWidth &&
      box.bottom <= innerHeight &&
      !!target &&
      (target === element || element.contains(target))
    );
  });

const expectReadableContrast = async (locator: Locator) => {
  const result = await locator.evaluate((element) => {
    const rgba = (value: string) => {
      const channels = value.match(/[\d.]+/g)!.map(Number);
      return [channels[0], channels[1], channels[2], channels[3] ?? 1];
    };
    const blend = (foreground: number[], background: number[]) => [
      ...foreground
        .slice(0, 3)
        .map(
          (channel, index) =>
            channel * foreground[3] + background[index] * (1 - foreground[3])
        ),
      1,
    ];
    const ancestors: Element[] = [];
    for (
      let current: Element | null = element;
      current;
      current = current.parentElement
    )
      ancestors.unshift(current);
    const background = ancestors.reduce(
      (color, ancestor) =>
        blend(rgba(getComputedStyle(ancestor).backgroundColor), color),
      [255, 255, 255, 1]
    );
    const foreground = blend(rgba(getComputedStyle(element).color), background);
    const luminance = (color: number[]) =>
      color.slice(0, 3).reduce((sum, channel, index) => {
        const value = channel / 255;
        return (
          sum +
          (value <= 0.04045
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4) *
            [0.2126, 0.7152, 0.0722][index]
        );
      }, 0);
    const light = luminance(foreground),
      dark = luminance(background);
    return {
      foreground,
      background,
      ratio: (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05),
      text: element.textContent,
    };
  });
  expect(
    result.ratio,
    `Readable text contrast: ${JSON.stringify(result)}`
  ).toBeGreaterThanOrEqual(4.5);
};

const expectCenteredPanel = async (panel: Locator, page: Page) => {
  const viewport = page.viewportSize()!;
  const bounds = (await panel.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(15.5);
  expect(bounds.y).toBeGreaterThanOrEqual(15.5);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - 15.5);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height - 15.5);
  expect(
    Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2)
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(bounds.y + bounds.height / 2 - viewport.height / 2)
  ).toBeLessThanOrEqual(1);
};

const capture = async (page: Page, name: string, info: TestInfo) => {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const file = path.join(outputDirectory, `${name}.png`);
  await page.mouse.move(0, 0);
  await page.screenshot({ animations: 'disabled', path: file });
  await info.attach(name, { contentType: 'image/png', path: file });
};

// A real built extension and normal disposable-wallet onboarding, with only
// renderer read responses changed to supply a synthetic deployed account.
// Nothing is installed, signed, submitted or written to a real account.
test('Combined approvals: isolated real-extension interaction and layout', async ({}, info) => {
  test.setTimeout(180_000);
  const originalConfig = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  const pageErrors: string[] = [];
  const publicSuccesses: string[] = [];
  let wallet: PaliWallet | undefined;
  let page: Page | undefined;
  let routes: Awaited<ReturnType<typeof installUtxoFixtureRoutes>> | undefined;
  Object.assign(E2E_CONFIG, {
    ...(process.env.PALI_TEST_DAPP_EXTENSION_PATH
      ? { extensionPath: process.env.PALI_TEST_DAPP_EXTENSION_PATH }
      : {}),
    password: 'CompositeSyntheticOnly!2026',
    rpcUrl: server.url,
    seedPhrase: UTXO_FIXTURE_SEED,
  });
  try {
    wallet = await PaliWallet.launch('composite-approvals-offline', {
      offlineHttpProxy: server.url,
      viewport: { height: 800, width: 600 },
    });
    routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    wallet.context.on('response', (response) => {
      const url = new URL(response.url());
      if (
        ['http:', 'https:'].includes(url.protocol) &&
        response.ok() &&
        url.origin !== server.url &&
        ![
          'https://explorer-blockbook-dev.syscoin.org',
          'https://blockbook-dev.syscoin.org',
        ].includes(url.origin)
      )
        publicSuccesses.push(response.url());
    });
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();

    page = await wallet.context.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.addInitScript(
      ({ fixtureMetadata, accountAddress }) => {
        const readCalls: string[] = [];
        const deniedActions: string[] = [];
        (window as any).__compositeVisual = { deniedActions, readCalls };
        const fixtureState = (state: any) => {
          if (!state?.vault || !state?.vaultGlobal) return state;
          const result = structuredClone(state);
          result.vault.accounts.SmartAccount = {
            0: {
              address: accountAddress,
              balances: { ethereum: 0, syscoin: 0 },
              id: 0,
              isSmartAccount: true,
              label: 'Synthetic approval account',
              smartAccount: fixtureMetadata,
              type: 'SmartAccount',
            },
          };
          result.vault.activeAccount = { id: 0, type: 'SmartAccount' };
          result.vault.activeNetwork = {
            chainId: 57057,
            currency: 'TSYS',
            kind: 'ethereum',
            label: 'Synthetic offline network',
            slip44: 60,
            url: 'https://composite-ui.invalid/rpc',
          };
          result.vault.isBitcoinBased = false;
          result.vaultGlobal.activeSlip44 = 60;
          result.vaultGlobal.isSwitchingAccount = false;
          result.vaultGlobal.networkStatus = 'connected';
          return result;
        };
        const sendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
        chrome.runtime.sendMessage = ((...args: any[]) => {
          const [message, callback] = args;
          const reply = (value: any) => {
            if (typeof callback === 'function') {
              queueMicrotask(() => callback(value));
              return;
            }
            return Promise.resolve(value);
          };
          if (message?.type === 'getCurrentState') {
            readCalls.push('getCurrentState');
            if (typeof callback === 'function')
              return (sendMessage as any)(message, (state: any) =>
                callback(fixtureState(state))
              );
            return (sendMessage as any)(message).then(fixtureState);
          }
          if (
            message?.type === 'CONTROLLER_ACTION' &&
            message.data?.methods?.length === 2 &&
            message.data.methods[0] === 'wallet'
          ) {
            const method = message.data.methods[1];
            if (
              method === 'hydrateSmartAccount' &&
              message.data.params?.length === 1 &&
              message.data.params[0] === 0 &&
              location.hash === '#/home/smart-account'
            ) {
              readCalls.push(method);
              return reply(fixtureMetadata);
            }
            if (
              /^(?:sign|send|deploy|install|uninstall|rotate|addSmartAccount|removeSmartAccount)/i.test(
                method
              )
            ) {
              deniedActions.push(method);
              return reply({
                error: 'Synthetic visual fixture forbids writes',
              });
            }
          }
          return (sendMessage as any)(...args);
        }) as typeof chrome.runtime.sendMessage;
        const addListener = chrome.runtime.onMessage.addListener.bind(
          chrome.runtime.onMessage
        );
        const removeListener = chrome.runtime.onMessage.removeListener.bind(
          chrome.runtime.onMessage
        );
        const wrapped = new Map<any, any>();
        chrome.runtime.onMessage.addListener = (listener: any) => {
          const wrapper = (message: any, ...rest: any[]) => {
            if (message?.type === 'CONTROLLER_STATE_CHANGE')
              return listener(
                { ...message, data: fixtureState(message.data) },
                ...rest
              );
            // Keep background updates for the real HD account from replacing
            // this renderer-only synthetic account. Controller status stays real.
            if (
              [
                'CONTROLLER_ACCOUNTS_CHANGE',
                'CONTROLLER_ACTIVE_ACCOUNT_CHANGE',
                'CONTROLLER_NETWORK_CHANGE',
                'CONTROLLER_ACCOUNT_BALANCE_CHANGE',
              ].includes(message?.type)
            )
              return false;
            return listener(message, ...rest);
          };
          wrapped.set(listener, wrapper);
          addListener(wrapper);
        };
        chrome.runtime.onMessage.removeListener = (listener: any) => {
          removeListener(wrapped.get(listener) || listener);
          wrapped.delete(listener);
        };
      },
      { accountAddress: address(100), fixtureMetadata: metadata }
    );
    await page.goto(wallet.appUrl('#/home/smart-account'));
    const hubRow = page.locator('li').filter({
      hasText: en.smartAccountHub.compositeHint,
    });
    const edit = hubRow.getByRole('button', { name: en.smartAccountHub.edit });
    await expect(edit).toBeEnabled();
    await edit.click();
    const dialog = page.getByRole('dialog', {
      name: en.settings.compositeAuthenticator,
    });
    await expect(dialog).toBeVisible();
    const save = dialog.getByRole('button', {
      name: en.smartAccountHub.compositeSavePolicy,
    });
    const threshold = dialog.getByRole('combobox', {
      name: en.smartAccountHub.compositeThreshold,
    });
    const summary = dialog.getByRole('status');
    await expect(threshold).toHaveValue('2');
    await expect(summary).toContainText('All 2 selected methods must approve.');
    await expect(summary).toContainText(
      en.smartAccountHub.compositeRecoveryHint
    );
    await expect(save).toBeEnabled();
    for (const text of [
      en.settings.ecdsaAuthenticator,
      en.settings.slhDsaAuthenticator,
      en.smartAccountHub.compositeEcdsaDescription,
      en.smartAccountHub.compositeSlhDescription,
    ]) {
      await expectReadableContrast(dialog.getByText(text, { exact: true }));
    }
    await expectReadableContrast(save);
    await capture(page, '600x800-two-of-two', info);

    await threshold.selectOption('1');
    await expect(summary).toContainText(en.smartAccountHub.compositeAnyOne);
    await expect(summary).not.toContainText(
      en.smartAccountHub.compositeRecoveryHint
    );
    await capture(page, '600x800-any-one', info);

    // Native keyboard selection must update the same real form controls.
    const ecdsa = dialog.getByRole('checkbox', {
      name: en.settings.ecdsaAuthenticator,
    });
    const slh = dialog.getByRole('checkbox', {
      name: en.settings.slhDsaAuthenticator,
    });
    await ecdsa.focus();
    await page.keyboard.press('Space');
    await expect(ecdsa).not.toBeChecked();
    await expect(summary).toContainText(
      en.smartAccountHub.compositeSingleRequired
    );
    await slh.uncheck();
    await expect(summary).toContainText(
      en.smartAccountHub.compositeSelectMethods
    );
    await expect(threshold).toBeDisabled();
    await expect(save).toBeDisabled();
    await capture(page, '600x800-empty-selection', info);
    await ecdsa.check();
    await slh.check();
    await threshold.selectOption('2');

    for (const viewport of [
      { height: 800, width: 600 },
      { height: 480, width: 400 },
    ]) {
      await page.setViewportSize(viewport);
      const panel = dialog.locator('form').locator('..');
      await expect(panel).toBeInViewport({ ratio: 1 });
      await expectCenteredPanel(panel, page);
      expect(await visibleHitTarget(save)).toBe(true);
      const cancel = dialog.getByRole('button', { name: en.buttons.cancel });
      expect(await visibleHitTarget(cancel)).toBe(true);
      const close = dialog.getByRole('button', { name: en.buttons.close });
      expect(await visibleHitTarget(close)).toBe(true);
      expect(
        await panel.evaluate(
          (element) => element.scrollWidth <= element.clientWidth
        )
      ).toBe(true);
      await capture(page, `${viewport.width}x${viewport.height}-fit`, info);
      if (viewport.height === 480) {
        const scrollBody = dialog.locator('form > div');
        await scrollBody.evaluate((element) => {
          element.scrollTop = 0;
        });
        const bounds = (await scrollBody.boundingBox())!;
        await page.mouse.move(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2
        );
        await page.mouse.wheel(0, 800);
        await expect(threshold).toBeInViewport({ ratio: 1 });
        expect(await visibleHitTarget(save)).toBe(true);
        await capture(page, '400x480-rule-scrolled', info);
      }
    }
    // Focus must remain in the modal, and Escape restores the launch control.
    for (let step = 0; step < 9; step++) {
      await page.keyboard.press('Tab');
      expect(
        await dialog.evaluate((element) =>
          element.contains(document.activeElement)
        )
      ).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(edit).toBeFocused();
    await edit.press('Enter');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: en.buttons.cancel }).click();
    await expect(dialog).toHaveCount(0);

    for (const language of ['es', 'pt', 'fr', 'de', 'zh', 'ja', 'ko', 'ru']) {
      await test.step(`compact translated dialog: ${language}`, async () => {
        const translations = JSON.parse(
          fs.readFileSync(
            path.join(
              E2E_CONFIG.repoRoot,
              `source/assets/locales/${language}.json`
            ),
            'utf8'
          )
        );
        await page!.evaluate(
          (locale) =>
            new Promise<void>((resolve) =>
              chrome.storage.local.set({ language: locale }, resolve)
            ),
          language
        );
        await page!.reload();
        const launch = page!
          .locator('li')
          .filter({
            hasText: translations.smartAccountHub.compositeHint,
          })
          .getByRole('button', { name: translations.smartAccountHub.edit });
        await expect(launch).toBeEnabled();
        await launch.click();
        const translatedDialog = page!.getByRole('dialog', {
          name: translations.settings.compositeAuthenticator,
        });
        await expect(translatedDialog).toBeVisible();
        const panel = translatedDialog.locator('form').locator('..');
        await expect(panel).toBeInViewport({ ratio: 1 });
        await expectCenteredPanel(panel, page!);
        const translatedSave = translatedDialog.getByRole('button', {
          name: translations.smartAccountHub.compositeSavePolicy,
        });
        expect(await visibleHitTarget(translatedSave)).toBe(true);
        expect(
          await visibleHitTarget(
            translatedDialog.getByRole('button', {
              name: translations.buttons.close,
            })
          )
        ).toBe(true);
        expect(
          await panel.evaluate(
            (element) => element.scrollWidth <= element.clientWidth
          )
        ).toBe(true);
        await capture(page!, `400x480-${language}`, info);
        await page!.keyboard.press('Escape');
        await expect(translatedDialog).toHaveCount(0);
      });
    }

    const renderer = await page.evaluate(
      () => (window as any).__compositeVisual
    );
    expect(renderer.readCalls).toContain('getCurrentState');
    expect(renderer.readCalls).toContain('hydrateSmartAccount');
    expect(renderer.deniedActions).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    expect(publicSuccesses).toEqual([]);
    expect(pageErrors).toEqual([]);
    fs.mkdirSync(outputDirectory, { recursive: true });
    const evidenceFile = path.join(outputDirectory, 'evidence.json');
    fs.writeFileSync(
      evidenceFile,
      JSON.stringify(
        {
          pageErrors,
          publicSuccesses,
          renderer,
          deniedWrites: routes.deniedWrites,
          deniedUnknown: routes.deniedUnknown,
          deniedProxyRequests: server.blocked,
          sourceRevision: process.env.PALI_TEST_DAPP_REVISION,
          extensionPath: E2E_CONFIG.extensionPath,
        },
        null,
        2
      )
    );
    await info.attach('offline-fixture-evidence', {
      contentType: 'application/json',
      path: evidenceFile,
    });
  } catch (error) {
    if (page && !page.isClosed()) {
      await capture(page, 'failure', info).catch(() => undefined);
      await info.attach('failure-browser-evidence', {
        body: JSON.stringify(
          {
            pageErrors,
            publicSuccesses,
            deniedWrites: routes?.deniedWrites,
            deniedUnknown: routes?.deniedUnknown,
            deniedProxyRequests: server.blocked,
          },
          null,
          2
        ),
        contentType: 'application/json',
      });
    }
    throw error;
  } finally {
    await page?.close().catch(() => undefined);
    await wallet?.context.close().catch(() => undefined);
    await server.close();
    Object.assign(E2E_CONFIG, originalConfig);
  }
});
