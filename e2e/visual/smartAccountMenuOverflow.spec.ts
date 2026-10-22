import { expect, test, type Locator } from '@playwright/test';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const exposed = (control: Locator) =>
  control.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (
      let parent = node.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      const style = getComputedStyle(parent),
        bounds = parent.getBoundingClientRect();
      if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
        clip.top = Math.max(clip.top, bounds.top + parent.clientTop);
        clip.bottom = Math.min(
          clip.bottom,
          bounds.top + parent.clientTop + parent.clientHeight
        );
      }
      if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
        clip.left = Math.max(clip.left, bounds.left + parent.clientLeft);
        clip.right = Math.min(
          clip.right,
          bounds.left + parent.clientLeft + parent.clientWidth
        );
      }
    }
    return (
      box.width > 0 &&
      box.height > 0 &&
      box.left >= clip.left - 0.5 &&
      box.right <= clip.right + 0.5 &&
      box.top >= clip.top - 0.5 &&
      box.bottom <= clip.bottom + 0.5 &&
      [
        [box.left + 2, box.top + box.height / 2],
        [box.right - 2, box.top + box.height / 2],
        [box.left + box.width / 2, box.top + 2],
        [box.left + box.width / 2, box.bottom - 2],
      ].every(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return hit === node || node.contains(hit);
      })
    );
  });

