import { expect, test } from '@playwright/test';

import de from '../../source/assets/locales/de.json';
import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

for (const width of [320, 400]) {
  test(`Home actions keep German labels inside their rounded buttons at ${width}px`, async ({}, info) => {
    test.setTimeout(90_000);
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    const runtime = extensionEvidence();
    expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
    const previous = { ...E2E_CONFIG };
    const fixture = createIsolatedVaultFixture();
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'LocalizedActionsSynthetic!2026',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    try {
      wallet = await PaliWallet.launch(`home-actions-german-${width}`, {
        offlineHttpProxy: server.url,
        recordVideo: false,
        viewport: { width, height: width === 400 ? 620 : 360 },
      });
      const routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url
      );
      const page = wallet.page;
      await wallet.step(
        'Import disposable wallet and select German',
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await wallet!.ensureOnHome();
          await page
            .getByRole('button', {
              name: en.generalMenu.generalOptions,
              exact: true,
            })
            .click();
          await page
            .getByRole('menuitem', {
              name: en.generalMenu.languages,
              exact: true,
            })
            .click();
          await page
            .getByRole('button', {
              name: en.settings.setYourPreferredLanguage,
              exact: true,
            })
            .click();
          await page
            .getByRole('menuitem', { name: 'German Deutsch', exact: true })
            .click();
          await page
            .getByRole('button', { name: en.buttons.save, exact: true })
            .click();
          await expect(
            page.getByText(de.settings.languageWasSet, { exact: true })
          ).toBeVisible();
          await page.keyboard.press('Escape');
          await wallet!.ensureOnHome();
        }
      );
      await wallet.step(
        'Both translated Home action labels remain fully padded and operable',
        async () => {
          await page.mouse.move(0, 0);
          await info.attach(`home-actions-de-${width}`, {
            body: await page.screenshot({ animations: 'disabled' }),
            contentType: 'image/png',
          });
          for (const id of ['send-btn', 'receive-btn']) {
            const button = page.locator(`#${id}`);
            await expect(button).toBeEnabled();
            await expect(button).toBeInViewport({ ratio: 1 });
            const geometry = await button.evaluate((element) => {
              const textNode = Array.from(element.childNodes).find(
                (node) =>
                  node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
              );
              if (!textNode) throw new Error('Action label is missing');
              const range = document.createRange();
              range.selectNodeContents(textNode);
              const text = range.getBoundingClientRect();
              const box = element.getBoundingClientRect();
              return {
                left: text.left - box.left,
                right: box.right - text.right,
              };
            });
            expect(geometry.left).toBeGreaterThanOrEqual(8);
            expect(geometry.right).toBeGreaterThanOrEqual(8);
            await button.click({ trial: true });
          }
          expect(routes.deniedWrites).toEqual([]);
        }
      );
      status = 'passed';
    } finally {
      try {
        await wallet?.dispose(status);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  });
}
