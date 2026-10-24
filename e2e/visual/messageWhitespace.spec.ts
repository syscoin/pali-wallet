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
      return {
        box: box.toJSON(),
        bottom,
        width: innerWidth,
        wheel: area
          ? { x: area.left + 12, y: Math.min(area.bottom, bottom) - 12 }
          : null,
      };
    });
  const before = await read();
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
        await wallet.importSeedAndCreatePassword();
        await wallet.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet.ensureOnHome();
        const fixture = Wallet.fromPhrase(UTXO_FIXTURE_SEED);
        const encryptionKey =
          method === 'eth_decrypt'
            ? getEncryptionPublicKey(fixture.privateKey.slice(2))
            : undefined;
        const dapp = await wallet.context.newPage();
        await dapp.goto(server.url);
        await dapp.waitForFunction(() =>
          Boolean((window as any).pali?.request)
        );
        const connect = await startRequest(dapp, 'eth_requestAccounts');
        expect(
          (await approve(wallet.context, dapp, connect)).result.map(
            (address: string) => address.toLowerCase()
          )
        ).toEqual([fixture.address.toLowerCase()]);
        // Release the ordinary extension window slot before requesting approval.
        // This navigates the test-owned page; it does not alter wallet state.
        await wallet.page.goto('about:blank');

        for (const [name, plaintext] of [
          ['single-line', SINGLE_LINE],
          ['multiline', MULTILINE],
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
