import { parseEther } from '@ethersproject/units';
import {
  type CDPSession,
  type Locator,
  type Page,
  expect,
  test,
} from '@playwright/test';
import fs from 'fs';
import path from 'path';

import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';

import { DEMO_DAPP_URL, installDemoDapp } from './demoDapp';
import { predictAndFundSmartAccounts } from './fundSmartAccounts';

// Captures the raw screenshots and screen recordings that compose.mjs turns
// into the branded media set for the docs portal. Everything runs against
// the live zkTanenbaum / Syscoin Testnet networks with the shared QA seed.
//
// Output layout (all gitignored):
//   out/raw/<name>.png    pristine wallet/dapp screenshots (2x DPR)
//   out/video/<name>.webm popup screen recordings (converted to mp4 later)
//   out/report.json       per-capture status for triage
//
// Smart-account note: addresses derive deterministically from the seed and
// account index, and earlier QA loops have deployed (and validator-rotated)
// the low indices on-chain. Flows that must sign with a fresh passkey first
// advance the index with throwaway in-app smart accounts until the next
// derived address has no code on-chain.

const OUT_DIR = path.join(__dirname, 'out');
const RAW_DIR = path.join(OUT_DIR, 'raw');
const VIDEO_DIR = path.join(OUT_DIR, 'video');

const VIEWPORT = { height: 620, width: 400 };

type CaptureStatus = { detail?: string; name: string; status: 'ok' | 'skip' };
const report: CaptureStatus[] = [];

