import { expect, test } from '@playwright/test';

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

test('module consent wraps long requests and drops stale checks after identity changes', async ({}, info) => {
  test.setTimeout(150_000);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'SyntheticModuleConsentOnly!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('qa117-module-consent', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 480 },
    });
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    const page = await wallet.context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const address = (value: string) => `0x${value.repeat(40)}`;
      const metadata = {
        auth: { validator: address('2'), module: 'ecdsa', data: '0x' },
        chainId: 57057,
        isDeployed: true,
        installedModules: [
          {
            address: address('2'),
            type: 'validator',
            id: 'ecdsa',
            data: '0x',
            config: { owners: [address('7')], threshold: 1 },
          },
        ],
      };
      const qa = ((window as any).__qa117Module = {
        id: 0,
        rpc: 'https://qa117-a.invalid/rpc',
        fail: false,
        raw: null,
        listeners: [] as Array<(message: any) => void>,
        checks: 0,
        mutations: [] as string[],
        emit: (): void => undefined,
      });
      const transform = (state: any) => {
        if (!state?.vault) return state;
        qa.raw = state;
        const value = structuredClone(state);
        value.vault.accounts.SmartAccount = Object.fromEntries(
          [0, 1].map((id) => [
            id,
            {
              id,
              type: 'SmartAccount',
              isSmartAccount: true,
              address: address(id === 0 ? '1' : '4'),
              label: `Synthetic account ${id}`,
              smartAccount: metadata,
              balances: { ethereum: 0, syscoin: 0 },
            },
          ])
        );
        value.vault.activeAccount = { id: qa.id, type: 'SmartAccount' };
        value.vault.activeNetwork = {
          chainId: 57057,
          kind: 'ethereum',
          currency: 'TSYS',
          label: 'Synthetic',
          url: qa.rpc,
          slip44: 60,
        };
        value.vault.isBitcoinBased = false;
        value.vaultGlobal.activeSlip44 = 60;
        value.vaultGlobal.networkStatus = 'connected';
        value.vaultGlobal.isSwitchingAccount = false;
        return value;
      };
      qa.emit = () =>
        qa.listeners.forEach((listener: any) =>
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
            ? (send as any)(message, (state: any) => callback(transform(state)))
            : (send as any)(message).then(transform);
        if (
          message?.type === 'CONTROLLER_ACTION' &&
          message.data?.methods?.[0] === 'wallet'
        ) {
          const method = message.data.methods[1];
          if (method === 'hydrateSmartAccount')
            return reply(
              qa.fail
                ? { error: 'Synthetic current-account check unavailable' }
                : metadata
            );
          if (method === 'preflightSmartAccountCustomValidator') {
            qa.checks++;
            return reply(
              qa.fail
                ? { error: 'Synthetic current-account check unavailable' }
                : { ok: true, failures: [], compositeCompatible: true }
            );
          }
          if (
            /^(?:sign|send|deploy|install|uninstall|rotate|add|remove|register|start|finalize|prepare)/i.test(
              method
            )
          ) {
            qa.mutations.push(method);
            return reply({
              error: 'Synthetic module fixture forbids wallet mutation',
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
    const host = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(
      63
    )}.${'d'.repeat(52)}.invalid`;
    const name = 'Synthetic_Validator_'.repeat(24);
    const request = {
      host,
      action: 'install',
      module: { address: `0x${'3'.repeat(40)}`, name },
    };
    await page.goto(
      `chrome-extension://${
        wallet.extensionId
      }/external.html?route=smart-account-modules&data=${encodeURIComponent(
        JSON.stringify(request)
      )}`
    );
    await expect(page.getByRole('checkbox')).toBeVisible();
    for (const viewport of [
      { width: 320, height: 360 },
      { width: 400, height: 480 },
    ]) {
      await page.setViewportSize(viewport);
      for (const value of [host, name]) {
        const content = page.getByText(value, { exact: true });
        expect
          .soft(
            await content.evaluate((node) => {
              const rect = node.getBoundingClientRect();
              return (
                rect.left >= 0 &&
                rect.right <= innerWidth &&
                node.scrollWidth <= node.clientWidth + 1
              );
            }),
            `${viewport.width}px request text fits: ${value.slice(0, 20)}`
          )
          .toBe(true);
      }
      for (const label of ['Cancel', 'Confirm']) {
        const button = page.getByRole('button', { name: label, exact: true });
        expect(
          await button.evaluate((node) => {
            const box = node.getBoundingClientRect();
            return (
              box.left >= 0 &&
              box.right <= innerWidth &&
              box.top >= 0 &&
              box.bottom <= innerHeight
            );
          }),
          `${label} action fits`
        ).toBe(true);
      }
      await info.attach(`module-request-${viewport.width}x${viewport.height}`, {
        body: await page.screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      });
    }
    const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
    await page.getByRole('checkbox').check();
    await expect(confirm).toBeEnabled();
    await page.evaluate(() => {
      const qa = (window as any).__qa117Module;
      qa.id = 1;
      qa.fail = true;
      qa.emit();
    });
    await expect(
      page.getByText('Synthetic current-account check unavailable', {
        exact: true,
      })
    ).toBeVisible();
    await expect(confirm).toBeDisabled();
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await page.evaluate(() => {
      const qa = (window as any).__qa117Module;
      qa.rpc = 'https://qa117-b.invalid/rpc';
      qa.fail = false;
      qa.emit();
    });
    await expect(page.getByRole('checkbox')).toBeVisible();
    await expect(page.getByRole('checkbox')).not.toBeChecked();
    await expect(confirm).toBeDisabled();
    expect(
      await page.evaluate(() => (window as any).__qa117Module.mutations)
    ).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
    status = info.errors.length === 0 ? 'passed' : 'failed';
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
