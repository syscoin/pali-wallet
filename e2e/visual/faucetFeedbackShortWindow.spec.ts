import { expect, test, type Locator } from '@playwright/test';

import en from '../../source/assets/locales/en.json';
import ru from '../../source/assets/locales/ru.json';
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
// Check complete geometry and hit testing above the actual sticky footer.
async function fullyExposed(target: Locator) {
  return target.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const footer = document
      .querySelector('[data-page-action-footer]')
      ?.getBoundingClientRect();
    const points = [
      [box.left + 2, box.top + 2],
      [box.right - 2, box.top + 2],
      [box.left + 2, box.bottom - 2],
      [box.right - 2, box.bottom - 2],
      [box.left + box.width / 2, box.top + box.height / 2],
    ];
    const text = document.createRange();
    text.selectNodeContents(element);
    const fragments = Array.from(text.getClientRects());
    // A Range may extend beyond its paragraph line box with normal font
    // metrics. Check the rendered text against actual clipping edges instead.
    const clipBounds = [];
    for (
      let ancestor: Element | null = element;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      const style = getComputedStyle(ancestor);
      const clips = (value: string) =>
        ['hidden', 'clip', 'auto', 'scroll'].includes(value);
      if (clips(style.overflowX) || clips(style.overflowY)) {
        const rect = ancestor.getBoundingClientRect();
        clipBounds.push({
          left: rect.left + ancestor.clientLeft,
          top: rect.top + ancestor.clientTop,
          right: rect.left + ancestor.clientLeft + ancestor.clientWidth,
          bottom: rect.top + ancestor.clientTop + ancestor.clientHeight,
          x: clips(style.overflowX),
          y: clips(style.overflowY),
        });
      }
    }
    return (
      box.width > 0 &&
      box.height > 0 &&
      box.top >= 0 &&
      box.left >= 0 &&
      box.right <= innerWidth &&
      box.bottom <= innerHeight &&
      box.bottom <= (footer?.top ?? innerHeight) &&
      fragments.length > 0 &&
      fragments.every(
        (fragment) =>
          fragment.left >= box.left - 0.5 &&
          fragment.right <= box.right + 0.5 &&
          fragment.left >= 0 &&
          fragment.right <= innerWidth &&
          fragment.top >= 0 &&
          fragment.bottom <= innerHeight &&
          fragment.bottom <= (footer?.top ?? innerHeight) &&
          clipBounds.every(
            (clip) =>
              (!clip.x ||
                (fragment.left >= clip.left - 0.5 &&
                  fragment.right <= clip.right + 0.5)) &&
              (!clip.y ||
                (fragment.top >= clip.top - 0.5 &&
                  fragment.bottom <= clip.bottom + 0.5))
          )
      ) &&
      points.every(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return !!hit && (hit === element || element.contains(hit));
      })
    );
  });
}
for (const viewport of [
  { width: 320, height: 360 },
  { width: 400, height: 620 },
]) {
  test(`normal Faucet feedback stays readable at ${viewport.width}x${viewport.height}`, async ({}, info) => {
    test.setTimeout(120_000);
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    const runtime = extensionEvidence();
    expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
    const previous = { ...E2E_CONFIG };
    const server = await startUtxoFixtureServer();
    const fixture = createIsolatedVaultFixture();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'FaucetLayoutSyntheticOnly!2026',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    let phase: 'rate-limit' | 'failure' | 'success' | 'localized' | 'long' =
      'rate-limit';
    const longMessage = `Synthetic faucet refusal ${'x'.repeat(110)}`;
    const denied: string[] = [];
    const claims: string[] = [];
    try {
      wallet = await PaliWallet.launch(`faucet-short-${viewport.width}`, {
        offlineHttpProxy: server.url,
        recordVideo: false,
        viewport,
      });
      const routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url
      );
      await wallet.context.route(
        'https://chains.tools/api/faucet/claim?*',
        async (route) => {
          const url = new URL(route.request().url());
          const address = url.searchParams.get('walletAddress');
          if (
            route.request().method() !== 'GET' ||
            [...url.searchParams.keys()].sort().join(',') !==
              'networkKey,walletAddress' ||
            url.searchParams.get('networkKey') !== 'nevm-testnet' ||
            !fixture.evmAddresses.includes(address || '')
          ) {
            denied.push('unexpected claim');
            return route.abort('blockedbyclient');
          }
          claims.push(phase);
          return route.fulfill({
            status: phase === 'rate-limit' ? 429 : 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify(
              phase === 'rate-limit'
                ? { message: 'Synthetic limit' }
                : {
                    data: {
                      status: phase === 'success',
                      message:
                        phase === 'long'
                          ? longMessage
                          : phase === 'localized'
                          ? ru.faucet.rateLimited
                          : 'Synthetic refusal',
                      hash: '0x' + '17'.repeat(32),
                    },
                  }
            ),
          });
        }
      );
      const page = wallet.page;
      await wallet.importSeedAndCreatePassword();
      await wallet.switchNetwork('Syscoin NEVM Testnet', 'EVM');
      await wallet.ensureOnHome();
      const open = async () => {
        await page
          .getByRole('button', {
            name: en.faucet.grabTextTwo.replace('{{token}}', 'TSYS'),
            exact: true,
          })
          .click();
        await expect(page).toHaveURL(/#\/faucet$/);
      };
      await open();
      for (const next of [
        'rate-limit',
        'failure',
        'success',
        'localized',
        'long',
      ] as const) {
        phase = next;
        await page
          .getByRole('button', { name: en.faucet.requestNow, exact: true })
          .click();
        const text =
          next === 'rate-limit'
            ? en.faucet.rateLimited
            : next === 'failure'
            ? 'Synthetic refusal'
            : next === 'localized'
            ? ru.faucet.rateLimited
            : next === 'long'
            ? longMessage
            : en.faucet.someHasJust
                .replace('{{tokenSymbol}}', '$TSYS')
                .replace('{{networkName}}', 'Syscoin NEVM Testnet');
        const description = page.getByText(text, { exact: true });
        await expect(description).toBeVisible();
        await description.evaluate(async (element) => {
          await new Promise(requestAnimationFrame);
          await Promise.all(
            element
              .getAnimations({ subtree: true })
              .filter((animation) =>
                Number.isFinite(animation.effect?.getComputedTiming().endTime)
              )
              .map((animation) => animation.finished.catch(() => undefined))
          );
          await new Promise(requestAnimationFrame);
        });
        // No resize or manual scroll before measuring the normal first render.
        if (next !== 'long') expect(await fullyExposed(description)).toBe(true);
        else {
          // Long unbroken server messages still wrap and can be reached by wheel.
          const owner = page.locator(
            '[data-navigation-scroll="wallet-layout"]'
          );
          await page.mouse.move(viewport.width - 8, viewport.height / 2);
          for (let n = 0; n < 15 && !(await fullyExposed(description)); n++) {
            await page.mouse.wheel(0, 100);
            await page.waitForTimeout(100);
          }
          expect(await fullyExposed(description)).toBe(true);
          expect(
            await owner.evaluate((el) => el.scrollWidth <= el.clientWidth)
          ).toBe(true);
        }
        const action = page
          .locator('[data-page-action-footer]')
          .getByRole('button', {
            name: next === 'success' ? en.faucet.Close : en.faucet.grabTokens,
            exact: true,
          });
        // Start from a known, different control so reaching the footer requires
        // a real keyboard traversal, rather than retaining pointer focus.
        const back = page.getByRole('button', {
          name: en.buttons.back,
          exact: true,
        });
        await back.focus();
        await expect(back).toBeFocused();
        expect(
          await action.evaluate((el) => el === document.activeElement)
        ).toBe(false);
        let tabPresses = 0;
        for (
          let n = 0;
          n < 30 &&
          !(await action.evaluate((el) => el === document.activeElement));
          n++
        ) {
          await page.keyboard.press('Tab');
          tabPresses += 1;
        }
        expect(tabPresses).toBeGreaterThan(0);
        await expect(action).toBeFocused();
        const box = await action.boundingBox();
        expect(box && box.y >= 0 && box.y + box.height <= viewport.height).toBe(
          true
        );
        if (next === 'success') await action.click();
        else
          await page
            .getByRole('button', { name: en.buttons.back, exact: true })
            .click();
        await expect(page).toHaveURL(/#\/home(?:[?#]|$)/);
        if (next !== 'long') await open();
      }
      expect(claims).toEqual([
        'rate-limit',
        'failure',
        'success',
        'localized',
        'long',
      ]);
      expect(denied).toEqual([]);
      expect(routes.deniedWrites).toEqual([]);
      expect(extensionEvidence()).toEqual(runtime);
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
