import { expect, test, type Locator, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

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

const revealReviewText = async (page: Page, element: Locator) => {
  const height = page.viewportSize()!.height;
  const top = 50; // The title-only approval banner remains above the review.
  const bottom = await page
    .getByRole('button', { name: 'Cancel', exact: true })
    .evaluate(
      (button) => button.closest('.fixed')!.getBoundingClientRect().top
    );
  await page.mouse.move(
    page.viewportSize()!.width / 2,
    Math.min(180, height / 2)
  );
  for (let step = 0; step < 18; step++) {
    const box = (await element.boundingBox())!;
    if (box.y >= top && box.y + box.height <= bottom) return true;
    const delta =
      box.y < top ? box.y - top - 2 : box.y + box.height - bottom + 2;
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(60);
  }
  return false;
};

// Open the real extension's review UI with read-only synthetic renderer state.
// No approval queue or signing action is created, and the launch-time deny proxy
// fences all external traffic even before page-level fixture routes start.
test('signature review retains long origins and labels in short narrow windows', async ({}, info) => {
  test.setTimeout(150_000);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  const fixture = createIsolatedVaultFixture();
  const accountAddress = fixture.evmAddresses[0];
  const accountLabel = 'SyntheticAccount'.repeat(4);
  const host = `${'a'.repeat(63)}.${'b'.repeat(63)}.example.invalid`;
  const directory = path.join(E2E_CONFIG.artifactsDir, 'dialog-edge-qa');
  fs.mkdirSync(directory, { recursive: true });
  let wallet: PaliWallet | undefined;
  Object.assign(E2E_CONFIG, {
    extensionPath:
      process.env.PALI_TEST_DAPP_EXTENSION_PATH || E2E_CONFIG.extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'SyntheticDialogEdgeOnly!2026',
    rpcUrl: server.url,
  });
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('dialog-edge-qa', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    const page = await wallet.context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(
      ({ accountAddress: rendererAddress, accountLabel: rendererLabel }) => {
        const deniedActions: string[] = [];
        (window as any).__dialogEdgeQa = { deniedActions };
        const transform = (state: any) => {
          if (!state?.vault || !state?.vaultGlobal) return state;
          const result = structuredClone(state);
          const active = result.vault.activeAccount;
          const account = result.vault.accounts[active.type][active.id];
          account.address = rendererAddress;
          account.label = rendererLabel;
          account.balances = { ethereum: 0, syscoin: 0 };
          result.vault.activeNetwork = {
            chainId: 5700,
            currency: 'TSYS',
            kind: 'ethereum',
            label: 'Synthetic offline EVM',
            slip44: 60,
            url: 'https://rpc.tanenbaum.io',
          };
          result.vault.isBitcoinBased = false;
          result.vaultGlobal.activeSlip44 = 60;
          result.vaultGlobal.networkStatus = 'connected';
          result.vaultGlobal.isSwitchingAccount = false;
          return result;
        };
        const send = chrome.runtime.sendMessage.bind(chrome.runtime);
        chrome.runtime.sendMessage = ((...args: any[]) => {
          const [message, callback] = args;
          if (message?.type === 'getCurrentState')
            return typeof callback === 'function'
              ? (send as any)(message, (state: any) =>
                  callback(transform(state))
                )
              : (send as any)(message).then(transform);
          if (
            message?.type === 'CONTROLLER_ACTION' &&
            /^(?:sign|send|deploy|install|uninstall|rotate|add|remove|register|start|finalize|prepare)/i.test(
              message.data?.methods?.[1] || ''
            )
          ) {
            deniedActions.push(message.data.methods[1]);
            const value = {
              error: 'Synthetic review fixture forbids controller actions',
            };
            if (typeof callback === 'function')
              return queueMicrotask(() => callback(value));
            return Promise.resolve(value);
          }
          return (send as any)(...args);
        }) as typeof chrome.runtime.sendMessage;
        const add = chrome.runtime.onMessage.addListener.bind(
          chrome.runtime.onMessage
        );
        const remove = chrome.runtime.onMessage.removeListener.bind(
          chrome.runtime.onMessage
        );
        const wrapped = new Map<any, any>();
        chrome.runtime.onMessage.addListener = (listener: any) => {
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
          wrapped.set(listener, wrapper);
          add(wrapper);
        };
        chrome.runtime.onMessage.removeListener = (listener: any) => {
          remove(wrapped.get(listener) || listener);
          wrapped.delete(listener);
        };
      },
      { accountAddress, accountLabel }
    );
    const typedData = {
      domain: { name: 'Synthetic review', version: '1', chainId: 5700 },
      primaryType: 'Message',
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
        ],
        Message: [{ name: 'content', type: 'string' }],
      },
      message: { content: 'Synthetic unbroken review text '.repeat(15) },
    };
    for (const viewport of [
      { width: 320, height: 360 },
      { width: 400, height: 480 },
    ]) {
      await page.setViewportSize(viewport);
      for (const kind of ['personal_sign', 'eth_signTypedData_v4']) {
        await page.goto(
          `chrome-extension://${
            wallet.extensionId
          }/external.html?route=tx/ethSign&data=${encodeURIComponent(
            JSON.stringify({
              host,
              eventName: kind,
              0:
                kind === 'personal_sign'
                  ? 'Synthetic message only'
                  : accountAddress,
              1:
                kind === 'personal_sign'
                  ? accountAddress
                  : JSON.stringify(typedData),
            })
          )}`
        );
        await expect(page.locator('body.app-loaded')).toBeVisible();
        await expect(page.locator('#initial-loader')).toHaveCSS('opacity', '0');
        await expect(
          page.getByRole('button', { name: 'Details', exact: true })
        ).toBeVisible();
        const geometry = [];
        for (const value of [host, accountLabel]) {
          await expect(page.getByText(value, { exact: true })).toHaveCount(
            value === host ? 2 : 1
          );
          for (const element of await page
            .getByText(value, { exact: true })
            .all()) {
            expect(
              await revealReviewText(page, element),
              `${kind}: complete review text can be scrolled above the action footer`
            ).toBe(true);
            const measurement = await element.evaluate((node) => {
              const box = node.getBoundingClientRect();
              return {
                left: box.left,
                right: box.right,
                scrollWidth: node.scrollWidth,
                clientWidth: node.clientWidth,
              };
            });
            geometry.push({ value, ...measurement });
            expect
              .soft(measurement.left, `${kind}: full ${value} left edge`)
              .toBeGreaterThanOrEqual(-0.5);
            expect
              .soft(measurement.right, `${kind}: full ${value} right edge`)
              .toBeLessThanOrEqual(viewport.width + 0.5);
            expect
              .soft(
                measurement.scrollWidth,
                `${kind}: full text is not clipped`
              )
              .toBeLessThanOrEqual(measurement.clientWidth + 1);
          }
        }
        await info.attach(`${kind}-${viewport.width}-geometry`, {
          body: JSON.stringify(geometry),
          contentType: 'application/json',
        });
        const data = page.getByRole('button', { name: 'Data', exact: true });
        await data.click();
        await expect(
          page.getByText('Raw Parameters', { exact: true })
        ).toBeVisible();
        await page
          .getByRole('button', { name: 'Details', exact: true })
          .click();
        expect(
          await revealReviewText(
            page,
            page.getByText(accountLabel, { exact: true })
          )
        ).toBe(true);
        await page.screenshot({
          path: path.join(directory, `${kind}-${viewport.width}.png`),
          animations: 'disabled',
        });
        for (const action of ['Cancel', 'Confirm']) {
          const exposed = await page
            .getByRole('button', { name: action, exact: true })
            .evaluate((element) => {
              const box = element.getBoundingClientRect();
              const hit = document.elementFromPoint(
                box.x + box.width / 2,
                box.y + box.height / 2
              );
              return (
                box.width > 0 &&
                box.height > 0 &&
                box.left >= 0 &&
                box.right <= innerWidth &&
                box.top >= 0 &&
                box.bottom <= innerHeight &&
                !!hit &&
                (hit === element || element.contains(hit))
              );
            });
          expect(exposed, `${kind}: ${action} remains exposed`).toBe(true);
        }
        expect(
          await page.evaluate(
            () => (window as any).__dialogEdgeQa.deniedActions
          )
        ).toEqual([]);
      }
    }
    expect(errors).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
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
