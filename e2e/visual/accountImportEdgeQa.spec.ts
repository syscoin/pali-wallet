import { expect, test } from '@playwright/test';
import { utils as sys } from 'syscoinjs-lib';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('WIF import keeps every address type reachable in narrow windows without importing a key', async ({}, info) => {
  test.setTimeout(120_000);
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'ImportLayoutSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  try {
    wallet = await PaliWallet.launch('account-import-edge', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    await wallet.switchNetwork('Syscoin Testnet', 'UTXO');
    const page = wallet.page;
    await wallet.gotoRoute('#/settings/account/import');
    // Public fixture material only. Never import or broadcast with this key.
    const hd = new sys.HDSigner(UTXO_FIXTURE_SEED, '', true);
    const wif = hd.deriveKeypair("m/84'/1'/0'/0/0").toWIF();
    await page.locator('#import-account-identifier').fill(wif);
    const choices = ['SegWit (P2WPKH)', 'Legacy (P2PKH)', 'Taproot (P2TR)'];
    for (const viewport of [
      { width: 320, height: 360 },
      { width: 400, height: 480 },
    ]) {
      await page.setViewportSize(viewport);
      for (const name of choices) {
        const choice = page.getByRole('radio', { name });
        await expect(choice).toBeVisible();
        const label = choice.locator('..');
        await label.scrollIntoViewIfNeeded();
        const box = (await label.boundingBox())!;
        expect
          .soft(box.x, `${name} starts within the viewport`)
          .toBeGreaterThanOrEqual(0);
        expect
          .soft(box.x + box.width, `${name} ends within the viewport`)
          .toBeLessThanOrEqual(viewport.width);
        expect
          .soft(
            await label.evaluate(
              (element) => element.scrollWidth <= element.clientWidth
            ),
            `${name} text is not clipped`
          )
          .toBe(true);
        await choice.click();
        await expect(choice).toBeChecked();
      }
      await info.attach(
        `import-address-types-${viewport.width}x${viewport.height}`,
        {
          body: await page.screenshot({
            animations: 'disabled',
            mask: [page.locator('input[type=text]')],
          }),
          contentType: 'image/png',
        }
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth)
      ).toBe(viewport.width);
    }
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.locator('#import-account-identifier')).toHaveCount(0);
    expect(routes.deniedWrites).toEqual([]);
  } finally {
    await wallet?.context.close().catch(() => undefined);
    await server.close();
    Object.assign(E2E_CONFIG, before);
  }
});

test('public XPUB copy is a keyboard control in the private-key view at narrow heights', async ({}, info) => {
  test.setTimeout(120_000);
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  const fixture = createUtxoFixture();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'PublicXpubSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  try {
    wallet = await PaliWallet.launch('public-xpub-keyboard-edge', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      fixture,
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    await wallet.switchNetwork('Syscoin Testnet', 'UTXO');
    await wallet.gotoRoute('#/settings/account/private-key');
    const page = wallet.page;
    await expect(
      page.getByText(en.settings.yourXpub, { exact: true })
    ).toBeVisible();
    await page.evaluate(() => {
      (window as any).__publicCopies = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (value: string) =>
            (window as any).__publicCopies.push(value),
        },
      });
    });
    const copy = page.getByRole('button', {
      name: `${en.buttons.copy} ${en.settings.yourXpub}`,
      exact: true,
    });
    // A semantic button must exist; click-only cards are not keyboard controls.
    expect(await copy.count()).toBe(1);
    for (const viewport of [
      { width: 320, height: 360 },
      { width: 400, height: 480 },
    ]) {
      await page.setViewportSize(viewport);
      await page.locator('input[type=password]').click();
      for (let step = 0; step < 20; step++) {
        await page.keyboard.press('Shift+Tab');
        if (
          await copy.evaluate((element) => element === document.activeElement)
        )
          break;
      }
      await expect(copy).toBeFocused();
      const box = (await copy.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      expect(box.height).toBeGreaterThanOrEqual(44);
      await page.keyboard.press('Enter');
      await expect(
        page.getByText(en.settings.successfullyCopied, { exact: true })
      ).toBeVisible();
      await info.attach(
        `public-xpub-copy-${viewport.width}x${viewport.height}`,
        {
          body: await page.screenshot({
            animations: 'disabled',
            mask: [page.locator('input')],
          }),
          contentType: 'image/png',
        }
      );
    }
    expect(await page.evaluate(() => (window as any).__publicCopies)).toEqual([
      fixture.userXpub,
      fixture.userXpub,
    ]);
    await expect(
      page.getByText(en.settings.successfullyCopied, { exact: true })
    ).toBeHidden({ timeout: 10_000 });
    await page.evaluate(() => {
      (navigator.clipboard as any).writeText = async () => {
        throw new Error('Synthetic clipboard permission refusal');
      };
    });
    await copy.click();
    await expect(
      page.getByText(en.transactions.copyFailed, { exact: true })
    ).toBeVisible();
    expect(
      await page
        .getByText(en.settings.successfullyCopied, { exact: true })
        .count()
    ).toBe(0);
    expect(routes.deniedWrites).toEqual([]);
  } finally {
    await wallet?.context.close().catch(() => undefined);
    await server.close();
    Object.assign(E2E_CONFIG, before);
  }
});