test('long smart-account chooser and module hub keep final actions reachable in short windows', async ({}, info) => {
  test.setTimeout(180_000);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'SyntheticLongSmartMenuOnly!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('qa117-long-smart-account-menus', {
      offlineHttpProxy: server.url,
    });
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    const errors: string[] = [];
    for (const viewport of [
      { width: 320, height: 360 },
      { width: 400, height: 480 },
    ]) {
      const page = await wallet.context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setViewportSize(viewport);
      await page.addInitScript(() => {
        const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
        const metadata = {
          chainId: 57057,
          isDeployed: true,
          auth: { module: 'ecdsa', validator: address(500), data: '0x' },
          installedModules: [
            {
              type: 'validator',
              id: 'ecdsa',
              address: address(500),
              data: '0x',
              config: { owners: [address(999)], threshold: 1 },
            },
            ...Array.from({ length: 30 }, (_, index) => ({
              type: 'validator',
              id: 'custom',
              address: address(600 + index),
              data: '0x',
              config: {
                name: `Synthetic custom validator ${index + 1}`,
                compositeCompatible: false,
              },
            })),
          ],
        };
        const qa = ((window as any).__qa117LongSmart = {
          mode: 'chooser',
          raw: null,
          listeners: [] as any[],
          denied: [] as string[],
          emit: (): void => undefined,
        });
        const transform = (state: any) => {
          if (!state?.vault) return state;
          qa.raw = state;
          const next = structuredClone(state);
          next.vault.accounts.SmartAccount = Object.fromEntries(
            Array.from({ length: 80 }, (_, id) => [
              id,
              {
                id,
                address: address(id + 100),
                label: `Synthetic smart account ${String(id + 1).padStart(
                  2,
                  '0'
                )}`,
                isSmartAccount: true,
                smartAccount: metadata,
                balances: { ethereum: 0, syscoin: 0 },
              },
            ])
          );
          next.vault.activeAccount = {
            id: 0,
            type: qa.mode === 'chooser' ? 'HDAccount' : 'SmartAccount',
          };
          next.vault.activeNetwork = {
            chainId: 57057,
            currency: 'TSYS',
            kind: 'ethereum',
            label: 'Synthetic long-menu network',
            slip44: 60,
            url: 'https://qa117-long-menu.invalid/rpc',
          };
          next.vault.isBitcoinBased = false;
          next.vaultGlobal.activeSlip44 = 60;
          next.vaultGlobal.networkStatus = 'connected';
          next.vaultGlobal.isSwitchingAccount = false;
          return next;
        };
        qa.emit = () =>
          qa.listeners.forEach((listener) =>
            listener({
              type: 'CONTROLLER_STATE_CHANGE',
              data: transform(qa.raw),
            })
          );
        const send = chrome.runtime.sendMessage.bind(chrome.runtime);
        chrome.runtime.sendMessage = ((...args: any[]) => {
          const [message, callback] = args;
          const reply = (value: any) =>
            typeof callback === 'function'
              ? queueMicrotask(() => callback(value))
              : Promise.resolve(value);
          if (message?.type === 'getCurrentState')
            return typeof callback === 'function'
              ? (send as any)(message, (state: any) =>
                  callback(transform(state))
                )
              : (send as any)(message).then(transform);
          if (
            message?.type === 'CONTROLLER_ACTION' &&
            message.data?.methods?.[0] === 'wallet'
          ) {
            const method = message.data.methods[1];
            if (method === 'hydrateSmartAccount') return reply(metadata);
            if (method === 'getSLHDSASmartAccountSetupStatus')
              return reply(null);
            if (method === 'getSmartAccountGuardianRecoveryStatus')
              return reply({
                account: message.data.params?.[0]?.account || address(100),
                chainId: 57057,
                moduleAddress: '0x8F919FC9A92da490d305054BfD862379D2760F84',
                exists: false,
                delay: '0',
                delaySeconds: 0,
                expirationSeconds: 0,
                guardians: [],
                guardianCount: '0',
                threshold: 0,
                policyEpoch: '0',
                observedBlock: {
                  number: 100,
                  hash: '0x' + '11'.repeat(32),
                  timestamp: 1800000000,
                },
                active: null,
                pending: null,
                knownOperation: null,
              });
            if (
              /^(?:sign|send|deploy|install|uninstall|rotate|add|remove|register|start|finalize|prepare|setAccount|create)/i.test(
                method
              )
            ) {
              qa.denied.push(method);
              return reply({
                error: 'Synthetic long-menu fixture forbids wallet mutation',
              });
            }
          }
          return (send as any)(...args);
        }) as typeof chrome.runtime.sendMessage;
        const add = chrome.runtime.onMessage.addListener.bind(
          chrome.runtime.onMessage
        );
        const remove = chrome.runtime.onMessage.removeListener.bind(
          chrome.runtime.onMessage
        );
        const wrappers = new Map<any, any>();
        chrome.runtime.onMessage.addListener = (listener: any) => {
          qa.listeners.push(listener);
          const wrapper = (message: any, ...rest: any[]) => {
            if (message?.type === 'CONTROLLER_STATE_CHANGE')
              return listener(
                { ...message, data: transform(message.data) },
                ...rest
              );
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
          wrappers.set(listener, wrapper);
          add(wrapper);
        };
        chrome.runtime.onMessage.removeListener = (listener: any) => {
          qa.listeners = qa.listeners.filter((item: any) => item !== listener);
          remove(wrappers.get(listener) || listener);
          wrappers.delete(listener);
        };
      });
      await page.goto(wallet.appUrl('#/home/smart-account'));
      const choose = page.getByRole('button', {
        name: en.smartAccountHub.chooseAccount,
        exact: true,
      });
      await expect(choose).toBeVisible();
      await choose.click();
      const dialog = page.getByRole('dialog', {
        name: en.smartAccountHub.chooseAccount,
      });
      await expect(dialog).toBeVisible();
      expect(
        await dialog.locator('[data-testid^="smart-account-option-"]').count()
      ).toBe(50);
      const cancel = dialog.getByRole('button', {
        name: en.buttons.cancel,
        exact: true,
      });
      await expect.poll(() => exposed(cancel)).toBe(true);
      const more = dialog.getByRole('button', {
        name: en.buttons.loadMore,
        exact: true,
      });
      await more.scrollIntoViewIfNeeded();
      await expect.poll(() => exposed(more)).toBe(true);
      await more.click();
      const last = dialog.getByTestId('smart-account-option-79');
      await expect(last).toBeAttached();
      await last.scrollIntoViewIfNeeded();
      await expect.poll(() => exposed(last)).toBe(true);
      const search = dialog.getByRole('searchbox', {
        name: en.connections.searchAccounts,
      });
      await search.focus();
      for (let i = 0; i < 81; i++) await page.keyboard.press('Tab');
      await expect(cancel).toBeFocused();
      await expect.poll(() => exposed(cancel)).toBe(true);
      await info.attach(
        `long-smart-account-chooser-${viewport.width}x${viewport.height}`,
        {
          body: await page.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        }
      );
      await page.keyboard.press('Enter');
      await expect(dialog).toHaveCount(0);
      await expect(choose).toBeFocused();
      await page.evaluate(() => {
        const qa = (window as any).__qa117LongSmart;
        qa.mode = 'hub';
        qa.emit();
      });
      await expect(
        page.locator('li').filter({ hasText: 'Synthetic custom validator 30' })
      ).toHaveCount(1);
      const recovery = page.getByRole('button', {
        name: en.settings.smartAccountGuardianRecoveryTitle,
      });
      const infrastructure = page.getByRole('button', {
        name: en.smartAccountHub.infrastructure,
      });
      await infrastructure.scrollIntoViewIfNeeded();
      await expect.poll(() => exposed(recovery)).toBe(true);
      await expect.poll(() => exposed(infrastructure)).toBe(true);
      await recovery.focus();
      await page.keyboard.press('Tab');
      await expect(infrastructure).toBeFocused();
      await expect.poll(() => exposed(infrastructure)).toBe(true);
      await info.attach(
        `long-smart-account-hub-${viewport.width}x${viewport.height}`,
        {
          body: await page.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        }
      );
      expect(
        await page.evaluate(() => (window as any).__qa117LongSmart.denied)
      ).toEqual([]);
      await page.close();
    }
    expect(routes.deniedWrites).toEqual([]);
    expect(errors).toEqual([]);
    if (test.info().errors.length === 0) status = 'passed';
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
});
