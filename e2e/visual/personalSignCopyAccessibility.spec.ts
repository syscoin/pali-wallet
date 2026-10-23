import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import de from '../../source/assets/locales/de.json';
import en from '../../source/assets/locales/en.json';
import fr from '../../source/assets/locales/fr.json';
import { E2E_CONFIG } from '../harness/config';
import { dismissRejectedApproval } from '../harness/dismissRejectedApproval';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
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
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const MESSAGE = 'Review this public clipboard fixture.';
const locales = [
  { code: 'en', text: en, option: 'English English' },
  { code: 'de', text: de, option: 'German Deutsch' },
  { code: 'fr', text: fr, option: 'French Français' },
] as const;

// Read public identity and saved language only, never keyring/secret records.
async function publicState(page: Page) {
  return page.evaluate(async () => {
    const { vault } = await chrome.runtime.sendMessage({
      type: 'getCurrentState',
    });
    const ref = vault.activeAccount;
    const account = vault.accounts[ref.type][ref.id];
    const { language } = await chrome.storage.local.get(['language']);
    return {
      account: { id: ref.id, type: ref.type, address: account.address },
      network: {
        kind: vault.activeNetwork.kind,
        chainId: vault.activeNetwork.chainId,
        url: vault.activeNetwork.url,
      },
      language: language || 'en',
      storedLanguage: language ?? null,
    };
  });
}

async function tabTo(page: Page, target: Locator) {
  // Always issue native Tab events, even after pointer focus on the target.
  for (let count = 0; count < 32; count++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement))
      break;
  }
  await expect(target).toBeFocused();
}

async function visibleGeometry(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const read = () =>
    target.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const hit = (x: number, y: number) => {
        const node = document.elementFromPoint(x, y);
        return !!node && (node === element || element.contains(node));
      };
      return {
        bounds: box.toJSON(),
        viewport: { width: innerWidth, height: innerHeight },
        documentWidth: document.documentElement.scrollWidth,
        hits: [
          hit(box.left + box.width / 2, box.top + box.height / 2),
          hit(box.left + 1, box.top + box.height / 2),
          hit(box.right - 1, box.top + box.height / 2),
          hit(box.left + box.width / 2, box.top + 1),
          hit(box.left + box.width / 2, box.bottom - 1),
        ],
      };
    });
  // Reveal ordinary scrollable content without force clicks or DOM styling.
  for (let attempt = 0; attempt < 24; attempt++) {
    const current = await read();
    if (current.hits.every(Boolean)) break;
    await page.mouse.move(
      page.viewportSize()!.width - 5,
      page.viewportSize()!.height / 2
    );
    await page.mouse.wheel(0, current.bounds.top < 0 ? -90 : 90);
    await page.waitForTimeout(100);
  }
  const geometry = await read();
  expect(geometry.bounds.width).toBeGreaterThan(0);
  expect(geometry.bounds.height).toBeGreaterThan(0);
  expect(geometry.bounds.left).toBeGreaterThanOrEqual(0);
  expect(geometry.bounds.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bounds.right).toBeLessThanOrEqual(geometry.viewport.width);
  expect(geometry.bounds.bottom).toBeLessThanOrEqual(geometry.viewport.height);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport.width);
  expect(geometry.hits).toEqual([true, true, true, true, true]);
  return geometry;
}

