import { expect, test } from '@playwright/test';

import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('Receive retains readable network context and copy controls with long custom labels', async ({}, info) => {
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'ReceiveContextSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  try {
    wallet = await PaliWallet.launch('receive-network-context', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    for (const label of ['Syscoin Testnet', 'CustomReceiveNetwork'.repeat(8)]) {
      const page = await wallet.context.newPage();
      // Public renderer metadata only: custom network labels are unrestricted
      // text. Keep the actual wallet, address and controller replies intact.
      await page.addInitScript((networkLabel) => {
        const write = navigator.clipboard.writeText.bind(navigator.clipboard);
        navigator.clipboard.writeText = async (text) => {
          await write(text);
          (window as any).__receiveCopiedAddress = text;
        };
        const original = chrome.runtime.sendMessage.bind(chrome.runtime);
        const fixture = (state: any) => {
          if (!state?.vault?.activeNetwork) return state;
          const next = structuredClone(state);
          next.vault.activeNetwork.label = networkLabel;
          return next;
        };
        chrome.runtime.sendMessage = ((...args: any[]) => {
          const [message, callback] = args;
          if (message?.type !== 'getCurrentState')
            return (original as any)(...args);
          if (typeof callback === 'function')
            return (original as any)(message, (state: any) =>
              callback(fixture(state))
            );
          return (original as any)(message).then(fixture);
        }) as typeof chrome.runtime.sendMessage;
      }, label);
      await page.goto(wallet.appUrl('#/receive'));
      const network = page
        .locator('#qr-code')
        .locator('xpath=preceding-sibling::div[1]')
        .getByText(label, { exact: true });
      await expect(network).toBeVisible();
      const address = page.locator('#qr-code + div p');
      await expect(address).not.toHaveText('');
      const expectedAddress = await address.innerText();
      for (const viewport of [
        { width: 320, height: 360 },
        { width: 400, height: 480 },
      ]) {
        await page.setViewportSize(viewport);
        const labelCase = label === 'Syscoin Testnet' ? 'normal' : 'long';
        const screenshot = info.outputPath(
          `receive-${labelCase}-${viewport.width}.png`
        );
        await page.screenshot({ path: screenshot, animations: 'disabled' });
        await info.attach(`receive-${labelCase}-${viewport.width}`, {
          path: screenshot,
          contentType: 'image/png',
        });
        const geometry = await network.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            viewport: innerWidth,
            documentWidth: document.documentElement.scrollWidth,
          };
        });
        expect
          .soft(geometry.left, `${labelCase}: left edge`)
          .toBeGreaterThanOrEqual(0);
        expect
          .soft(geometry.right, `${labelCase}: right edge`)
          .toBeLessThanOrEqual(viewport.width);
        expect
          .soft(geometry.scrollWidth, `${labelCase}: label wraps`)
          .toBeLessThanOrEqual(geometry.clientWidth);
        expect
          .soft(geometry.documentWidth, `${labelCase}: document width`)
          .toBe(viewport.width);
        await expect(address).toHaveText(expectedAddress);
        const copy = page.locator('#copy-address-receive-btn button');
        await copy.scrollIntoViewIfNeeded();
        await expect(copy).toBeEnabled();
        await copy.click();
        await expect
          .poll(() =>
            page.evaluate(() => (window as any).__receiveCopiedAddress)
          )
          .toBe(expectedAddress);
      }
      await page.close();
    }
    expect(routes.deniedWrites).toEqual([]);
    expect(routes.syntheticBroadcasts).toEqual([]);
  } finally {
    await wallet?.context.close();
    await server.close();
    Object.assign(E2E_CONFIG, previous);
  }
});
