import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import { getAddress } from 'ethers';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  clickClosingPopup,
  dismissRejectedApproval,
} from '../harness/dismissRejectedApproval';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { checkReviewHeadingContainment } from '../harness/reviewGeometry';
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

const MESSAGE = 'Review this public test message.';
const HEX_MESSAGE = `0x${Buffer.from(MESSAGE).toString('hex')}`;
const viewports = [
  { width: 320, height: 360 },
  { width: 400, height: 620 },
] as const;

// Return public identity and selected network only, never vault/keyring records.
async function publicState(page: Page) {
  return page.evaluate(async () => {
    const { vault } = await chrome.runtime.sendMessage({
      type: 'getCurrentState',
    });
    const ref = vault.activeAccount;
    const account = vault.accounts[ref.type][ref.id];
    return {
      account: { id: ref.id, type: ref.type, address: account.address },
      network: {
        kind: vault.activeNetwork.kind,
        chainId: vault.activeNetwork.chainId,
        url: vault.activeNetwork.url,
      },
    };
  });
}

async function tabTo(page: Page, target: Locator) {
  // Traverse native Tab events even if a pointer previously focused the target.
  for (let count = 0; count < 32; count++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement))
      break;
  }
  await expect(target).toBeFocused();
}

async function actionGeometry(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const geometry = await target.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2
    );
    return {
      bounds: box.toJSON(),
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      exposed: !!hit && (hit === element || element.contains(hit)),
    };
  });
  expect(geometry.bounds.width).toBeGreaterThan(0);
  expect(geometry.bounds.height).toBeGreaterThan(0);
  expect(geometry.bounds.left).toBeGreaterThanOrEqual(0);
  expect(geometry.bounds.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bounds.right).toBeLessThanOrEqual(geometry.viewport.width);
  expect(geometry.bounds.bottom).toBeLessThanOrEqual(geometry.viewport.height);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport.width);
  expect(geometry.exposed).toBe(true);
  return geometry;
}

async function messageRowGeometry(page: Page, row: Locator) {
  await row.scrollIntoViewIfNeeded();
  const read = () =>
    row.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const footer = document.querySelector('.fixed.bottom-0');
      if (!footer) throw new Error('Missing actual approval action footer');
      const footerTop = footer.getBoundingClientRect().top;
      let surface = element.parentElement;
      while (surface) {
        if (
          /^(auto|scroll)$/.test(getComputedStyle(surface).overflowY) &&
          surface.scrollHeight > surface.clientHeight
        )
          break;
        surface = surface.parentElement;
      }
      if (!surface)
        throw new Error('Missing actual overflowing review surface');
      const surfaceBounds = surface.getBoundingClientRect();
      const left = Math.max(0, surfaceBounds.left);
      const right = Math.min(innerWidth, surfaceBounds.right);
      const top = Math.max(0, surfaceBounds.top);
      const bottom = Math.min(innerHeight, footerTop, surfaceBounds.bottom);
      if (right <= left || bottom <= top)
        throw new Error('Review scroll surface has no exposed viewport');
      const wheelPoint = { x: (left + right) / 2, y: (top + bottom) / 2 };
      const wheelTarget = document.elementFromPoint(wheelPoint.x, wheelPoint.y);
      const hit = (x: number, y: number) => {
        const node = document.elementFromPoint(x, y);
        return !!node && (node === element || element.contains(node));
      };
      return {
        bounds: box.toJSON(),
        footerTop,
        viewport: { width: innerWidth, height: innerHeight },
        documentWidth: document.documentElement.scrollWidth,
        scrollSurface: {
          className: surface.className,
          bounds: surfaceBounds.toJSON(),
          clientHeight: surface.clientHeight,
          scrollHeight: surface.scrollHeight,
          scrollTop: surface.scrollTop,
          wheelPoint,
          receivesWheel: !!wheelTarget && surface.contains(wheelTarget),
        },
        hits: [
          hit(box.left + box.width / 2, box.top + box.height / 2),
          hit(box.left + 1, box.top + box.height / 2),
          hit(box.right - 1, box.top + box.height / 2),
          hit(box.left + box.width / 2, box.top + 1),
          hit(box.left + box.width / 2, box.bottom - 1),
        ],
      };
    });
  const before = await read();
  const needsScroll =
    before.bounds.bottom > before.footerTop || !before.hits.every(Boolean);
  if (needsScroll) {
    // Native wheel over the measured inner scroll surface, not the outer page.
    // No DOM, styles or scroll positions are replaced to expose the row.
    expect(before.scrollSurface.receivesWheel).toBe(true);
    await page.mouse.move(
      before.scrollSurface.wheelPoint.x,
      before.scrollSurface.wheelPoint.y
    );
    await page.mouse.wheel(
      0,
      Math.max(40, before.bounds.bottom - before.footerTop + 16)
    );
  }
  await expect
    .poll(async () => {
      const current = await read();
      return (
        current.bounds.top >= 0 &&
        current.bounds.bottom <= current.footerTop &&
        current.hits.every(Boolean)
      );
    })
    .toBe(true);
  const geometry = await read();
  expect(geometry.bounds.width).toBeGreaterThan(0);
  expect(geometry.bounds.height).toBeGreaterThan(0);
  expect(geometry.bounds.left).toBeGreaterThanOrEqual(0);
  expect(geometry.bounds.right).toBeLessThanOrEqual(geometry.viewport.width);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport.width);
  expect(geometry.hits).toEqual([true, true, true, true, true]);
  return { ...geometry, beforeScroll: before, usedNativeWheel: needsScroll };
}

