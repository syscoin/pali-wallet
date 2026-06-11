import { type Page, expect, test } from '@playwright/test';

import { E2E_CONFIG } from '../harness/config';
import { startDappServer } from '../harness/dappServer';
import { PaliWallet } from '../harness/pali';

// Dapp surface journey: a local test page talks to the injected EIP-1193
// provider; the journey drives the connect popup and the personal_sign
// popup end to end.
//
// Popup driving notes: the background opens external.html in a new browser
// window, which surfaces as a new Page on the persistent context. Untrusted
// (non-allowlisted) sites add a second confirmation dialog on connect.
test('dapp: connect popup + personal_sign popup', async () => {
  const wallet = await PaliWallet.launch('dapp');
  const dapp = await startDappServer();

  // Resolves with the next external popup page once it has rendered. If the
  // dapp page reports a provider error first (#out flips to *-error), fail
  // with that error instead of an opaque popup timeout.
  const waitForPopup = async (dappPage: Page): Promise<Page> => {
    const popupPromise = wallet.context.waitForEvent('page', {
      timeout: 60_000,
    });
    const errorPromise = dappPage
      .locator('#out')
      .filter({ hasText: /-error:/ })
      .waitFor({ state: 'visible', timeout: 60_000 })
      .then(async () => {
        const text = await dappPage.locator('#out').textContent();
        throw new Error(`dapp provider error before popup: ${text}`);
      });
    const popup = (await Promise.race([popupPromise, errorPromise])) as Page;
    await popup.waitForLoadState('domcontentloaded');
    await popup
      .locator('#external-root')
      .waitFor({ state: 'attached', timeout: 30_000 })
      .catch(() => undefined);
    return popup;
  };

  const clickConfirm = async (popup: Page) => {
    const confirm = popup
      .getByRole('button', { name: /^(confirm|sign|approve)$/i })
      .first();
    await expect(confirm).toBeVisible({ timeout: 60_000 });
    await expect(confirm).toBeEnabled({ timeout: 60_000 });
    await confirm.click();
  };

  try {
    await wallet.step('onboard and switch network', async () => {
      await wallet.importSeedAndCreatePassword();
      await wallet.switchNetwork(E2E_CONFIG.networkLabel);
    });

    const dappPage = await wallet.step('open local dapp page', async () => {
      // Pali refuses to open dapp popups while any extension tab is open
      // (checkForAnyOpenPopupOrHardwareWallet), and the harness drives the
      // wallet through an app.html tab. Park that tab on about:blank so the
      // background can open the external.html popup windows.
      await wallet.page.goto('about:blank');
      const page = await wallet.context.newPage();
      await page.goto(dapp.url);
      await expect(page.locator('#out')).toHaveText('idle');
      // Provider injection is async via the content script.
      await page.waitForFunction(() => Boolean((window as any).ethereum), {
        timeout: 30_000,
      });
      return page;
    });

    await wallet.step('connect through popup', async () => {
      const popupPromise = waitForPopup(dappPage);
      await dappPage.locator('#connect').click();
      const popup = await popupPromise;

      await clickConfirm(popup);
      // Localhost is not on the trusted-sites list; a second confirmation
      // dialog asks to proceed with an untrusted site.
      const secondConfirm = popup
        .getByRole('button', { name: /^(confirm|connect|proceed)$/i })
        .first();
      if (
        await secondConfirm.isVisible({ timeout: 5_000 }).catch(() => false)
      ) {
        await secondConfirm.click();
      }

      await expect(dappPage.locator('#out')).toContainText(
        /connected:0x[a-fA-F0-9]{40}/,
        { timeout: 60_000 }
      );
    });

    await wallet.step('personal_sign through popup', async () => {
      const popupPromise = waitForPopup(dappPage);
      await dappPage.locator('#sign').click();
      const popup = await popupPromise;

      await clickConfirm(popup);

      await expect(dappPage.locator('#out')).toContainText(
        /signed:0x[a-fA-F0-9]{130}/,
        { timeout: 120_000 }
      );
    });

    await wallet.dispose('passed');
  } catch (error) {
    await wallet.dispose('failed');
    throw error;
  } finally {
    await dapp.close();
  }
});