test('late language preference reads preserve keyboard-selected drafts in short windows', async ({}, info) => {
  test.setTimeout(120_000);
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'LanguageDraftSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  try {
    wallet = await PaliWallet.launch('language-draft-edge', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    const page = wallet.page;
    await page.evaluate(() => {
      const original = chrome.storage.local.get.bind(chrome.storage.local);
      (window as any).__languageReads = [];
      (window as any).__restoreLanguageReads = () => {
        chrome.storage.local.get = original;
      };
      chrome.storage.local.get = ((
        keys: unknown,
        callback?: (result: unknown) => void
      ) => {
        if (
          Array.isArray(keys) &&
          keys.length === 1 &&
          keys[0] === 'language' &&
          callback
        ) {
          (window as any).__languageReads.push(callback);
          return;
        }
        return (original as any)(keys, callback);
      }) as typeof chrome.storage.local.get;
    });
    for (const viewport of [
      { width: 320, height: 360 },
      { width: 400, height: 480 },
    ]) {
      await page.setViewportSize(viewport);
      await wallet.gotoRoute('#/settings/languages');
      await expect
        .poll(() => page.evaluate(() => (window as any).__languageReads.length))
        .toBe(1);
      const trigger = page.getByRole('button', {
        name: en.settings.setYourPreferredLanguage,
        exact: true,
      });
      await trigger.click();
      await page.keyboard.type('ger');
      await page.keyboard.press('Enter');
      await expect(trigger).toContainText('Deutsch');
      await page.evaluate(() =>
        (window as any).__languageReads.shift()({ language: 'en' })
      );
      await expect(trigger).toContainText('Deutsch');
      await expect(
        page.getByRole('button', { name: en.buttons.save, exact: true })
      ).toBeEnabled();
      await info.attach(`language-draft-${viewport.width}x${viewport.height}`, {
        body: await page.screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      });
      await wallet.gotoRoute('#/home');
    }
    await page.evaluate(() => (window as any).__restoreLanguageReads());
    expect(routes.deniedWrites).toEqual([]);
  } finally {
    await wallet?.context.close().catch(() => undefined);
    await server.close();
    Object.assign(E2E_CONFIG, before);
  }
});

test('About support links and URL copy are named keyboard controls in small windows', async () => {
  test.setTimeout(120_000);
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'SupportLinksSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  try {
    wallet = await PaliWallet.launch('about-keyboard-edge', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    await wallet.gotoRoute('#/settings/about');
    const page = wallet.page;
    const supportUrl = 'https://discord.com/invite/syscoin';
    const support = page.getByRole('link', {
      name: en.settings.clickHereSupport,
      exact: true,
    });
    const address = page.getByRole('link', { name: supportUrl, exact: true });
    const copy = page.getByRole('button', {
      name: `${en.buttons.copy} ${en.settings.userSupport}`,
      exact: true,
    });
    expect(await support.count()).toBe(1);
    expect(await address.count()).toBe(1);
    expect(await copy.count()).toBe(1);
    await expect(support).toHaveAttribute('href', supportUrl);
    await expect(address).toHaveAttribute('href', supportUrl);
    await page.evaluate(() => {
      (window as any).__supportCopies = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (value: string) =>
            (window as any).__supportCopies.push(value),
        },
      });
    });
    for (const viewport of [
      { width: 320, height: 360 },
      { width: 400, height: 480 },
    ]) {
      await page.setViewportSize(viewport);
      await page
        .getByRole('button', { name: 'Pali API', exact: true })
        .click({ trial: true });
      for (let step = 0; step < 20; step++) {
        await page.keyboard.press('Tab');
        if (
          await copy.evaluate((element) => document.activeElement === element)
        )
          break;
      }
      await expect(copy).toBeFocused();
      const box = (await copy.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      await page.keyboard.press('Enter');
    }
    expect(await page.evaluate(() => (window as any).__supportCopies)).toEqual([
      supportUrl,
      supportUrl,
    ]);
    expect(routes.deniedWrites).toEqual([]);
  } finally {
    await wallet?.context.close().catch(() => undefined);
    await server.close();
    Object.assign(E2E_CONFIG, before);
  }
});