for (const viewport of viewports) {
  test(`ordinary personal_sign Data preserves exact parameter meaning at ${viewport.width}px without signing`, async ({}, info) => {
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
      password: 'PersonalSignInterpretationSynthetic!2026',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let dapp: Page | undefined;
    let status: 'passed' | 'failed' = 'failed';
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    const pageErrors: string[] = [];
    const observations: unknown[] = [];
    try {
      wallet = await PaliWallet.launch(
        `personal-sign-parameter-interpretation-${viewport.width}`,
        {
          offlineHttpProxy: server.url,
          viewport: { width: 400, height: 620 },
        }
      );
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
        'connect the isolated wallet through the real provider',
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.ensureOnHome();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          dapp = await wallet!.context.newPage();
          await dapp.goto(server.url);
          await dapp.waitForFunction(() => Boolean((window as any).pali));
          // This approves connection only. No signature approval is ever clicked.
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
      const baseline = await publicState(wallet.page);
      expect(baseline.account.address).toBe(fixture.evmAddresses[0]);
      expect(getAddress(baseline.account.address)).toBe(
        baseline.account.address
      );
      expect(baseline.account.address).not.toBe(
        baseline.account.address.toLowerCase()
      );
      // Unlike some already-connected requestAccounts shortcuts, eth_accounts
      // guarantees the lowercase producer whose exact public result is reused.
      const accountReply = await settle(
        dapp!,
        await startRequest(dapp!, 'eth_accounts')
      );
      expect(accountReply.error).toBeUndefined();
      expect(accountReply.result).toEqual([
        baseline.account.address.toLowerCase(),
      ]);
      const disclosedAddress = accountReply.result[0] as string;
      const otherAddress = fixture.evmAddresses[1].toLowerCase();
      expect(otherAddress).not.toBe(disclosedAddress);
      const cases = [
        {
          name: 'canonical-text',
          params: [MESSAGE, disclosedAddress],
          signer: disclosedAddress,
          message: MESSAGE,
          preview: MESSAGE,
        },
        {
          name: 'canonical-byte-encoded-text',
          params: [HEX_MESSAGE, disclosedAddress],
          signer: disclosedAddress,
          message: HEX_MESSAGE,
          preview: MESSAGE,
        },
        {
          name: 'unambiguous-same-case-legacy',
          params: [baseline.account.address, MESSAGE],
          signer: baseline.account.address,
          message: MESSAGE,
          preview: MESSAGE,
        },
        {
          name: 'canonical-other-address-shaped-message',
          params: [otherAddress, disclosedAddress],
          signer: disclosedAddress,
          message: otherAddress,
          preview: otherAddress,
        },
        {
          name: 'unambiguous-lowercased-legacy',
          params: [disclosedAddress, MESSAGE],
          signer: disclosedAddress,
          message: MESSAGE,
          preview: MESSAGE,
        },
        {
          name: 'canonical-active-address-shaped-message',
          params: [baseline.account.address, disclosedAddress],
          signer: disclosedAddress,
          message: baseline.account.address,
          preview: baseline.account.address,
        },
      ];
      for (const scenario of cases) {
        await wallet.step(
          `${scenario.name}: inspect Data and cancel the same request`,
          async () => {
            const id = await startRequest(
              dapp!,
              'personal_sign',
              scenario.params
            );
            let popup = await popupFor(wallet!.context, dapp!, id);
            let warning:
              | {
                  closed: boolean;
                  data: {
                    eventName: string;
                    host: string;
                    requestCount: number;
                  };
                  requestId: number;
                }
              | undefined;
            if (new URL(popup.url()).pathname === '/external/spam-warning') {
              // Rejected prompts legitimately accumulate. Continue this real
              // warning instead of resetting policy or inventing an allow reply.
              const spamPopup = popup;
              await expect(
                spamPopup.getByRole('heading', {
                  name: en.spamWarning.title,
                  exact: true,
                })
              ).toBeVisible();
              await expect(
                spamPopup.getByText(server.url, { exact: true })
              ).toBeVisible();
              const data = await spamPopup.evaluate(() => {
                const value = JSON.parse(
                  new URL(location.href).searchParams.get('data')!
                );
                return {
                  host: value.host,
                  eventName: value.eventName,
                  requestCount: value.requestCount,
                };
              });
              expect(data).toEqual({
                host: server.url,
                eventName: 'spamWarningResponse',
                requestCount: 3,
              });
              const pending = await rpcObservation(dapp!, id);
              expect(pending.id).toBe(id);
              expect(pending.method).toBe('personal_sign');
              expect(pending.params).toEqual(scenario.params);
              expect(pending.settled).not.toBe(true);
              expect(pending.error).toBeUndefined();
              expect(pending.result).toBeUndefined();
              const warningImage = info.outputPath(
                `${scenario.name}-spam-warning-${viewport.width}.png`
              );
              await spamPopup.screenshot({
                path: warningImage,
                animations: 'disabled',
              });
              await info.attach(
                `${scenario.name}-spam-warning-${viewport.width}`,
                { path: warningImage, contentType: 'image/png' }
              );
              await clickClosingPopup({
                click: () =>
                  spamPopup
                    .getByRole('button', {
                      name: en.buttons.continue,
                      exact: true,
                    })
                    .click(),
                isClosed: () => spamPopup.isClosed(),
              });
              await expect.poll(() => spamPopup.isClosed()).toBe(true);
              const continued = await rpcObservation(dapp!, id);
              expect(continued.id).toBe(id);
              expect(continued.method).toBe('personal_sign');
              expect(continued.params).toEqual(scenario.params);
              expect(continued.settled).not.toBe(true);
              expect(continued.error).toBeUndefined();
              expect(continued.result).toBeUndefined();
              warning = { closed: spamPopup.isClosed(), data, requestId: id };
              popup = await popupFor(wallet!.context, dapp!, id);
            }
            expect(new URL(popup.url()).pathname).toBe('/external/tx/ethSign');
            await popup.setViewportSize(viewport);
            const data = popup.getByRole('button', {
              name: en.send.data,
              exact: true,
            });
            const confirm = popup.getByRole('button', {
              name: en.buttons.confirm,
              exact: true,
            });
            await expect(confirm).toBeEnabled();
            await expect(popup.locator('p.font-mono')).toHaveCount(1);
            const preview = await popup.locator('p.font-mono').textContent();
            expect(preview).toBe(scenario.preview);
            const routeRequest = JSON.parse(
              new URL(popup.url()).searchParams.get('data')!
            );
            expect([routeRequest[0], routeRequest[1]]).toEqual(scenario.params);
            expect(routeRequest.eventName).toBe('personal_sign');
            expect(routeRequest.host).toBe(server.url);
            expect(await publicState(popup)).toEqual(baseline);
            await tabTo(popup, data);
            const dataGeometry = await actionGeometry(data);
            await popup.keyboard.press('Enter');
            await expect(data).toBeFocused();
            const heading = popup.getByText(en.send.parameterInterpretation, {
              exact: true,
            });
            await expect(heading).toBeVisible();
            const interpretation = heading.locator('xpath=../..');
            const value = async (label: string) =>
              interpretation
                .getByText(label, { exact: true })
                .locator('xpath=..')
                .locator('span')
                .last()
                .textContent();
            const raw = await popup.locator('pre').allTextContents();
            const interpreted = {
              address: await value(en.send.address.trim()),
              message: await value(`${en.send.message}:`),
            };
            expect(raw).toEqual(scenario.params);
            expect(interpreted).toEqual({
              address: scenario.signer,
              message: scenario.message,
            });
            expect((await rpcObservation(dapp!, id)).settled).not.toBe(true);
            expect((await rpcObservation(dapp!, id)).result).toBeUndefined();
            expect((await rpcObservation(dapp!, id)).params).toEqual(
              scenario.params
            );
            expect(await publicState(wallet!.page)).toEqual(baseline);
            await interpretation.scrollIntoViewIfNeeded();
            if (scenario.name === 'canonical-text') {
              await checkReviewHeadingContainment(
                popup,
                heading,
                interpretation,
                info,
                `parameter-heading-${viewport.width}`
              );
            }
            const image = info.outputPath(
              `${scenario.name}-${viewport.width}.png`
            );
            await popup.screenshot({ path: image, animations: 'disabled' });
            await info.attach(`${scenario.name}-${viewport.width}`, {
              path: image,
              contentType: 'image/png',
            });
            const messageRow = interpretation
              .getByText(`${en.send.message}:`, { exact: true })
              .locator('xpath=..');
            const messageGeometry = await messageRowGeometry(popup, messageRow);
            const messageImage = info.outputPath(
              `${scenario.name}-message-row-${viewport.width}.png`
            );
            await popup.screenshot({
              path: messageImage,
              animations: 'disabled',
            });
            await info.attach(
              `${scenario.name}-message-row-${viewport.width}`,
              { path: messageImage, contentType: 'image/png' }
            );
            const cancel = popup.getByRole('button', {
              name: en.buttons.cancel,
              exact: true,
            });
            const cancelGeometry = await actionGeometry(cancel);
            await tabTo(popup, cancel);
            const canceled = await dismissRejectedApproval({
              click: () => popup.keyboard.press('Enter'),
              isClosed: () => popup.isClosed(),
              settle: () => settle(dapp!, id),
            });
            expect(canceled.error?.code).toBe(4001);
            expect(canceled.result).toBeUndefined();
            expect(canceled.params).toEqual(scenario.params);
            expect(await publicState(wallet!.page)).toEqual(baseline);
            expect(routes!.deniedWrites).toEqual([]);
            observations.push({
              name: scenario.name,
              viewport,
              requestId: id,
              warning,
              raw,
              interpreted,
              routeParams: [routeRequest[0], routeRequest[1]],
              preview,
              dataGeometry,
              messageGeometry,
              cancelGeometry,
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
        'all six requests rejected without a signature or context change',
        async () => {
          const requests = await dapp!.evaluate(
            () => (window as any).__paliConformance.requests
          );
          expect(requests.map((request: any) => request.method)).toEqual([
            'eth_requestAccounts',
            'eth_accounts',
            ...cases.map(() => 'personal_sign'),
          ]);
          for (const request of requests.slice(2)) {
            expect(request.settled).toBe(true);
            expect(request.error?.code).toBe(4001);
            expect(request.result).toBeUndefined();
          }
          expect(observations).toHaveLength(cases.length);
          expect(await publicState(wallet!.page)).toEqual(baseline);
          expect(routes!.deniedWrites).toEqual([]);
          expect(pageErrors).toEqual([]);
        }
      );
      status = 'passed';
    } finally {
      try {
        await info.attach(
          `personal-sign-parameter-evidence-${viewport.width}`,
          {
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
                reads: routes?.reads || [],
                fixtureDeniedWrites: routes?.deniedWrites || [],
                proxyDeniedConnections: server.blocked.length,
                pageErrors,
                observations,
              },
              null,
              2
            ),
          }
        );
      } catch (error) {
        status = 'failed';
        throw error;
      } finally {
        try {
          await wallet?.dispose(status);
        } finally {
          await server.close();
          Object.assign(E2E_CONFIG, previous);
        }
      }
    }
  });
}
