import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import fr from '../../source/assets/locales/fr.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { extensionEvidence } from '../harness/testDappConformance';
import { startUtxoFixtureServer } from '../harness/utxoFixture';
import {
  createVisualFixture,
  installVisualFixtureRoutes,
  VISUAL_FIXTURE_ADDRESS,
  VISUAL_FIXTURE_CHAIN_ID,
  VISUAL_FIXTURE_SEED,
} from '../harness/visualFixture';

// Exercise real off-chain creation and native Edit/Back/Remove/Cancel actions.
// No removal confirmation, label Save, signing, deployment or broadcast is used.
// Keep only explicit sanitized step screenshots; disable automatic recordings.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const SMART_LABEL = 'Daily';
const MANAGE = '[data-navigation-scroll="settings-manage-accounts"]';

const publicSnapshot = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const key = 'state-vault-' + state.vaultGlobal.activeSlip44;
    const saved = await chrome.storage.local.get([key, 'language']);
    const accounts = (value: any) =>
      Object.entries(value || {})
        .flatMap(([kind, group]) =>
          Object.values(group || {}).map((account: any) => ({
            kind,
            id: account.id,
            label: account.label,
            address: account.address,
            chainId: account.smartAccount?.chainId ?? null,
            accountIndex:
              account.smartAccount?.descriptor?.accountIndex ?? null,
          }))
        )
        .sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
    return {
      active: state.vault.activeAccount,
      savedActive: saved[key]?.activeAccount,
      slip44: state.vaultGlobal.activeSlip44,
      network: {
        kind: state.vault.activeNetwork.kind,
        chainId: state.vault.activeNetwork.chainId,
        url: state.vault.activeNetwork.url,
      },
      language: saved.language || 'en',
      live: accounts(state.vault.accounts),
      saved: accounts(saved[key]?.accounts),
    };
  });