async function saveLanguage(
  page: Page,
  current: (typeof locales)[number],
  next: (typeof locales)[number]
) {
  await page
    .getByRole('button', {
      name: current.text.generalMenu.generalOptions,
      exact: true,
    })
    .click();
  await page
    .getByRole('menuitem', {
      name: current.text.generalMenu.languages,
      exact: true,
    })
    .click();
  await page
    .getByRole('button', {
      name: current.text.settings.setYourPreferredLanguage,
      exact: true,
    })
    .click();
  await page.getByRole('menuitem', { name: next.option, exact: true }).click();
  const save = page.getByRole('button', {
    name: current.text.buttons.save,
    exact: true,
  });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(
    page.getByText(next.text.settings.languageWasSet, { exact: true })
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
  expect((await publicState(page)).storedLanguage).toBe(next.code);
}

for (const locale of locales) {
  test(`ordinary personal_sign preview Copy uses saved ${locale.code} without signing`, async ({}, info) => {
    test.setTimeout(120_000);
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
    const previous = { ...E2E_CONFIG };
    const fixture = createIsolatedVaultFixture();
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'PersonalSignCopySynthetic!2026',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let dapp: Page | undefined;
    let activePopup: Page | undefined;
    let status: 'passed' | 'failed' = 'failed';
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    const pageErrors: string[] = [];
    const observations: unknown[] = [];
    try {
      wallet = await PaliWallet.launch('personal-sign-copy-' + locale.code, {
        offlineHttpProxy: server.url,
        viewport: { width: 400, height: 620 },
      });
      wallet.page.on('pageerror', (error) => pageErrors.push(error.message));
      wallet.context.on('page', (page) =>
        page.on('pageerror', (error) => pageErrors.push(error.message))
      );
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url
      );
      await wallet.step(
        `${locale.code}: connect one disposable wallet through the real dapp provider`,
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.ensureOnHome();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          dapp = await wallet!.context.newPage();
          await dapp.goto(server.url);
          await dapp.waitForFunction(() => Boolean((window as any).pali));
          // Only connection is approved, while the fresh profile is English.
          const connected = await approve(
            wallet!.context,
            dapp,
            await startRequest(dapp, 'eth_requestAccounts')
          );
          expect(connected.error).toBeUndefined();
          expect(connected.result).toHaveLength(1);
          expect(connected.result[0].toLowerCase()).toBe(
            fixture.evmAddresses[0].toLowerCase()
          );
        }
      );
      const original = await publicState(wallet.page);
      await wallet.step(
        `${locale.code}: persist language through the real Languages Save action`,
        async () => {
          await wallet!.page.bringToFront();
          // English must be genuinely saved too, not merely the default.
          if (locale.code === 'en') {
            await saveLanguage(wallet!.page, locales[0], locales[1]);
            await saveLanguage(wallet!.page, locales[1], locale);
          } else await saveLanguage(wallet!.page, locales[0], locale);
          const saved = await publicState(wallet!.page);
          expect(saved.account).toEqual(original.account);
          expect(saved.network).toEqual(original.network);
          expect(saved.storedLanguage).toBe(locale.code);
        }
      );
      const baseline = await publicState(wallet.page);
      const accounts = await settle(
        dapp!,
        await startRequest(dapp!, 'eth_accounts')
      );
      expect(accounts.error).toBeUndefined();
      expect(accounts.result).toEqual([baseline.account.address.toLowerCase()]);
      const scenarios = [
        { name: 'plaintext', payload: MESSAGE, width: 400, height: 620 },
        {
          name: 'hex',
          payload: `0x${Buffer.from(MESSAGE).toString('hex')}`,
          width: 320,
          height: 360,
        },
      ];
      for (const scenario of scenarios) {
        await wallet.step(
          `${locale.code}: copy ${scenario.name} preview by pointer and keyboard, then Cancel`,
          async () => {
            const params = [scenario.payload, accounts.result[0]];
            const id = await startRequest(dapp!, 'personal_sign', params);
            const popup = await popupFor(wallet!.context, dapp!, id);
            activePopup = popup;
            await popup.setViewportSize({
              width: scenario.width,
              height: scenario.height,
            });
            await popup.bringToFront();
            await expect(
              popup.getByRole('heading', {
                name: locale.text.send.signPersonalMessage,
                exact: true,
              })
            ).toBeVisible();
            const preview = popup.locator('p.font-mono');
            await expect(preview).toHaveCount(1);
            await expect(preview).toHaveText(MESSAGE);
            const routeRequest = JSON.parse(
              new URL(popup.url()).searchParams.get('data')!
            );
            expect([routeRequest[0], routeRequest[1]]).toEqual(params);
            expect(routeRequest.host).toBe(server.url);
            expect(routeRequest.eventName).toBe('personal_sign');
            expect(await publicState(popup)).toEqual(baseline);
            // Forward the real Clipboard method; observe only this allowlisted
            // public message after native completion, never replace results.
            await popup.evaluate((allowed) => {
              const descriptor = Object.getOwnPropertyDescriptor(
                navigator.clipboard,
                'writeText'
              );
              const originalWrite = navigator.clipboard.writeText.bind(
                navigator.clipboard
              );
              const audit = {
                writes: [] as string[],
                failures: 0,
                unexpectedValues: 0,
              };
              Object.defineProperty(navigator.clipboard, 'writeText', {
                configurable: true,
                value: async (text: string) => {
                  try {
                    await originalWrite(text);
                    if (text === allowed) audit.writes.push(text);
                    else audit.unexpectedValues += 1;
                  } catch (error) {
                    audit.failures += 1;
                    throw error;
                  }
                },
              });
              (window as any).__personalSignPublicCopy = {
                snapshot: () => ({ ...audit, writes: [...audit.writes] }),
                restore: () => {
                  if (descriptor)
                    Object.defineProperty(
                      navigator.clipboard,
                      'writeText',
                      descriptor
                    );
                  else delete (navigator.clipboard as any).writeText;
                },
              };
            }, MESSAGE);
            const copyAudit = () =>
              popup.evaluate(() =>
                (window as any).__personalSignPublicCopy.snapshot()
              );
            const copy = popup
              .getByRole('img', { name: 'copy', exact: true })
              .locator('xpath=ancestor::button[1]');
            await expect(copy).toHaveCount(1);
            await expect(copy).toBeEnabled();
            const previewGeometry = await visibleGeometry(popup, preview);
            const copyGeometry = await visibleGeometry(popup, copy);
            await copy.click();
            await expect
              .poll(async () => (await copyAudit()).writes)
              .toEqual([MESSAGE]);
            await tabTo(popup, copy);
            await popup.keyboard.press('Enter');
            await expect(copy).toBeFocused();
            await expect
              .poll(async () => (await copyAudit()).writes)
              .toEqual([MESSAGE, MESSAGE]);
            const clipboard = await copyAudit();
            expect(clipboard).toEqual({
              writes: [MESSAGE, MESSAGE],
              failures: 0,
              unexpectedValues: 0,
            });
            await expect(copy).toHaveAccessibleName(locale.text.buttons.copy);
            const pending = await rpcObservation(dapp!, id);
            expect(pending.settled).not.toBe(true);
            expect(pending.result).toBeUndefined();
            expect(pending.params).toEqual(params);
            expect(await publicState(popup)).toEqual(baseline);
            expect(
              [0, 1].map(
                (key) =>
                  JSON.parse(new URL(popup.url()).searchParams.get('data')!)[
                    key
                  ]
              )
            ).toEqual(params);
            const image = info.outputPath(
              `${locale.code}-${scenario.name}-copy-${scenario.width}.png`
            );
            await popup.screenshot({ path: image, animations: 'disabled' });
            await info.attach(
              `${locale.code}-${scenario.name}-copy-${scenario.width}`,
              { path: image, contentType: 'image/png' }
            );
            await popup.evaluate(() =>
              (window as any).__personalSignPublicCopy.restore()
            );
            const cancel = popup.getByRole('button', {
              name: locale.text.buttons.cancel,
              exact: true,
            });
            const cancelGeometry = await visibleGeometry(popup, cancel);
            await tabTo(popup, cancel);
            const canceled = await dismissRejectedApproval({
              click: () => popup.keyboard.press('Enter'),
              isClosed: () => popup.isClosed(),
              settle: () => settle(dapp!, id),
            });
            expect(canceled.error?.code).toBe(4001);
            expect(canceled.result).toBeUndefined();
            expect(canceled.params).toEqual(params);
            expect(await publicState(wallet!.page)).toEqual(baseline);
            expect(routes!.deniedWrites).toEqual([]);
            activePopup = undefined;
            observations.push({
              encoding: scenario.name,
              viewport: { width: scenario.width, height: scenario.height },
              requestId: id,
              params,
              preview: MESSAGE,
              clipboard,
              previewGeometry,
              copyGeometry,
              cancelGeometry,
              localizedCopy: locale.text.buttons.copy,
              cancellation: {
                code: canceled.error?.code,
                noResult: canceled.result === undefined,
              },
              publicState: await publicState(wallet!.page),
            });
          }
        );
      }
      await wallet.step(
        `${locale.code}: both requests rejected with exact context and no signature`,
        async () => {
          const requests = await dapp!.evaluate(
            () => (window as any).__paliConformance.requests
          );
          expect(requests.map((request: any) => request.method)).toEqual([
            'eth_requestAccounts',
            'eth_accounts',
            'personal_sign',
            'personal_sign',
          ]);
          for (const request of requests.slice(2)) {
            expect(request.settled).toBe(true);
            expect(request.error?.code).toBe(4001);
            expect(request.result).toBeUndefined();
          }
          expect(observations).toHaveLength(2);
          expect(await publicState(wallet!.page)).toEqual(baseline);
          expect(routes!.deniedWrites).toEqual([]);
          expect(pageErrors).toEqual([]);
        }
      );
      status = 'passed';
    } finally {
      try {
        await info.attach('personal-sign-copy-evidence-' + locale.code, {
          contentType: 'application/json',
          body: JSON.stringify(
            {
              runtime: extensionEvidence(),
              sourceSha256: createHash('sha256')
                .update(fs.readFileSync(info.file))
                .digest('hex'),
              simulated: true,
              controllerStateReplaced: false,
              signatureApprovalClicked: false,
              fixtureReads: routes?.reads || [],
              fixtureDeniedWrites: routes?.deniedWrites || [],
              proxyDeniedConnections: server.blocked.length,
              pageErrors,
              observations,
            },
            null,
            2
          ),
        });
      } catch (error) {
        status = 'failed';
        throw error;
      } finally {
        try {
          if (activePopup && !activePopup.isClosed())
            await activePopup
              .evaluate(() =>
                (window as any).__personalSignPublicCopy?.restore()
              )
              .catch(() => undefined);
          await wallet?.dispose(status);
        } finally {
          await server.close();
          Object.assign(E2E_CONFIG, previous);
        }
      }
    }
  });
}
