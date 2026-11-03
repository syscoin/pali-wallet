import { expect, test } from '@playwright/test';

import en from '../../source/assets/locales/en.json';
import fr from '../../source/assets/locales/fr.json';
import { E2E_CONFIG } from '../harness/config';
import { expectCenteredHeadingLines } from '../harness/headingAlignment';
import { PaliWallet } from '../harness/pali';
import {
  approve,
  extensionEvidence,
  popupFor,
  rpcObservation,
  settle,
  startRequest,
} from '../harness/testDappConformance';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('signature headings center every rendered line in the saved language', async ({}, info) => {
  test.setTimeout(120_000);
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  const previous = { ...E2E_CONFIG };
  const fixture = createUtxoFixture();
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'HeadingSyntheticOnly!2026',
    rpcUrl: server.url,
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
  });
  let wallet: PaliWallet | undefined;
  try {
    wallet = await PaliWallet.launch('signature-heading-locale', {
      offlineHttpProxy: server.url,
      recordVideo: false,
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      fixture,
      server.url
    );
    const page = wallet.page;
    await wallet.step('ordinary onboarding and dapp connection', async () => {
      await wallet!.importSeedAndCreatePassword();
      await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
      await wallet!.ensureOnHome();
      await page.goto(server.url);
      await page.waitForFunction(() => Boolean((window as any).pali));
      expect(
        (
          await approve(
            wallet!.context,
            page,
            await startRequest(page, 'sys_requestAccounts')
          )
        ).result
      ).toEqual([fixture.userAddress]);
    });
    for (const locale of [
      { code: 'en', text: en },
      { code: 'fr', text: fr },
    ]) {
      await wallet.step(
        `${locale.code} actual signature header and cancellation`,
        async () => {
          if (locale.code === 'fr') {
            await page.goto(wallet!.appUrl('#/'));
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
              .getByRole('menuitem', { name: 'French Français', exact: true })
              .click();
            await page
              .getByRole('button', { name: en.buttons.save, exact: true })
              .click();
            await expect(
              page.getByText(fr.settings.languageWasSet, { exact: true })
            ).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(page).toHaveURL(/#\/home/);
            expect(
              (await page.evaluate(() => chrome.storage.local.get('language')))
                .language
            ).toBe('fr');
            await page.goto(server.url);
            await page.waitForFunction(() => Boolean((window as any).pali));
          }
          const id = await startRequest(page, 'sys_sign', [fixture.single]);
          const popup = await popupFor(wallet!.context, page, id);
          const heading = popup.getByRole('heading', {
            name: locale.text.transactions.signatureRequest,
            exact: true,
          });
          for (const width of [400, 320]) {
            await popup.setViewportSize({
              width,
              height: width === 400 ? 620 : 360,
            });
            await expect(heading).toBeVisible();
            for (let n = 0; n < 12; n++) {
              const point = await heading.evaluate((element) => {
                const r = element.getBoundingClientRect();
                let owner = element.parentElement;
                while (
                  owner &&
                  !(
                    owner.scrollHeight > owner.clientHeight + 2 &&
                    /auto|scroll/.test(getComputedStyle(owner).overflowY)
                  )
                )
                  owner = owner.parentElement;
                const a = (
                  owner || document.documentElement
                ).getBoundingClientRect();
                const top = Math.max(0, a.top),
                  bottom = Math.min(innerHeight - 85, a.bottom);
                return r.top >= top + 8 && r.bottom <= bottom - 8
                  ? null
                  : {
                      x: a.left + 8,
                      y: top + 40,
                      dy: r.top < top + 8 ? -100 : 100,
                    };
              });
              if (!point) break;
              await popup.mouse.move(point.x, point.y);
              await popup.mouse.wheel(0, point.dy);
              await popup.evaluate(
                () =>
                  new Promise((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(resolve))
                  )
              );
            }
            await expect(heading).toBeInViewport({ ratio: 1 });
            const geometry = await expectCenteredHeadingLines(heading);
            if (locale.code === 'fr' && width === 320) {
              expect(geometry.lines.length).toBeGreaterThan(1);
            }
            await expect(
              popup.getByText('0.00001 TSYS', { exact: true })
            ).toHaveCount(1);
            const pending = await rpcObservation(page, id);
            expect(pending).toMatchObject({
              method: 'sys_sign',
              params: [fixture.single],
            });
            expect(pending.settled).not.toBe(true);
            await info.attach(`${locale.code}-psbt-header-${width}`, {
              body: await popup.screenshot({ animations: 'disabled' }),
              contentType: 'image/png',
            });
            await info.attach(`${locale.code}-psbt-header-${width}-geometry`, {
              body: JSON.stringify(geometry),
              contentType: 'application/json',
            });
          }
          await popup
            .getByRole('button', {
              name: locale.text.buttons.cancel,
              exact: true,
            })
            .click();
          const result = await settle(page, id);
          expect(result.error?.code).toBe(4001);
          expect(result.result).toBeUndefined();
          expect(routes.deniedWrites).toEqual([]);
        }
      );
    }
    expect(extensionEvidence()).toEqual(runtime);
    await wallet.dispose('passed');
    wallet = undefined;
  } catch (error) {
    await wallet?.dispose('failed');
    wallet = undefined;
    throw error;
  } finally {
    Object.assign(E2E_CONFIG, previous);
    await server.close();
  }
});
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