const tabTo = async (page: Page, target: Locator) => {
  await expect(target).toHaveCount(1);
  for (let index = 0; index < 48; index += 1) {
    if (await target.evaluate((node) => node === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
};

// No scrollTop assignment, element.focus or scrollIntoView. Point real wheel
// gestures inside the actual list scroll owner and retain their deltas.
const revealRow = async (page: Page, row: Locator) => {
  const wheels: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const state = await row.evaluate((node) => {
      const rowBounds = node.getBoundingClientRect();
      const owner = node.closest('[data-navigation-scroll]')!;
      const clip = owner.getBoundingClientRect();
      return {
        row: rowBounds.toJSON(),
        clip: {
          left: Math.max(0, clip.left + owner.clientLeft),
          right: Math.min(
            innerWidth,
            clip.left + owner.clientLeft + owner.clientWidth
          ),
          top: Math.max(0, clip.top + owner.clientTop),
          bottom: Math.min(
            innerHeight,
            clip.top + owner.clientTop + owner.clientHeight
          ),
        },
      };
    });
    if (
      state.row.top >= state.clip.top &&
      state.row.bottom <= state.clip.bottom
    )
      break;
    const delta =
      state.row.top < state.clip.top
        ? Math.floor(state.row.top - state.clip.top - 2)
        : Math.ceil(state.row.bottom - state.clip.bottom + 2);
    await page.mouse.move(
      (state.clip.left + state.clip.right) / 2,
      (state.clip.top + state.clip.bottom) / 2
    );
    await page.mouse.wheel(0, delta);
    wheels.push(delta);
    await expect
      .poll(async () => {
        const after = await row.boundingBox();
        return delta > 0 ? after!.y < state.row.y : after!.y > state.row.y;
      })
      .toBe(true);
    await row.evaluate(
      (node) =>
        new Promise<void>((resolve, reject) => {
          let previous = node.getBoundingClientRect().y,
            stable = 0,
            frames = 0;
          const settle = () => {
            frames += 1;
            const current = node.getBoundingClientRect().y;
            stable = Math.abs(current - previous) < 0.5 ? stable + 1 : 0;
            previous = current;
            if (stable >= 2) resolve();
            else if (frames >= 120)
              reject(new Error('Manage Accounts wheel did not settle'));
            else requestAnimationFrame(settle);
          };
          requestAnimationFrame(settle);
        })
    );
  }
  await page.mouse.move(2, 2);
  return wheels;
};

const inspectRow = (row: Locator, label: string) =>
  row.evaluate((element, expectedLabel) => {
    const box = (node: Element) => node.getBoundingClientRect().toJSON();
    const identity = element.firstElementChild!;
    const nameGroup = identity.firstElementChild!;
    const icon = nameGroup.firstElementChild!;
    const text = nameGroup.querySelector('span.truncate')!;
    const badge = Array.from(identity.children).find(
      (node) =>
        node.tagName === 'SPAN' && node.classList.contains('rounded-full')
    )!;
    const activeCheck = identity.querySelector('img[alt="greenCheck"]');
    const checkBox = activeCheck?.getBoundingClientRect();
    const badgeBox = badge.getBoundingClientRect();
    const style = getComputedStyle(text);
    const textBox = text.getBoundingClientRect();
    const clip = {
      left: Math.max(0, textBox.left),
      right: Math.min(innerWidth, textBox.right),
      top: Math.max(0, textBox.top),
      bottom: Math.min(innerHeight, textBox.bottom),
    };
    for (let node = text.parentElement; node; node = node.parentElement) {
      const css = getComputedStyle(node),
        bounds = node.getBoundingClientRect();
      if (/^(?:auto|scroll|hidden|clip)$/.test(css.overflowX)) {
        clip.left = Math.max(clip.left, bounds.left + node.clientLeft);
        clip.right = Math.min(
          clip.right,
          bounds.left + node.clientLeft + node.clientWidth
        );
      }
      if (/^(?:auto|scroll|hidden|clip)$/.test(css.overflowY)) {
        clip.top = Math.max(clip.top, bounds.top + node.clientTop);
        clip.bottom = Math.min(
          clip.bottom,
          bounds.top + node.clientTop + node.clientHeight
        );
      }
    }
    // Range coordinates include overflowed text even when CSS ellipsis hides it.
    // Measure that native font's ellipsis in a detached OffscreenCanvas; no DOM
    // content is created/replaced. Keep this model separate from pixel approval.
    const metrics = new OffscreenCanvas(1, 1).getContext('2d');
    if (!metrics) throw new Error('Native font metrics unavailable');
    metrics.font = style.font;
    const truncated = text.scrollWidth > text.clientWidth;
    const ellipsisWidth =
      truncated && style.textOverflow === 'ellipsis'
        ? metrics.measureText('…').width
        : 0;
    const contentRight = clip.right - ellipsisWidth;
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    let current: Node | null;
    while ((current = walker.nextNode())) textNodes.push(current as Text);
    const fullText = textNodes.map((node) => node.data).join('');
    if (!fullText.startsWith(expectedLabel))
      throw new Error('Unexpected row identity text');
    const prefix = document.createRange();
    prefix.setStart(textNodes[0], 0);
    let remaining = expectedLabel.length;
    for (const node of textNodes) {
      if (remaining <= node.data.length) {
        prefix.setEnd(node, remaining);
        break;
      }
      remaining -= node.data.length;
    }
    const prefixBox = prefix.getBoundingClientRect();
    const hit = (button: Element) => {
      const bounds = button.getBoundingClientRect();
      return [
        [bounds.left + bounds.width / 4, bounds.top + bounds.height / 4],
        [bounds.right - bounds.width / 4, bounds.top + bounds.height / 4],
        [bounds.left + bounds.width / 4, bounds.bottom - bounds.height / 4],
        [bounds.right - bounds.width / 4, bounds.bottom - bounds.height / 4],
        [bounds.left + bounds.width / 2, bounds.top + bounds.height / 2],
      ].map(([x, y]) => {
        const target = document.elementFromPoint(x, y);
        return {
          x,
          y,
          withinTarget: Boolean(target && button.contains(target)),
        };
      });
    };
    const bounds = element.getBoundingClientRect();
    const owner = element.closest('[data-navigation-scroll]')!;
    const ownerBox = owner.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      row: box(element),
      identity: box(identity),
      icon: box(icon),
      badge: { text: badge.textContent, box: box(badge) },
      activeCheck:
        activeCheck && checkBox
          ? {
              box: checkBox.toJSON(),
              wrapper: box(activeCheck.parentElement!),
              badgeCenterY: (badgeBox.top + badgeBox.bottom) / 2,
              checkCenterY: (checkBox.top + checkBox.bottom) / 2,
              sharesBadgeRow:
                Math.abs(
                  (badgeBox.top +
                    badgeBox.bottom -
                    checkBox.top -
                    checkBox.bottom) /
                    2
                ) <= 1,
            }
          : null,
      label: {
        text: fullText,
        title: text.getAttribute('title'),
        box: box(text),
        prefix: expectedLabel,
        prefixBox: prefixBox.toJSON(),
        clip,
        scrollWidth: text.scrollWidth,
        clientWidth: text.clientWidth,
        direction: style.direction,
        font: style.font,
        textOverflow: style.textOverflow,
        ellipsisWidth,
        contentRight,
        prefixFitsNonEllipsisRegion:
          prefixBox.left >= clip.left - 1 &&
          prefixBox.right <= contentRight + 1 &&
          prefixBox.top >= clip.top - 1 &&
          prefixBox.bottom <= clip.bottom + 1,
      },
      buttons: Array.from(element.querySelectorAll('button')).map((button) => ({
        name: button.getAttribute('aria-label'),
        box: box(button),
        disabled: button.disabled,
        hits: hit(button),
      })),
      wholeRowExposed:
        bounds.left >= 0 &&
        bounds.right <= innerWidth &&
        bounds.top >= Math.max(0, ownerBox.top) &&
        bounds.bottom <=
          Math.min(
            innerHeight,
            ownerBox.top + owner.clientTop + owner.clientHeight
          ),
      scroll: {
        top: owner.scrollTop,
        clientHeight: owner.clientHeight,
        scrollHeight: owner.scrollHeight,
      },
    };
  }, label);

for (const locale of [
  { code: 'en', copy: en },
  { code: 'fr', copy: fr },
] as const) {
  test(`managed Smart Account identity stays readable through ordinary actions in ${locale.code}`, async ({}, info) => {
    expect(process.version).toBe('v23.11.1');
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
    expect(E2E_CONFIG.extensionPath).toBe(
      process.env.PALI_TEST_DAPP_EXTENSION_PATH
    );
    const runtime = extensionEvidence();
    expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
    const sourceHash = createHash('sha256')
      .update(fs.readFileSync(info.file))
      .digest('hex');
    const previous = { ...E2E_CONFIG },
      fixture = createVisualFixture();
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: VISUAL_FIXTURE_SEED,
      password: 'ManagedIdentitySynthetic!2026',
      chainId: VISUAL_FIXTURE_CHAIN_ID,
      networkLabel: 'zkTanenbaum',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installVisualFixtureRoutes>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    const observations: Record<string, any> = {
      runtime,
      sourceHash,
      locale: locale.code,
    };
    const forbidden: string[] = [],
      pageErrors: string[] = [];
    try {
      wallet = await PaliWallet.launch(
        'managed-label-readability-' + locale.code,
        {
          offlineHttpProxy: server.url,
          recordVideo: false,
          viewport: { width: 400, height: 620 },
        }
      );
      routes = await installVisualFixtureRoutes(
        wallet.context,
        fixture,
        server.url
      );
      const page = wallet.page,
        copy = locale.copy;
      page.on('pageerror', (error) => pageErrors.push(error.message));
      wallet.context.on('request', (request) => {
        if (/\/sendtx(?:\/|$)/i.test(new URL(request.url()).pathname))
          forbidden.push('sendtx');
        try {
          const body = request.postDataJSON();
          for (const call of Array.isArray(body) ? body : [body])
            if (
              /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
                call?.method || ''
              )
            )
              forbidden.push(call.method);
        } catch {
          /* Ordinary extension documents and fixture GETs have no RPC body. */
        }
      });
      const openMenu = async (translations: typeof en | typeof fr) => {
        await page
          .getByRole('button', {
            name: translations.generalMenu.generalOptions,
            exact: true,
          })
          .click();
      };
      await wallet.step(
        `${locale.code}: create one ordinary off-chain smart record behind the read-only fence`,
        async () => {
          observations.workerBefore = await verifyExecutingWorker(
            wallet!.context,
            wallet!.extensionId,
            E2E_CONFIG.extensionPath,
            (value) => {
              observations.workerBefore = value;
            }
          );
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('zkTanenbaum', 'EVM');
          await wallet!.ensureOnHome();
          await openMenu(en);
          await page
            .getByRole('menuitem', {
              name: en.accountMenu.createNewAccount,
              exact: true,
            })
            .click();
          await expect(page).toHaveURL(/#\/settings\/account\/new$/);
          await page.locator('#account-name-input').fill(SMART_LABEL);
          const create = page.getByRole('button', {
            name: new RegExp(`^${en.settings.createSmartAccount}`, 'i'),
          });
          await expect(create).toBeEnabled();
          await create.click();
          const dialog = page
            .getByRole('dialog')
            .filter({ hasText: en.settings.yourNewAccount });
          await expect(dialog).toBeVisible();
          await expect(
            dialog.getByText(fixture.smartAccountAddress, { exact: true })
          ).toBeVisible();
          await dialog.locator('#account-created-ok-btn').click();
          await expect(dialog).toHaveCount(0);
          await wallet!.ensureOnHome();
          await expect
            .poll(async () => (await publicSnapshot(page)).active)
            .toEqual({ id: 0, type: 'SmartAccount' });
          const createdSnapshot = await publicSnapshot(page);
          expect(createdSnapshot).toMatchObject({
            active: { id: 0, type: 'SmartAccount' },
            savedActive: { id: 0, type: 'SmartAccount' },
            slip44: 60,
            network: { kind: 'ethereum', chainId: VISUAL_FIXTURE_CHAIN_ID },
          });
          expect(createdSnapshot.live).toEqual(createdSnapshot.saved);
          observations.created = createdSnapshot;
          await openMenu(en);
          await page
            .locator('#account-HDAccount-0')
            .getByRole('menuitem')
            .first()
            .click();
          await expect
            .poll(async () => (await publicSnapshot(page)).active)
            .toEqual({ id: 0, type: 'HDAccount' });
          await wallet!.ensureOnHome();
          // Ordinary setAccount(sync=false) changes session selection only.
          // Creation durably selected Smart0; require that disk baseline to
          // remain intact instead of forcing an unrelated persistence action.
          const selectedSnapshot = await publicSnapshot(page);
          expect(selectedSnapshot).toEqual({
            ...createdSnapshot,
            active: { id: 0, type: 'HDAccount' },
          });
          observations.afterSessionSelection = selectedSnapshot;
        }
      );
      if (locale.code === 'fr') {
        await wallet.step(
          'fr: choose and persist French through the actual Languages form',
          async () => {
            const before = await publicSnapshot(page);
            await openMenu(en);
            await page
              .getByRole('menuitem', {
                name: en.generalMenu.languages,
                exact: true,
              })
              .click();
            await expect(page).toHaveURL(/#\/settings\/languages$/);
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
            await expect
              .poll(async () => (await publicSnapshot(page)).language)
              .toBe('fr');
            await page.keyboard.press('Escape');
            await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
            expect(await publicSnapshot(page)).toEqual({
              ...before,
              language: 'fr',
            });
          }
        );
      }
      const baseline = await publicSnapshot(page);
      expect(baseline).toMatchObject({
        active: { id: 0, type: 'HDAccount' },
        savedActive: observations.created.savedActive,
        slip44: 60,
        network: { kind: 'ethereum', chainId: VISUAL_FIXTURE_CHAIN_ID },
        language: locale.code,
      });
      expect(baseline.live).toEqual(baseline.saved);
      expect(baseline.live).toHaveLength(2);
      const hd = baseline.live.find((account) => account.kind === 'HDAccount')!;
      const smart = baseline.live.find(
        (account) => account.kind === 'SmartAccount'
      )!;
      expect(hd).toMatchObject({ id: 0, address: VISUAL_FIXTURE_ADDRESS });
      expect(smart).toEqual({
        kind: 'SmartAccount',
        id: 0,
        label: SMART_LABEL,
        address: fixture.smartAccountAddress,
        chainId: VISUAL_FIXTURE_CHAIN_ID,
        accountIndex: 0,
      });
      observations.baseline = baseline;
      const unchanged = async () =>
        expect(await publicSnapshot(page)).toEqual(baseline);
      const actionName = (action: string, account: typeof smart) =>
        `${action}: ${account.label} (${account.address})`;
      const rowFor = (account: typeof smart) =>
        page
          .locator(MANAGE)
          .locator('li')
          .filter({
            has: page.getByRole('button', {
              name: actionName(copy.buttons.edit, account),
              exact: true,
            }),
          });
      const sizes: any[] = [];
      observations.sizes = sizes;
      for (const viewport of [
        { width: 400, height: 620 },
        { width: 320, height: 360 },
      ]) {
        const caseName = `${locale.code}-${viewport.width}x${viewport.height}`;
        await wallet.step(
          `${caseName}: inspect real managed HD and Smart Account rows`,
          async (capture) => {
            await page.setViewportSize(viewport);
            if (!/#\/settings\/manage-accounts$/.test(page.url())) {
              await wallet!.ensureOnHome();
              await openMenu(copy);
              await page
                .getByRole('menuitem', {
                  name: copy.accountMenu.manageAccounts,
                  exact: true,
                })
                .click();
            }
            await expect(page).toHaveURL(/#\/settings\/manage-accounts$/);
            await expect(page.locator(MANAGE).locator('li')).toHaveCount(2);
            const hdWheels = await revealRow(page, rowFor(hd));
            const hdLayout = await inspectRow(rowFor(hd), hd.label);
            const smartWheels = await revealRow(page, rowFor(smart));
            const smartLayout = await inspectRow(rowFor(smart), smart.label);
            sizes.push({
              viewport,
              hdWheels,
              smartWheels,
              hd: hdLayout,
              smart: smartLayout,
            });
            expect(hdLayout.badge.text).toBe('Pali');
            expect(smartLayout.badge.text).toBe(copy.receive.smartAccount);
            expect(hdLayout.wholeRowExposed).toBe(true);
            expect(smartLayout.wholeRowExposed).toBe(true);
            expect(hdLayout.buttons).toHaveLength(1);
            expect(smartLayout.buttons).toHaveLength(2);
            expect(
              smartLayout.buttons.every(
                (button) =>
                  !button.disabled &&
                  button.hits.every((hit) => hit.withinTarget)
              )
            ).toBe(true);
            await unchanged();
            await capture(page);
          }
        );
        await wallet.step(
          `${caseName}: native Edit and actual header Back retain the precise Smart Account`,
          async (capture) => {
            const edit = rowFor(smart).getByRole('button', {
              name: actionName(copy.buttons.edit, smart),
              exact: true,
            });
            await tabTo(page, edit);
            await expect(edit).toBeFocused();
            await page.keyboard.press('Enter');
            await expect(page).toHaveURL(/#\/settings\/edit-account$/);
            await expect(
              page.getByPlaceholder(copy.settings.accountLabel, { exact: true })
            ).toHaveValue(SMART_LABEL);
            expect(
              await page.evaluate(() => ({
                id: history.state?.usr?.id,
                type: history.state?.usr?.accountType,
              }))
            ).toEqual({ id: 0, type: 'SmartAccount' });
            await unchanged();
            await capture(page);
            const back = page.getByRole('button', {
              name: copy.buttons.back,
              exact: true,
            });
            await tabTo(page, back);
            await page.keyboard.press('Enter');
            await expect(page).toHaveURL(/#\/settings\/manage-accounts$/);
            await unchanged();
          }
        );
        await wallet.step(
          `${caseName}: native Remove opens the exact public identity and Cancel keeps both records`,
          async (capture) => {
            const remove = rowFor(smart).getByRole('button', {
              name: actionName(copy.buttons.remove, smart),
              exact: true,
            });
            await tabTo(page, remove);
            await expect(remove).toBeFocused();
            await page.keyboard.press('Enter');
            const dialog = page.getByRole('dialog');
            await expect(dialog).toHaveCount(1);
            await expect(dialog).toContainText(SMART_LABEL);
            await expect(dialog).toContainText(smart.address);
            await unchanged();
            await capture(page);
            const cancel = dialog.getByRole('button', {
              name: copy.buttons.cancel,
              exact: true,
            });
            await tabTo(page, cancel);
            await page.keyboard.press('Enter');
            await expect(dialog).toHaveCount(0);
            await expect(page).toHaveURL(/#\/settings\/manage-accounts$/);
            await unchanged();
          }
        );
      }
      observations.sizes = sizes;
      const activeSizes: any[] = [];
      observations.activeSizes = activeSizes;
      const activeBaseline = {
        ...baseline,
        active: { id: smart.id, type: smart.kind },
      };
      const closeManagedAccounts = async () => {
        const close = page
          .locator('[data-page-action-footer]')
          .getByRole('button', {
            name: copy.buttons.close,
            exact: true,
          });
        await tabTo(page, close);
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
      };
      const chooseExistingAccount = async (account: typeof smart) => {
        await wallet!.ensureOnHome();
        await openMenu(copy);
        await page
          .locator('#account-' + account.kind + '-' + account.id)
          .getByRole('menuitem')
          .first()
          .click();
        await expect
          .poll(async () => (await publicSnapshot(page)).active)
          .toEqual({ id: account.id, type: account.kind });
        await wallet!.ensureOnHome();
      };
      await wallet.step(
        locale.code +
          ': select the existing Smart Account through its actual account-menu row',
        async () => {
          await unchanged();
          await closeManagedAccounts();
          await unchanged();
          await chooseExistingAccount(smart);
          // This ordinary account-menu selection changes only live session
          // identity. The previously observed durable Smart0 stays unchanged.
          expect(await publicSnapshot(page)).toEqual(activeBaseline);
        }
      );
      for (const viewport of [
        { width: 400, height: 620 },
        { width: 320, height: 360 },
      ]) {
        const caseName =
          locale.code + '-active-' + viewport.width + 'x' + viewport.height;
        await wallet.step(
          caseName +
            ': inspect the selected Smart label badge and same-row active check',
          async (capture) => {
            await page.setViewportSize(viewport);
            if (!/#\/settings\/manage-accounts$/.test(page.url())) {
              await openMenu(copy);
              await page
                .getByRole('menuitem', {
                  name: copy.accountMenu.manageAccounts,
                  exact: true,
                })
                .click();
            }
            await expect(page).toHaveURL(/#\/settings\/manage-accounts$/);
            await expect(page.locator(MANAGE).locator('li')).toHaveCount(2);
            const wheels = await revealRow(page, rowFor(smart));
            const layout = await inspectRow(rowFor(smart), smart.label);
            activeSizes.push({ viewport, wheels, smart: layout });
            expect(layout.wholeRowExposed).toBe(true);
            expect(layout.badge.text).toBe(copy.receive.smartAccount);
            expect(layout.activeCheck).not.toBeNull();
            expect(layout.activeCheck!.sharesBadgeRow).toBe(true);
            expect(layout.buttons).toHaveLength(1);
            const edit = rowFor(smart).getByRole('button', {
              name: actionName(copy.buttons.edit, smart),
              exact: true,
            });
            await expect(edit).toBeEnabled();
            await expect(
              rowFor(smart).getByRole('button', {
                name: actionName(copy.buttons.remove, smart),
                exact: true,
              })
            ).toHaveCount(0);
            expect(
              layout.buttons.every(
                (button) =>
                  button.box.width >= 44 &&
                  button.box.height >= 44 &&
                  !button.disabled &&
                  button.hits.every((point) => point.withinTarget)
              )
            ).toBe(true);
            expect(await publicSnapshot(page)).toEqual(activeBaseline);
            await capture(page);
          }
        );
      }
      await wallet.step(
        locale.code +
          ': select the HD anchor normally and restore the exact earlier session and disk baseline',
        async () => {
          expect(await publicSnapshot(page)).toEqual(activeBaseline);
          await closeManagedAccounts();
          expect(await publicSnapshot(page)).toEqual(activeBaseline);
          await chooseExistingAccount(hd);
          await unchanged();
          await openMenu(copy);
          await page
            .getByRole('menuitem', {
              name: copy.accountMenu.manageAccounts,
              exact: true,
            })
            .click();
          await expect(page).toHaveURL(/#\/settings\/manage-accounts$/);
          await unchanged();
        }
      );
      await wallet.step(
        `${locale.code}: ordinary Close then popup reload commits session selection without changing account records`,
        async () => {
          const close = page
            .locator('[data-page-action-footer]')
            .getByRole('button', { name: copy.buttons.close, exact: true });
          await tabTo(page, close);
          await page.keyboard.press('Enter');
          await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
          await unchanged();
          // Reload disconnects MainApp's real popup-connection port. Its normal
          // onDisconnect emergency save commits the existing live HD selection.
          // Bind exactly that transition; every record/context field stays equal.
          const expectedAfterReload = {
            ...baseline,
            savedActive: baseline.active,
          };
          observations.expectedAfterPopupDisconnect = expectedAfterReload;
          await page.reload();
          await wallet!.waitAppReady();
          await wallet!.ensureOnHome();
          await expect
            .poll(() => publicSnapshot(page))
            .toEqual(expectedAfterReload);
          observations.afterReload = await publicSnapshot(page);
          observations.workerAfter = await verifyExecutingWorker(
            wallet!.context,
            wallet!.extensionId,
            E2E_CONFIG.extensionPath,
            (value) => {
              observations.workerAfter = value;
            }
          );
          expect(routes!.deniedWrites).toEqual([]);
          expect(
            routes!.deniedUnknown.filter((read) => read.startsWith('rpc:'))
          ).toEqual([]);
          expect(forbidden).toEqual([]);
          expect(pageErrors).toEqual([]);
          expect(extensionEvidence()).toEqual(runtime);
          expect(
            createHash('sha256')
              .update(fs.readFileSync(info.file))
              .digest('hex')
          ).toBe(sourceHash);
        }
      );
      await wallet.step(
        `${locale.code}: short ordinary account labels fit their actual non-ellipsis text region`,
        async () => {
          // All real Edit/Back/Remove/Cancel/persistence/fence controls run first.
          // These hard label-fit assertions complement the genuine UI screenshots.
          for (const value of sizes) {
            expect(
              value.hd.label.prefixFitsNonEllipsisRegion,
              `HD control at${value.viewport.width}`
            ).toBe(true);
            expect(
              value.smart.label.prefixFitsNonEllipsisRegion,
              `Smart Daily at${value.viewport.width}`
            ).toBe(true);
          }
          for (const value of activeSizes) {
            expect(
              value.smart.label.prefixFitsNonEllipsisRegion,
              `Active Smart Daily at${value.viewport.width}`
            ).toBe(true);
          }
        }
      );
      status = 'passed';
    } finally {
      try {
        await info.attach('managed-account-label-readability-evidence', {
          contentType: 'application/json',
          body: JSON.stringify({
            status,
            observations,
            forbidden,
            pageErrors,
            reads: routes?.reads || [],
            deniedWrites: routes?.deniedWrites || [],
            deniedUnknown: routes?.deniedUnknown || [],
            proxyDeniedConnections: server.blocked.length,
            controllerStateReplaced: false,
            controllerRepliesReplaced: false,
            runtimeTransportReplaced: false,
            DOMOrScrollOrFocusInjected: false,
            signingDeploymentOrBroadcastRequested: false,
            removalConfirmed: false,
            labelSaveActivated: false,
            localSmartAccountCreation: true,
            languageChangedThroughRealForm: locale.code === 'fr',
          }),
        });
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