const ensureDirs = () => {
  for (const dir of [RAW_DIR, VIDEO_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const shot = async (
  page: Page,
  name: string,
  options: { fullPage?: boolean } = {}
) => {
  await page.screenshot({
    fullPage: options.fullPage ?? false,
    path: path.join(RAW_DIR, `${name}.png`),
  });
};

const settle = async (page: Page, ms = 1200) => {
  // Popups hold a background port open, so networkidle never fires; cap the
  // wait so it can't silently stall the recording for the full 30s default.
  await page
    .waitForLoadState('networkidle', { timeout: 3000 })
    .catch(() => undefined);
  await page.waitForTimeout(ms);
  await page
    .evaluate(() => {
      window.scrollTo(0, 0);
      document
        .querySelectorAll('*')
        .forEach((el) => el.scrollTop > 0 && (el.scrollTop = 0));
    })
    .catch(() => undefined);
  await page.waitForTimeout(150);
};

test('docs media capture', async () => {
  ensureDirs();
  // Smart accounts pay their own deployment/userOp gas, so pre-fund the
  // deterministic addresses this run will mint (index 0 = in-app account,
  // 1+ = dapp onboarding attempts and retries).
  // Earlier QA runs deployed-and-burned the low indices, so the onboarding
  // walk has to clear ~27 of them before reaching a fresh one. Fund a wide
  // range so the first fresh index is always pre-funded for its deploy gas.
  // Pali gates the deploy behind balance >= gasUnitsReserve * maxFeePerGas
  // (~2M units for a composite deploy); testnet fees spike past 100 gwei, so
  // fresh indices need a healthy reserve or every attempt dies with
  // "Insufficient funds to cover gas fees" (run7 failure mode).
  const funded = await predictAndFundSmartAccounts({
    indexCount: 40,
    minBalance: parseEther('0.5'),
    topUp: parseEther('1'),
  });
  for (const account of funded) {
    console.log(
      `[docs-media] smart-account index=${account.accountIndex} ${account.address} deployed=${account.deployed} balance=${account.balance}`
    );
  }
  const wallet = await PaliWallet.launch('docs-media', {
    deviceScaleFactor: 2,
    viewport: VIEWPORT,
  });
  // Popup webm paths are only final after the context closes; remember the
  // source path per published name and copy at the very end.
  const videoSources: Array<{ name: string; source: string }> = [];
  // WebAuthn credentials created in one popup must be re-seeded into the
  // virtual authenticator of every later popup (each page gets its own).
  let passkeyCredentials: any[] = [];

  const capture = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      report.push({ name, status: 'ok' });
    } catch (error) {
      report.push({
        detail: error instanceof Error ? error.message : String(error),
        name,
        status: 'skip',
      });
      await wallet.gotoRoute('#/home').catch(() => undefined);
    }
  };

  const waitForPopup = async (): Promise<Page> => {
    const popup = await wallet.context.waitForEvent('page', {
      timeout: 60_000,
    });
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
    // Untrusted-site confirmation (second dialog) when the origin is not on
    // the trusted list.
    const second = popup
      .getByRole('button', { name: /^(confirm|connect|proceed)$/i })
      .first();
    if (await second.isVisible({ timeout: 4_000 }).catch(() => false)) {
      await second.click();
    }
  };

  // Close a popup through its Cancel button so the background rejects the
  // pending dapp request; force-closing the window can leave the request
  // coordinator blocked for every later popup.
  const cancelPopup = async (popup: Page) => {
    if (popup.isClosed()) return;
    const cancel = popup
      .getByRole('button', { name: /^(cancel|reject)$/i })
      .first();
    if (await cancel.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await cancel.click().catch(() => undefined);
      await popup
        .waitForEvent('close', { timeout: 10_000 })
        .catch(() => undefined);
    }
    if (!popup.isClosed()) await popup.close().catch(() => undefined);
  };

  const trackPopupVideo = async (popup: Page, name: string) => {
    const video = popup.video();
    if (!video) return;
    const source = await video.path().catch(() => undefined);
    if (source) videoSources.push({ name, source });
  };

  // Resolve a Video object's path even after its page closed (Playwright
  // finalizes the file at context close). Used to keep the popup recording
  // for stitching once the popup window has closed itself.
  const trackVideoObject = async (
    video: ReturnType<Page['video']>,
    name: string
  ) => {
    if (!video) return;
    const source = await video.path().catch(() => undefined);
    if (source) videoSources.push({ name, source });
  };

  // Millisecond timestamps recorded while filming; compose.mjs uses them to
  // trim the dapp/popup recordings into one continuous story per video.
  const videoMarks: Record<string, Record<string, number>> = {};

  // Playwright clicks render no pointer, so recordings read as "the UI moved
  // by itself". Animate a fake cursor to the target and pulse a ripple before
  // the real click so the viewer can follow the action.
  const animateCursorClick = async (page: Page, locator: Locator) => {
    await locator.scrollIntoViewIfNeeded().catch(() => undefined);
    const box = await locator.boundingBox().catch(() => null);
    if (!box) {
      await locator.click();
      return;
    }
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page
      .evaluate(
        ({ x: targetX, y: targetY }) => {
          let dot = document.getElementById(
            '__docs_cursor'
          ) as HTMLDivElement | null;
          if (!dot) {
            dot = document.createElement('div');
            dot.id = '__docs_cursor';
            Object.assign(dot.style, {
              background: 'rgba(255,255,255,0.9)',
              border: '2px solid rgba(76,161,207,0.95)',
              borderRadius: '50%',
              boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
              height: '16px',
              left: '55%',
              pointerEvents: 'none',
              position: 'fixed',
              top: '80%',
              transform: 'translate(-50%, -50%)',
              transition:
                'left 0.55s cubic-bezier(.2,.7,.3,1), top 0.55s cubic-bezier(.2,.7,.3,1)',
              width: '16px',
              zIndex: '2147483647',
            });
            document.body.appendChild(dot);
          }
          requestAnimationFrame(() => {
            dot.style.left = `${targetX}px`;
            dot.style.top = `${targetY}px`;
          });
        },
        { x, y }
      )
      .catch(() => undefined);
    await page.waitForTimeout(650);
    await page
      .evaluate(
        ({ x: targetX, y: targetY }) => {
          const ripple = document.createElement('div');
          Object.assign(ripple.style, {
            border: '3px solid rgba(76,161,207,0.95)',
            borderRadius: '50%',
            height: '8px',
            left: `${targetX}px`,
            opacity: '1',
            pointerEvents: 'none',
            position: 'fixed',
            top: `${targetY}px`,
            transform: 'translate(-50%,-50%) scale(1)',
            transition: 'transform 0.4s ease-out, opacity 0.4s ease-out',
            width: '8px',
            zIndex: '2147483646',
          });
          document.body.appendChild(ripple);
          requestAnimationFrame(() => {
            ripple.style.transform = 'translate(-50%,-50%) scale(6)';
            ripple.style.opacity = '0';
          });
          setTimeout(() => ripple.remove(), 500);
        },
        { x, y }
      )
      .catch(() => undefined);
    await page.waitForTimeout(200);
    await locator.click();
  };

  // Glide the main scroll container to the bottom and back so the recording
  // shows the whole review screen instead of just the fold.
  const smoothScrollShowcase = async (page: Page, holdMs = 700) => {
    await page
      .evaluate(async (hold) => {
        const sleep = (ms: number) =>
          new Promise((resolve) => setTimeout(resolve, ms));
        const scroller =
          Array.from(document.querySelectorAll('*')).find(
            (el) =>
              el.scrollHeight > el.clientHeight + 80 &&
              ['auto', 'scroll'].includes(getComputedStyle(el).overflowY)
          ) || document.scrollingElement;
        if (!scroller) return;
        const max = scroller.scrollHeight - scroller.clientHeight;
        if (max < 40) return;
        const steps = 26;
        for (let i = 1; i <= steps; i++) {
          scroller.scrollTop = (max * i) / steps;
          await sleep(30);
        }
        await sleep(hold);
        for (let i = steps - 1; i >= 0; i--) {
          scroller.scrollTop = (max * i) / steps;
          await sleep(24);
        }
      }, holdMs)
      .catch(() => undefined);
  };

  // Fresh dapp page sized like the popup so its recording fills the same
  // 400x620 frame, with the action buttons + result line visible on camera.
  const openVideoDappPage = async (): Promise<{
    openedAt: number;
    page: Page;
    readyMs: number;
  }> => {
    const openedAt = Date.now();
    const page = await wallet.context.newPage();
    await page.setViewportSize(VIEWPORT);
    await page.goto(DEMO_DAPP_URL);
    await page.waitForFunction(
      () => Boolean((window as any).ethereum && (window as any).pali),
      { timeout: 30_000 }
    );
    await page.evaluate(() => document.body.classList.add('debug'));
    // Wait for the picker to actually paint (the Pali provider row renders
    // once eip6963 announces) so the recording opens on real UI, not the
    // blank white page that precedes first paint.
    await page
      .waitForSelector('.provider.detected', { timeout: 15_000 })
      .catch(() => undefined);
    await page.waitForTimeout(700);
    const readyMs = Date.now() - openedAt;
    return { openedAt, page, readyMs };
  };

  const resetOut = (page: Page) =>
    page.evaluate(() => {
      const out = document.getElementById('out');
      if (out) {
        out.textContent = 'idle';
        out.className = '';
      }
    });

  // Auto-approve WebAuthn so passkey flows run headless: a CTAP2 "internal"
  // authenticator with automatic presence simulation behaves like Touch ID
  // that instantly approves. Re-seeds previously created credentials.
  const armVirtualAuthenticator = async (
    popup: Page
  ): Promise<{ authenticatorId: string; cdp: CDPSession }> => {
    const cdp = await wallet.context.newCDPSession(popup);
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = (await cdp.send(
      'WebAuthn.addVirtualAuthenticator',
      {
        options: {
          automaticPresenceSimulation: true,
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          protocol: 'ctap2',
          transport: 'internal',
        },
      }
    )) as { authenticatorId: string };
    let seeded = 0;
    for (const credential of passkeyCredentials) {
      try {
        // Seed exactly as harvested: Chrome records extension-page passkeys
        // with rpId "chrome-extension://<id>" (the full origin), and any
        // override (e.g. the bare extension id) leaves the credential
        // visible in the authenticator but unmatched at assertion time,
        // which surfaces as NotAllowedError when signing.
        await cdp.send('WebAuthn.addCredential', {
          authenticatorId,
          credential,
        });
        seeded += 1;
      } catch (error) {
        console.log(
          `[docs-media] addCredential failed: ${(error as Error).message}`
        );
      }
    }
    if (passkeyCredentials.length > 0) {
      console.log(
        `[docs-media] authenticator armed, re-seeded ${seeded}/${passkeyCredentials.length} passkey credential(s)`
      );
    }
    return { authenticatorId, cdp };
  };

  const harvestCredentials = async (
    cdp: CDPSession,
    authenticatorId: string
  ) => {
    const { credentials } = (await cdp.send('WebAuthn.getCredentials', {
      authenticatorId,
    })) as { credentials: any[] };
    if (credentials.length > 0) passkeyCredentials = credentials;
  };

  const dismissCreatedModal = async () => {
    const okButton = wallet.page.getByRole('button', { name: /^ok$/i }).first();
    await expect(okButton).toBeVisible({
      timeout: E2E_CONFIG.slowActionTimeoutMs,
    });
    await okButton.click();
    await wallet.page.waitForURL(/#\/home/, { timeout: 30_000 });
  };

  const createInAppSmartAccount = async () => {
    await wallet.gotoRoute('#/settings/account/new');
    const createSmartAccount = wallet.page
      .getByRole('button', { name: /create smart account/i })
      .first();
    await expect(createSmartAccount).toBeVisible({ timeout: 30_000 });
    await createSmartAccount.click();
    await dismissCreatedModal();
  };

  const selectAccount = async (pattern: RegExp) => {
    await wallet.ensureOnHome();
    await wallet.page.locator('#general-settings-button').click();
    const item = wallet.page.getByText(pattern).first();
    await expect(item).toBeVisible({ timeout: 30_000 });
    await item.click();
    await wallet.page
      .locator('#home-balance')
      .waitFor({ state: 'visible', timeout: 60_000 });
    await wallet.page.waitForTimeout(1500);
  };

  try {
    // ---- Wallet-side captures ---------------------------------------------

    await wallet.importSeedAndCreatePassword();
    await wallet.switchNetwork(E2E_CONFIG.networkLabel);
    await wallet.ensureOnHome();

    await capture('home-unlocked', async () => {
      await wallet.ensureOnHome();
      await settle(wallet.page, 2500);
      await shot(wallet.page, 'home-unlocked');
    });

    await capture('settings-smart-account-create', async () => {
      await wallet.gotoRoute('#/settings/account/new');
      await settle(wallet.page);
      await shot(wallet.page, 'settings-smart-account-create');
    });

    // One visible smart account for the connect-popup account list.
    await capture('create-smart-account', createInAppSmartAccount);

    await capture('evm-send-review', async () => {
      await selectAccount(/^Account 1/);
      const selfAddress = await wallet.getActiveAccountAddress();
      await wallet.ensureOnHome();
      await wallet.page.locator('#send-btn').click();
      await expect(wallet.page).toHaveURL(/send\/eth/, { timeout: 30_000 });
      await wallet.page
        .getByPlaceholder(/receiver/i)
        .first()
        .fill(selfAddress);
      await wallet.page
        .getByPlaceholder(/amount/i)
        .first()
        .fill('1');
      await wallet.page.waitForTimeout(2000);
      await wallet.page.getByRole('button', { name: /next/i }).first().click();
      await expect(wallet.page).toHaveURL(/send\/confirm/, {
        timeout: 30_000,
      });
      await settle(wallet.page, 3500);
      await shot(wallet.page, 'evm-send-review');
      await wallet.gotoRoute('#/home');
    });

    // ---- Dapp captures (EVM) ----------------------------------------------

    await installDemoDapp(wallet.context);
    await selectAccount(/^Account 1/);
    // Pali refuses to open dapp popups while an extension tab is open; park
    // the harness tab so the background can spawn external.html windows.
    await wallet.page.goto('about:blank');

    const dappPage = await wallet.context.newPage();
    await dappPage.setViewportSize({ height: 600, width: 760 });
    await dappPage.goto(DEMO_DAPP_URL);
    await dappPage.waitForFunction(
      () => Boolean((window as any).ethereum && (window as any).pali),
      { timeout: 30_000 }
    );

    const dappClick = (id: string) =>
      dappPage.evaluate(
        (buttonId) =>
          (
            document.getElementById(buttonId) as HTMLButtonElement | null
          )?.click(),
        id
      );

    const dappOut = dappPage.locator('#out');
    const resetDappOut = () => resetOut(dappPage);

    await capture('eip6963-pali-provider', async () => {
      await dappPage.waitForSelector('.provider.detected', {
        timeout: 15_000,
      });
      await dappPage.waitForTimeout(800);
      await shot(dappPage, 'eip6963-pali-provider');
    });

    await capture('connect-dapp-popup', async () => {
      const popupPromise = waitForPopup();
      await dappClick('connect');
      const popup = await popupPromise;
      await settle(popup, 2500);
      await shot(popup, 'connect-dapp-popup');
      await clickConfirm(popup);
      await expect(dappOut).toContainText(/connected:0x[a-fA-F0-9]{40}/, {
        timeout: 60_000,
      });
    });

    await capture('typed-data-review', async () => {
      await resetDappOut();
      const popupPromise = waitForPopup();
      await dappClick('sign-typed');
      const popup = await popupPromise;
      await settle(popup, 2500);
      await shot(popup, 'typed-data-review');
      await clickConfirm(popup);
      await expect(dappOut).toContainText(/typed-signed:0x/, {
        timeout: 120_000,
      });
    });

    // ---- Smart-account onboarding video (dapp-requested, passkey) ---------

    // Smart-account addresses derive deterministically from seed + index and
    // earlier QA loops have deployed and validator-rotated the low indices
    // on-chain (their passkeys are gone). On an index collision the popup
    // fails with a passkey mismatch; burn the index with a throwaway in-app
    // smart account and retry on the next one.
    let passkeyAccountReady = false;
    await capture('smart-account-dapp-onboarding', async () => {
      // Each attempt films on its own dapp page so the recording opens on the
      // dapp (button -> popup -> success), telling the whole story rather than
      // starting mid-popup. Only the successful attempt's video is published.
      const attemptPrepare = async (
        takeShot: boolean
      ): Promise<{
        dapp?: Page;
        detail?: string;
        marks?: Record<string, number>;
        ok: boolean;
        popupVideo?: ReturnType<Page['video']>;
        retryable?: boolean;
      }> => {
        const { openedAt, page: dapp, readyMs } = await openVideoDappPage();
        const marks: Record<string, number> = { open: 0, ready: readyMs };
        const out = dapp.locator('#out');
        const button = dapp.locator('#smart-account');
        await expect(button).toBeVisible({ timeout: 15_000 });

        const popupPromise = waitForPopup();
        marks.click = Date.now() - openedAt;
        await animateCursorClick(dapp, button);
        const popup = await popupPromise;
        const popupVideo = popup.video();
        // Popup recording starts at popup creation; track events in its own
        // timeline so compose can cut the static pre-confirm wait.
        const popupStart = Date.now();
        const { authenticatorId, cdp } = await armVirtualAuthenticator(popup);
        await settle(popup, 2000);
        marks.popup = Date.now() - openedAt;
        if (takeShot) {
          await shot(popup, 'smart-account-prepare-popup');
          const detailsToggle = popup.getByText(/show details/i).first();
          if (
            await detailsToggle.isVisible({ timeout: 3000 }).catch(() => false)
          ) {
            await detailsToggle.click();
            await popup.waitForTimeout(700);
            await shot(popup, 'smart-account-prepare-details');
            await detailsToggle.click().catch(() => undefined);
            await popup.waitForTimeout(400);
          }
        }
        // Expand the request detail, then scroll the popup so the reviewer can
        // actually read it on camera before the button is pressed. The scroll
        // runs even without a toggle: the prepare screen always has content
        // (site, network, sign-in method) below the fold worth showing.
        const detailsToggle = popup.getByText(/show details/i).first();
        if (
          await detailsToggle.isVisible({ timeout: 3000 }).catch(() => false)
        ) {
          await animateCursorClick(popup, detailsToggle);
          await popup.waitForTimeout(900);
        }
        await smoothScrollShowcase(popup, 1400);
        marks.pDetailsDone = Date.now() - popupStart;

        const confirmButton = popup
          .getByRole('button', { name: /^confirm$/i })
          .first();
        await expect(confirmButton).toBeEnabled({ timeout: 30_000 });
        marks.confirm = Date.now() - openedAt;
        marks.pConfirm = Date.now() - popupStart;
        await animateCursorClick(popup, confirmButton);

        // The popup performs the full validator setup (passkey + on-chain
        // module install) and closes when done; errors render in an inline
        // card that can sit behind the fixed footer, so read the DOM text.
        const deadline = Date.now() + E2E_CONFIG.slowActionTimeoutMs;
        let failure = '';
        for (;;) {
          if (Date.now() > deadline) {
            failure = 'timed out waiting for prepareSmartAccount to settle';
            break;
          }
          const outText = (await out.textContent().catch(() => '')) || '';
          if (/smart-account:/.test(outText)) break;
          if (/smart-account-error:/.test(outText)) {
            failure = outText;
            break;
          }
          if (!popup.isClosed()) {
            await harvestCredentials(cdp, authenticatorId).catch(
              () => undefined
            );
            const bodyText = await popup
              .evaluate(() => document.body.innerText)
              .catch(() => '');
            const errorLine = bodyText
              .split('\n')
              .find((line) =>
                /does not match|insufficient|failed|cancelled/i.test(line)
              );
            if (errorLine) {
              failure = `popup error: ${errorLine}`;
              break;
            }
          }
          await dapp.waitForTimeout(800);
        }

        if (failure) {
          await cancelPopup(popup);
          await dapp.close().catch(() => undefined);
          return {
            detail: failure,
            ok: false,
            retryable: /does not match|insufficient/i.test(failure),
          };
        }

        // Popup closed itself on success; the dapp's green success line is now
        // showing. Hold on it so the final stitched segment lands cleanly.
        if (!popup.isClosed()) await popup.close().catch(() => undefined);
        await dapp.bringToFront().catch(() => undefined);
        await out
          .filter({ hasText: /smart-account:/ })
          .waitFor({ state: 'visible', timeout: 15_000 })
          .catch(() => undefined);
        marks.success = Date.now() - openedAt;
        await dapp.waitForTimeout(2600);
        marks.end = Date.now() - openedAt;
        return { dapp, marks, ok: true, popupVideo };
      };

      await wallet.page.goto('about:blank');
      let lastDetail = '';
      // The retry must walk past every index a prior QA run deployed before it
      // reaches a fresh one, so the cap has to exceed that deployed count
      // (kept in step with the pre-funded index range above).
      for (let attempt = 0; attempt < 38; attempt++) {
        const result = await attemptPrepare(attempt === 0);
        if (result.ok && result.dapp) {
          // Stitch dapp lead-in + popup signing + dapp success in compose.
          await trackPopupVideo(
            result.dapp,
            'smart-account-dapp-onboarding__dapp'
          );
          await trackVideoObject(
            result.popupVideo,
            'smart-account-dapp-onboarding__popup'
          );
          if (result.marks) {
            videoMarks['smart-account-dapp-onboarding'] = {
              ...result.marks,
              stitch: 1,
            };
          }
          await result.dapp.close().catch(() => undefined);
          passkeyAccountReady = true;
          return;
        }
        lastDetail = result.detail || 'unknown failure';
        if (!result.retryable) break;
      }
      throw new Error(lastDetail);
    });

    // ---- wallet_sendCalls batch (review shot + video) ----------------------

    await capture('send-calls-smart-account-batch', async () => {
      if (!passkeyAccountReady) {
        // Fall back to the newest in-app smart account (fresh index, ECDSA
        // bootstrap): register it on-chain via the policy page, then point
        // the dapp permission at it.
        await wallet.gotoRoute('#/home');
        await wallet.page.locator('#general-settings-button').click();
        const smartAccountItem = wallet.page
          .locator('[id^="account-SmartAccount"]')
          .last();
        await expect(smartAccountItem).toBeVisible({ timeout: 30_000 });
        await smartAccountItem.click();
        await wallet.page
          .locator('#home-balance')
          .waitFor({ state: 'visible', timeout: 60_000 });
        await wallet.page.goto('about:blank');
        await resetDappOut();
        const popupPromise = waitForPopup();
        await dappClick('connect');
        const popup = await popupPromise;
        await clickConfirm(popup);
        await expect(dappOut).toContainText(/connected:0x[a-fA-F0-9]{40}/, {
          timeout: 60_000,
        });
      }

      // Film from a popup-sized dapp page: button -> review (scroll +
      // details) -> sign -> green batch result on the dapp.
      await wallet.page.goto('about:blank');
      const { openedAt, page: dapp, readyMs } = await openVideoDappPage();
      const marks: Record<string, number> = { open: 0, ready: readyMs };
      const out = dapp.locator('#out');
      const batchButton = dapp.locator('#send-calls');
      await expect(batchButton).toBeVisible({ timeout: 15_000 });

      const popupPromise = waitForPopup();
      marks.click = Date.now() - openedAt;
      await animateCursorClick(dapp, batchButton);
      const popup = await popupPromise;
      const popupVideo = popup.video();
      const popupStart = Date.now();
      await armVirtualAuthenticator(popup);
      await settle(popup, 2500);
      marks.popup = Date.now() - openedAt;
      await shot(popup, 'send-calls-smart-account-batch');

      // Walk the review on camera: scroll through the calls, expand details.
      await smoothScrollShowcase(popup, 800);
      const detailsToggle = popup.getByText(/show details/i).first();
      if (await detailsToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
        await animateCursorClick(popup, detailsToggle);
        await popup.waitForTimeout(1000);
        await smoothScrollShowcase(popup, 600);
      }
      marks.pDetailsDone = Date.now() - popupStart;

      const signButton = popup
        .getByRole('button', { name: /^(sign|confirm|approve|send)$/i })
        .first();
      await expect(signButton).toBeVisible({ timeout: 30_000 });
      marks.sign = Date.now() - openedAt;
      marks.pConfirm = Date.now() - popupStart;
      await animateCursorClick(popup, signButton);

      const outcome = await Promise.race([
        out
          .filter({ hasText: /send-calls:/ })
          .waitFor({
            state: 'visible',
            timeout: E2E_CONFIG.slowActionTimeoutMs,
          })
          .then(() => 'done' as const),
        out
          .filter({ hasText: /send-calls-error:/ })
          .waitFor({
            state: 'visible',
            timeout: E2E_CONFIG.slowActionTimeoutMs,
          })
          .then(() => 'error' as const),
        popup
          .waitForEvent('close', { timeout: E2E_CONFIG.slowActionTimeoutMs })
          .then(() => 'closed' as const),
      ]).catch(() => 'timeout' as const);

      if (outcome === 'error' || outcome === 'timeout') {
        const text = await out.textContent().catch(() => '');
        const popupText = popup.isClosed()
          ? ''
          : await popup.evaluate(() => document.body.innerText).catch(() => '');
        await cancelPopup(popup);
        await dapp.close().catch(() => undefined);
        throw new Error(
          `wallet_sendCalls outcome=${outcome} dapp=${text} popup=${popupText.slice(
            0,
            600
          )}`
        );
      }

      // End on the dapp's green batch result for a clear success beat.
      if (!popup.isClosed()) await popup.close().catch(() => undefined);
      await dapp.bringToFront().catch(() => undefined);
      await out
        .filter({ hasText: /send-calls:/ })
        .waitFor({ state: 'visible', timeout: 15_000 })
        .catch(() => undefined);
      marks.success = Date.now() - openedAt;
      await dapp.waitForTimeout(2800);
      marks.end = Date.now() - openedAt;
      // Stitch dapp lead-in + popup review/sign + dapp success in compose.
      await trackPopupVideo(dapp, 'smart-account-batch-sendcalls__dapp');
      await trackVideoObject(
        popupVideo,
        'smart-account-batch-sendcalls__popup'
      );
      videoMarks['smart-account-batch-sendcalls'] = { ...marks, stitch: 1 };
      await dapp.close().catch(() => undefined);
    });

    // ---- Smart-account policy + recovery (hydrated account) ----------------

    await capture('settings-smart-account-policy', async () => {
      await wallet.gotoRoute('#/settings/manage-accounts');
      const smartAccountRow = wallet.page
        .locator('li', { hasText: /Demo Passkey Account|Smart Account/ })
        .last();
      await expect(smartAccountRow).toBeVisible({ timeout: 30_000 });
      await smartAccountRow.locator('button').first().click();
      await expect(wallet.page).toHaveURL(/settings\/edit-account/, {
        timeout: 30_000,
      });
      await wallet.page
        .getByRole('button', { name: /smart account settings/i })
        .first()
        .click();
      await expect(wallet.page).toHaveURL(/smart-account-policy/, {
        timeout: 30_000,
      });
      await wallet.page
        .getByText(/checking/i)
        .first()
        .waitFor({ state: 'hidden', timeout: 60_000 })
        .catch(() => undefined);
      await settle(wallet.page, 2500);
      await shot(wallet.page, 'settings-smart-account-policy');

      // Recovery guardian section lives further down the same policy page.
      // Scroll to the very bottom so the shot differs from the policy one.
      const recovery = wallet.page
        .getByText(/recovery guardian|sign-in and recovery/i)
        .first();
      if (await recovery.isVisible({ timeout: 10_000 }).catch(() => false)) {
        await wallet.page.evaluate(() => {
          const scrollables = Array.from(document.querySelectorAll('*')).filter(
            (el) => el.scrollHeight > el.clientHeight + 50
          );
          for (const el of scrollables) el.scrollTop = el.scrollHeight;
          window.scrollTo(0, document.body.scrollHeight);
        });
        await wallet.page.waitForTimeout(800);
        await shot(wallet.page, 'settings-smart-account-recover');
        report.push({ name: 'settings-smart-account-recover', status: 'ok' });
      } else {
        report.push({
          detail: 'recovery section not visible on policy page',
          name: 'settings-smart-account-recover',
          status: 'skip',
        });
      }
    });

    // ---- UTXO captures ------------------------------------------------------

    await capture('utxo-connect-popup', async () => {
      await wallet.gotoRoute('#/home');
      await wallet.switchNetwork('Syscoin Testnet', 'UTXO');
      await wallet.page.goto('about:blank');
      await resetDappOut();
      const popupPromise = waitForPopup();
      await dappClick('utxo-connect');
      const popup = await popupPromise;
      await settle(popup, 2500);
      await shot(popup, 'utxo-connect-popup');
      await clickConfirm(popup);
      await expect(dappOut).toContainText(/utxo-connected:/, {
        timeout: 60_000,
      });
    });

    await capture('psbt-sign-review', async () => {
      await wallet.gotoRoute('#/home');
      await wallet.ensureOnHome();
      // A UTXO send needs spendable inputs; bail out clearly when the QA
      // seed holds no TSYS so the old asset is kept instead.
      const balanceText = await wallet.page
        .locator('#home-balance')
        .innerText();
      if (/^0([.,]0*)?$/.test(balanceText.trim())) {
        throw new Error('no UTXO funds on Syscoin Testnet for the QA seed');
      }

      const selfAddress = await (async () => {
        await wallet.gotoRoute('#/receive');
        const body = wallet.page.locator('body');
        await expect(body).toContainText(/(t?sys|bc)1[a-z0-9]{8,}/i, {
          timeout: 30_000,
        });
        const text = await body.innerText();
        const match = text.match(/(t?sys|bc)1[a-z0-9]{20,}/i);
        if (!match) throw new Error('could not read UTXO receive address');
        return match[0];
      })();

      await wallet.gotoRoute('#/home');
      await wallet.page.locator('#send-btn').click();
      await expect(wallet.page).toHaveURL(/send\/sys/, { timeout: 30_000 });
      await wallet.page
        .getByPlaceholder(/receiver/i)
        .first()
        .fill(selfAddress);
      await wallet.page
        .getByPlaceholder(/amount/i)
        .first()
        .fill('1');
      await wallet.page.waitForTimeout(2000);
      await wallet.page.getByRole('button', { name: /next/i }).first().click();
      await expect(wallet.page).toHaveURL(/send\/confirm/, {
        timeout: 30_000,
      });
      await settle(wallet.page, 3000);

      // Expand the PSBT-style technical breakdown before the tall capture.
      const advanced = wallet.page.getByText(/advanced details/i).first();
      if (await advanced.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await advanced.click();
        await wallet.page.waitForTimeout(1200);
      }
      await shot(wallet.page, 'psbt-sign-review', { fullPage: true });
      await wallet.gotoRoute('#/home');
    });

    await wallet.dispose('passed');
  } catch (error) {
    await wallet.dispose('failed');
    fs.writeFileSync(
      path.join(OUT_DIR, 'report.json'),
      JSON.stringify(report, null, 2)
    );
    throw error;
  }

  // Videos are finalized once the context is closed (inside dispose).
  for (const { name, source } of videoSources) {
    try {
      fs.copyFileSync(source, path.join(VIDEO_DIR, `${name}.webm`));
      report.push({ name: `video:${name}`, status: 'ok' });
    } catch (error) {
      report.push({
        detail: error instanceof Error ? error.message : String(error),
        name: `video:${name}`,
        status: 'skip',
      });
    }
  }

  fs.writeFileSync(
    path.join(OUT_DIR, 'report.json'),
    JSON.stringify(report, null, 2)
  );
  fs.writeFileSync(
    path.join(OUT_DIR, 'video-marks.json'),
    JSON.stringify(videoMarks, null, 2)
  );

  // The run is useful even with some skips; fail only when nothing came out.
  expect(report.some((entry) => entry.status === 'ok')).toBe(true);
});
