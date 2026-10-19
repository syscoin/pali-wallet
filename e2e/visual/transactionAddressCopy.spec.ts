import { expect, test } from '@playwright/test';

import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { startUtxoFixtureServer } from '../harness/utxoFixture';
import {
  createVisualFixture,
  installVisualFixtureRoutes,
  VISUAL_FIXTURE_ADDRESS,
  VISUAL_FIXTURE_CHAIN_ID,
  VISUAL_FIXTURE_SEED,
} from '../harness/visualFixture';

for (const alias of ['alice.eth', 'a-very-long-recipient-alias.eth']) {
  test(`transaction Copy retains the address behind ${alias}`, async ({}, info) => {
    test.setTimeout(120_000);
    const before = { ...E2E_CONFIG };
    const server = await startUtxoFixtureServer();
    let wallet: PaliWallet | undefined;
    Object.assign(E2E_CONFIG, {
      chainId: VISUAL_FIXTURE_CHAIN_ID,
      networkLabel: 'zkTanenbaum',
      password: 'AddressCopySynthetic!2026',
      rpcUrl: server.url,
      seedPhrase: VISUAL_FIXTURE_SEED,
    });
    try {
      wallet = await PaliWallet.launch('transaction-address-copy', {
        offlineHttpProxy: server.url,
        viewport: { width: 400, height: 620 },
      });
      const routes = await installVisualFixtureRoutes(
        wallet.context,
        createVisualFixture(),
        server.url
      );
      await wallet.importSeedAndCreatePassword();
      await wallet.switchNetwork(E2E_CONFIG.networkLabel);
      const page = wallet.page;
      await page.addInitScript(
        ({ address, name }) => {
          // Display-only ENS-cache fixture. Only that returned cache is decorated;
          // account/chain/history values, signing and persistence are unchanged.
          const decorate = (state: any) => {
            if (!state?.vaultGlobal) return state;
            return {
              ...state,
              vaultGlobal: {
                ...state.vaultGlobal,
                ensCache: {
                  ...state.vaultGlobal.ensCache,
                  [address.toLowerCase()]: { name, timestamp: Date.now() },
                },
              },
            };
          };
          const send = chrome.runtime.sendMessage.bind(chrome.runtime);
          chrome.runtime.sendMessage = ((...args: any[]) => {
            const [message, callback] = args;
            if (message?.type !== 'getCurrentState')
              return (send as any)(...args);
            return typeof callback === 'function'
              ? (send as any)(message, (state: any) =>
                  callback(decorate(state))
                )
              : (send as any)(message).then(decorate);
          }) as typeof chrome.runtime.sendMessage;
          const listen = chrome.runtime.onMessage.addListener.bind(
            chrome.runtime.onMessage
          );
          chrome.runtime.onMessage.addListener = ((listener: any) =>
            listen((message: any, ...args: any[]) =>
              listener(
                message?.type === 'CONTROLLER_STATE_CHANGE'
                  ? { ...message, data: decorate(message.data) }
                  : message,
                ...args
              )
            )) as typeof chrome.runtime.onMessage.addListener;
          (window as any).__transactionAddressCopies = [];
          Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
              writeText: async (value: string) => {
                (window as any).__transactionAddressCopies.push(value);
              },
            },
          });
        },
        { address: VISUAL_FIXTURE_ADDRESS, name: alias }
      );
      await page.reload();
      await wallet.ensureOnHome();
      await page.locator('#activity-btn').click();
      const detail = page
        .locator('#activity-panel-list svg.cursor-pointer')
        .first();
      await expect(detail).toBeVisible();
      await detail.click();
      await expect(page).toHaveURL(/home\/details/);
      const row = page.getByText('To', { exact: true }).locator('..');
      const displayed =
        alias.length > 24 ? `${alias.slice(0, 14)}…${alias.slice(-8)}` : alias;
      // The details list may apply its existing additional visual truncation.
      await expect(row).toContainText(
        displayed.length >= 20 ? alias.slice(-8).slice(-4) : alias
      );
      await row.getByRole('button').click();
      await expect
        .poll(() =>
          page.evaluate(() => (window as any).__transactionAddressCopies)
        )
        .toEqual([VISUAL_FIXTURE_ADDRESS]);
      await info.attach('transaction-address-copy', {
        body: await page.screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      });
      expect(routes.deniedWrites).toEqual([]);
    } finally {
      await wallet?.context.close().catch(() => undefined);
      await server.close();
      Object.assign(E2E_CONFIG, before);
    }
  });
}
