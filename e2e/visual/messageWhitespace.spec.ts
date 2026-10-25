// Ordinary provider approvals preserve user-readable message formatting.
// Public fixture encryption uses the same pinned helper as the SDK.
// eslint-disable-next-line import/no-extraneous-dependencies
import { encrypt, getEncryptionPublicKey } from '@metamask/eth-sig-util';
import { expect, test, type Locator } from '@playwright/test';
import { Wallet } from 'ethers';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  clickClosingPopup,
  dismissRejectedApproval,
} from '../harness/dismissRejectedApproval';
import { captureForegroundContrast } from '../harness/foregroundContrast';
import { expectCenteredHeadingLines } from '../harness/headingAlignment';
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

const MULTILINE = 'LINE-A\n\nLINE-B   GAP\nLINE-C';
const SINGLE_LINE = 'Public synthetic single-line control';

// No application DOM, styles, state, controller results or clocks are changed.
async function revealPreview(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const page = target.page();
  const read = () =>
    target.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const footer = document.querySelector('.fixed.bottom-0');
      const bottom = footer?.getBoundingClientRect().top ?? innerHeight;
      let surface: Element | null = element.parentElement;
      while (
        surface &&
        !(
          /auto|scroll/.test(getComputedStyle(surface).overflowY) &&
          surface.scrollHeight > surface.clientHeight + 1
        )
      )
        surface = surface.parentElement;
      const area = surface?.getBoundingClientRect();
      const intrinsicScrollportHeight = surface?.clientHeight ?? innerHeight;
      return {
        box: box.toJSON(),
        bottom,
        width: innerWidth,
        intrinsicScrollportHeight,
        wheel: area
          ? { x: area.left + 12, y: Math.min(area.bottom, bottom) - 12 }
          : null,
      };
    });
  const before = await read();
  if (before.box.height > before.intrinsicScrollportHeight + 1) {
    // The personal-message preview intentionally has a bounded inner scroller.
    // An oversized paragraph cannot fit there at once; prove its endpoints are
    // physically readable through native wheel scrolling instead of requiring
    // its whole bounding box to fit the outer viewport.
    await test.info().attach('scrollable-preview-initial', {
      body: await page.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    });
    const glyph = (last: boolean) =>
      target.evaluate((element, atEnd) => {
        const text = element.firstChild!;
        const offset = atEnd ? text.textContent!.length - 1 : 0;
        const range = document.createRange();
        range.setStart(text, offset);
        range.setEnd(text, offset + 1);
        const rect = range.getBoundingClientRect();
        const footer = document.querySelector('.fixed.bottom-0');
        const clip = {
          left: 0,
          right: innerWidth,
          top: 0,
          bottom: (footer?.getBoundingClientRect().top ?? innerHeight) - 4,
        };
        let wheel: { x: number; y: number } | null = null;
        for (
          let node = element.parentElement;
          node;
          node = node.parentElement
        ) {
          const style = getComputedStyle(node);
          const bounds = node.getBoundingClientRect();
          if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
            clip.top = Math.max(clip.top, bounds.top + node.clientTop);
            clip.bottom = Math.min(
              clip.bottom,
              bounds.top + node.clientTop + node.clientHeight
            );
          }
          if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
            clip.left = Math.max(clip.left, bounds.left + node.clientLeft);
            clip.right = Math.min(
              clip.right,
              bounds.left + node.clientLeft + node.clientWidth
            );
          }
          if (
            !wheel &&
            /auto|scroll/.test(style.overflowY) &&
            node.scrollHeight > node.clientHeight + 1
          )
            wheel = {
              x: Math.max(
                clip.left + 2,
                Math.min(clip.right - 2, bounds.left + 8)
              ),
              y: Math.max(
                clip.top + 2,
                Math.min(clip.bottom - 2, bounds.top + node.clientHeight / 2)
              ),
            };
        }
        if (wheel) {
          wheel.x = Math.max(clip.left + 2, Math.min(clip.right - 2, wheel.x));
          wheel.y = Math.max(clip.top + 2, Math.min(clip.bottom - 2, wheel.y));
        }
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2
        );
        return {
          glyph: rect.toJSON(),
          clip,
          wheel,
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            rect.left >= clip.left &&
            rect.right <= clip.right &&
            rect.top >= clip.top &&
            rect.bottom <= clip.bottom &&
            Boolean(hit && (element === hit || element.contains(hit))),
        };
      }, last);
    const endpoints = [];
    for (const last of [false, true]) {
      let observed = await glyph(last);
      for (let attempt = 0; !observed.visible && attempt < 20; attempt++) {
        expect(observed.wheel).not.toBeNull();
        await page.mouse.move(observed.wheel!.x, observed.wheel!.y);
        const delta =
          observed.glyph.top < observed.clip.top
            ? observed.glyph.top - observed.clip.top - 8
            : observed.glyph.bottom - observed.clip.bottom + 8;
        await page.mouse.wheel(0, delta);
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve())
              )
            )
        );
        observed = await glyph(last);
      }
      expect(
        observed.visible,
        `${last ? 'last' : 'first'} preview glyph is exposed`
      ).toBe(true);
      await test
        .info()
        .attach(`scrollable-preview-${last ? 'last' : 'first'}-glyph`, {
          body: await page.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        });
      endpoints.push(observed);
    }
    const result = await read();
    expect(result.box.left).toBeGreaterThanOrEqual(0);
    expect(result.box.right).toBeLessThanOrEqual(result.width);
    return { ...result, oversizedScrollport: true, before, endpoints };
  }
  if (before.box.bottom > before.bottom - 8) {
    expect(before.wheel).not.toBeNull();
    await page.mouse.move(before.wheel!.x, before.wheel!.y);
    await page.mouse.wheel(0, before.box.bottom - before.bottom + 16);
  }
  await expect
    .poll(async () => {
      const value = await read();
      return value.box.top >= 0 && value.box.bottom <= value.bottom - 4;
    })
    .toBe(true);
  const result = await read();
  expect(result.box.left).toBeGreaterThanOrEqual(0);
  expect(result.box.right).toBeLessThanOrEqual(result.width);
  return result;
}

for (const method of ['eth_decrypt', 'personal_sign'] as const) {
  for (const viewport of [
    { width: 400, height: 620 },
    { width: 320, height: 360 },
  ]) {
    test(`ordinary ${method} preview retains message whitespace at ${viewport.width}px`, async ({}, info) => {
      test.setTimeout(120_000);
      expect(info.config.workers).toBe(1);
      expect(info.retry).toBe(0);
      expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
      expect(E2E_CONFIG.extensionPath).toBe(
        process.env.PALI_TEST_DAPP_EXTENSION_PATH
      );
      expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/i);
      const runtime = extensionEvidence();
      expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
      const previous = { ...E2E_CONFIG };
      const server = await startUtxoFixtureServer();
      Object.assign(E2E_CONFIG, {
        seedPhrase: UTXO_FIXTURE_SEED,
        password: 'MessageWhitespaceSynthetic!2026',
        rpcUrl: server.url,
      });
      let wallet: PaliWallet | undefined;
      let status: 'passed' | 'failed' = 'failed';
      const observations: unknown[] = [];
      try {
        wallet = await PaliWallet.launch(
          `message-whitespace-${method}-${viewport.width}`,
          { offlineHttpProxy: server.url, viewport }
        );
        const routes = await installIsolatedVaultRoutes(
          wallet.context,
          createIsolatedVaultFixture(),
          server.url
        );
        await wallet.step(
          'onboard the disposable wallet and select the EVM fixture',
          async () => {
            await wallet!.importSeedAndCreatePassword();
            await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
            await wallet!.ensureOnHome();
          }
        );
        const fixture = Wallet.fromPhrase(UTXO_FIXTURE_SEED);
        const encryptionKey =
          method === 'eth_decrypt'
            ? getEncryptionPublicKey(fixture.privateKey.slice(2))
            : undefined;
        const dapp = await wallet.step(
          'connect the actual provider and release the ordinary window slot',
          async (capture) => {
            const page = await wallet!.context.newPage();
            await page.goto(server.url);
            await page.waitForFunction(() =>
              Boolean((window as any).pali?.request)
            );
            const connect = await startRequest(page, 'eth_requestAccounts');
            expect(
              (
                await approve(wallet!.context, page, connect, capture)
              ).result.map((address: string) => address.toLowerCase())
            ).toEqual([fixture.address.toLowerCase()]);
            // Release the ordinary extension window slot before requesting approval.
            // This navigates the test-owned page; it does not alter wallet state.
            await wallet!.page.goto('about:blank');
            return page;
          }
        );

        for (const [name, plaintext] of [
          ['single-line', SINGLE_LINE],
          ['multiline', MULTILINE],
          ['human-words', 'Review this public clipboard fixture.'],
          ['long-token', 'A'.repeat(96)],
        ]) {
          await wallet.step(
            `${name}: review a real ${method} request and cancel`,
            async () => {
              const requestValue =
                method === 'eth_decrypt'
                  ? `0x${Buffer.from(
                      JSON.stringify(
                        encrypt({
                          publicKey: encryptionKey!,
                          data: plaintext,
                          version: 'x25519-xsalsa20-poly1305',
                        })
                      )
                    ).toString('hex')}`
                  : plaintext;
              const params = [requestValue, fixture.address];
              const id = await startRequest(dapp, method, params);
              let popup = await popupFor(wallet!.context, dapp, id);
              if (new URL(popup.url()).pathname === '/external/spam-warning') {
                await expect(
                  popup.getByRole('heading', {
                    name: en.spamWarning.title,
                    exact: true,
                  })
                ).toBeVisible();
                await expect(
                  popup.getByText(server.url, { exact: true })
                ).toBeVisible();
                expect(await rpcObservation(dapp, id)).toMatchObject({
                  method,
                  params,
                });
                const warning = popup;
                await clickClosingPopup({
                  click: () =>
                    warning
                      .getByRole('button', {
                        name: en.buttons.continue,
                        exact: true,
                      })
                      .click(),
                  isClosed: () => warning.isClosed(),
                });
                popup = await popupFor(wallet!.context, dapp, id);
              }
              expect(new URL(popup.url()).pathname).toBe(
                method === 'eth_decrypt'
                  ? '/external/tx/decrypt'
                  : '/external/tx/ethSign'
              );
              await popup.setViewportSize(viewport);
              if (method === 'personal_sign') {
                const heading = popup.getByRole('heading', {
                  name: en.send.signPersonalMessage,
                  exact: true,
                });
                await info.attach(
                  `signature-heading-${name}-${viewport.width}`,
                  {
                    body: JSON.stringify(
                      await expectCenteredHeadingLines(heading)
                    ),
                    contentType: 'application/json',
                  }
                );
              }
              const query = JSON.parse(
                new URL(popup.url()).searchParams.get('data')!
              );
              expect([query[0], query[1]]).toEqual(params);
              expect(query.eventName).toBe(method);
              expect(query.host).toBe(server.url);
              await expect(
                popup.getByRole('button', {
                  name: en.buttons.confirm,
                  exact: true,
                })
              ).toBeEnabled();
              if (method === 'eth_decrypt') {
                const reveal = popup.getByRole('button', {
                  name: en.transactions.decryptMessage,
                  exact: true,
                });
                await expect(reveal).toBeEnabled();
                await popup.mouse.move(0, 0);
                await captureForegroundContrast(
                  reveal.getByText(en.transactions.decryptMessage, {
                    exact: true,
                  }),
                  info,
                  `decrypt-action-${name}-${viewport.width}`
                );
                await reveal.click();
              }
              const preview =
                method === 'eth_decrypt'
                  ? popup.getByText(plaintext, { exact: true })
                  : popup.locator('p.font-mono');
              await expect(preview).toHaveCount(1);
              await expect(preview).toBeVisible();
              expect(await preview.textContent()).toBe(plaintext);
              const geometry = await revealPreview(preview);
              const text = await preview.evaluate((element) => {
                const source = element.textContent!;
                const node = element.firstChild!;
                const box = (start: number, end: number) => {
                  const range = document.createRange();
                  range.setStart(node, start);
                  range.setEnd(node, end);
                  return range.getBoundingClientRect().toJSON();
                };
                const lineA = source.indexOf('LINE-A');
                const lineB = source.indexOf('LINE-B');
                const spaces = source.indexOf('   ');
                return {
                  source,
                  innerText: (element as HTMLElement).innerText,
                  whiteSpace: getComputedStyle(element).whiteSpace,
                  lineHeight: getComputedStyle(element).lineHeight,
                  lineA: lineA >= 0 ? box(lineA, lineA + 6) : null,
                  lineB: lineB >= 0 ? box(lineB, lineB + 6) : null,
                  threeSpaces: spaces >= 0 ? box(spaces, spaces + 3) : null,
                  oneSpace: spaces >= 0 ? box(spaces, spaces + 1) : null,
                  words: Array.from(
                    source.matchAll(/[A-Za-z]{4,}/g),
                    (match) => {
                      const range = document.createRange();
                      range.setStart(node, match.index!);
                      range.setEnd(node, match.index! + match[0].length);
                      return {
                        word: match[0],
                        lines: new Set(
                          Array.from(range.getClientRects(), (rect) =>
                            Math.round(rect.top)
                          )
                        ).size,
                      };
                    }
                  ),
                  horizontalOverflow:
                    element.scrollWidth > element.clientWidth + 1,
                };
              });
              if (name === 'multiline') {
                expect(['pre', 'pre-wrap', 'break-spaces']).toContain(
                  text.whiteSpace
                );
                expect(text.innerText).toBe(plaintext);
                expect(text.lineB!.top - text.lineA!.top).toBeGreaterThan(
                  Number.parseFloat(text.lineHeight) * 1.5
                );
                expect(text.threeSpaces!.width).toBeGreaterThan(
                  text.oneSpace!.width * 2.5
                );
              }
              const pending = await rpcObservation(dapp, id);
              expect(pending).toMatchObject({ method, params });
              expect(pending.settled).not.toBe(true);
              expect(pending.result).toBeUndefined();
              const screenshot = info.outputPath(
                `${method}-${name}-${viewport.width}.png`
              );
              await popup.mouse.move(0, 0);
              await popup.screenshot({
                path: screenshot,
                animations: 'disabled',
              });
              await info.attach(`${name}-${viewport.width}`, {
                path: screenshot,
                contentType: 'image/png',
              });
              if (name === 'human-words') {
                expect(text.words.every((word) => word.lines === 1)).toBe(true);
              }
              if (name === 'long-token') {
                expect(text.horizontalOverflow).toBe(false);
                expect(text.source).toBe(plaintext);
              }
              observations.push({
                name,
                viewport,
                text,
                geometry,
                previewOnly: true,
              });
              const rejected = await dismissRejectedApproval({
                click: () =>
                  popup
                    .getByRole('button', {
                      name: en.buttons.cancel,
                      exact: true,
                    })
                    .click(),
                isClosed: () => popup.isClosed(),
                settle: () => settle(dapp, id),
              });
              expect(rejected.error?.code).toBe(4001);
              expect(rejected.result).toBeUndefined();
            }
          );
        }
        expect(routes.deniedWrites).toEqual([]);
        expect(extensionEvidence()).toEqual(runtime);
        await info.attach('message-whitespace-evidence', {
          contentType: 'application/json',
          body: JSON.stringify(
            {
              runtime,
              method,
              viewport,
              observations,
              deniedWrites: routes.deniedWrites,
            },
            null,
            2
          ),
        });
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
}
