import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import es from '../../source/assets/locales/es.json';
import fr from '../../source/assets/locales/fr.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Genuine recipient choices in one fenced disposable browser worker. It uses ordinary
// create-account, edit-account, Send and Languages controls. No injected labels,
// balances, controller responses, provider results, signing or broadcasting.
const ROW_SELECTOR = '.sender-custom-input button';
const SHARED_LABEL = 'Shared recipient';
const localeCases = [
  { code: 'en', text: en, option: 'English English' },
  { code: 'es', text: es, option: 'Spanish Español' },
  { code: 'fr', text: fr, option: 'French Français' },
] as const;
type Locale = (typeof localeCases)[number];

async function publicAccounts(page: Page) {
  return page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    return {
      active: state.vault.activeAccount,
      network: {
        kind: state.vault.activeNetwork.kind,
        chainId: state.vault.activeNetwork.chainId,
      },
      accounts: Object.values(state.vault.accounts.HDAccount).map((a: any) => ({
        id: a.id,
        label: a.label,
        address: a.address,
      })),
    };
  });
}

async function nativeRowNames(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector: ROW_SELECTOR,
    });
    const result: unknown[] = [];
    for (const nodeId of nodeIds) {
      const { nodes } = await cdp.send('Accessibility.getPartialAXTree', {
        nodeId,
        fetchRelatives: false,
      });
      const node = nodes.find(
        (item) => item.role?.value === 'button' && !item.ignored
      );
      expect(node).toBeDefined();
      result.push({
        role: node!.role?.value,
        name: node!.name?.value,
        description: node!.description?.value ?? null,
      });
    }
    return result as {
      description: string | null;
      name: string;
      role: string;
    }[];
  } finally {
    await cdp.detach();
  }
}

async function saveLanguage(page: Page, current: Locale, next: Locale) {
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
  await page
    .getByRole('button', { name: current.text.buttons.save, exact: true })
    .click();
  await expect(
    page.getByText(next.text.settings.languageWasSet, { exact: true })
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
}

test('recipient suggestions distinguish identical editable labels and use the saved language', async ({}, info) => {
  test.setTimeout(180_000);
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  const sourceSha256 = createHash('sha256')
    .update(fs.readFileSync(info.file))
    .digest('hex');
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'RecipientChoiceSyntheticOnly!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = { runtime, sourceSha256 };
  const pageErrors: string[] = [];
  const forbiddenRequests: string[] = [];
  try {
    wallet = await PaliWallet.launch('recipient-suggestion-identity', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const fixture = createIsolatedVaultFixture();
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    observations.workerIdentity = await verifyExecutingWorker(
      wallet.context,
      wallet.extensionId,
      E2E_CONFIG.extensionPath,
      (value) => {
        observations.workerIdentity = value;
      }
    );
    const page = wallet.page;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    wallet.context.on('request', (request) => {
      if (/\/sendtx(?:\/|$)/i.test(request.url()))
        forbiddenRequests.push('sendtx');
      try {
        const body = request.postDataJSON();
        for (const call of Array.isArray(body) ? body : [body])
          if (
            /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
              call?.method || ''
            )
          )
            forbiddenRequests.push(call.method);
      } catch {
        /* ordinary GET */
      }
    });
    const openGeneral = async (action: string) => {
      await wallet!.ensureOnHome();
      await page
        .getByRole('button', {
          name: en.generalMenu.generalOptions,
          exact: true,
        })
        .click();
      await page.getByRole('menuitem', { name: action, exact: true }).click();
    };
    const rename = async (oldLabel: string, newLabel: string) => {
      await openGeneral(en.accountMenu.manageAccounts);
      await page
        .getByRole('button', {
          name: `${en.buttons.edit}: ${oldLabel}`,
          exact: true,
        })
        .click();
      await page
        .getByPlaceholder(en.settings.accountLabel, { exact: true })
        .fill(newLabel);
      await page
        .getByRole('button', { name: en.buttons.save, exact: true })
        .click();
      await expect(page).toHaveURL(/#\/settings\/manage-accounts/);
      await wallet!.ensureOnHome();
    };
    const openChoices = async (locale: Locale) => {
      await page.locator('#send-btn').click();
      await expect(page).toHaveURL(/#\/send\/eth$/);
      const input = page.getByPlaceholder(locale.text.send.receiver, {
        exact: true,
      });
      await input.fill('');
      await input.click();
      await expect(page.locator(ROW_SELECTOR)).toHaveCount(2);
      return input;
    };
    const observeChoices = async () => ({
      native: await nativeRowNames(wallet!.context, page),
      visible: await page.locator(ROW_SELECTOR).evaluateAll((rows) =>
        rows.map((row) => ({
          text: (row as HTMLElement).innerText,
          title: row.getAttribute('title'),
          ariaLabel: row.getAttribute('aria-label'),
          ariaDescription: row.getAttribute('aria-description'),
          describedBy: row.getAttribute('aria-describedby'),
          badge: row.querySelector(':scope > span:last-child')?.textContent,
        }))
      ),
    });
    await wallet.step(
      'create two independently named local EVM recipients through ordinary forms',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
        const initial = await publicAccounts(page);
        expect(initial.accounts).toHaveLength(1);
        await rename(initial.accounts[0].label, 'Daily recipient');
        await openGeneral(en.accountMenu.createNewAccount);
        await page.locator('#account-name-input').fill('Savings recipient');
        await page.locator('#create-btn').click();
        await page
          .getByRole('button', { name: en.buttons.ok, exact: true })
          .click();
        await wallet!.ensureOnHome();
        const created = await publicAccounts(page);
        expect(created.accounts.map((a) => a.address.toLowerCase())).toEqual(
          fixture.evmAddresses.map((a) => a.toLowerCase())
        );
        expect(created.accounts.map((a) => a.label)).toEqual([
          'Daily recipient',
          'Savings recipient',
        ]);
        observations.created = created;
      }
    );
    await wallet.step(
      'healthy control exposes distinct native choices and keyboard selects the intended exact address',
      async () => {
        const input = await openChoices(localeCases[0]);
        const healthy = await observeChoices();
        observations.healthy = healthy;
        expect(new Set(healthy.native.map((row) => row.name)).size).toBe(2);
        await input.press('Tab');
        await page.keyboard.press('Tab');
        await expect(page.locator(ROW_SELECTOR).nth(1)).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(input).toHaveValue(fixture.evmAddresses[1]);
        await expect(page).toHaveURL(/#\/send\/eth$/);
        await wallet!.ensureOnHome();
      }
    );
    await wallet.step(
      'ordinary edits permit two accounts to share the same label',
      async () => {
        await rename('Daily recipient', SHARED_LABEL);
        await rename('Savings recipient', SHARED_LABEL);
        const renamed = await publicAccounts(page);
        expect(renamed.accounts.map((a) => a.label)).toEqual([
          SHARED_LABEL,
          SHARED_LABEL,
        ]);
        expect(
          new Set(renamed.accounts.map((a) => a.address.toLowerCase())).size
        ).toBe(2);
        observations.renamed = renamed;
      }
    );
    for (let index = 0; index < localeCases.length; index++) {
      const locale = localeCases[index];
      if (index > 0) await saveLanguage(page, localeCases[index - 1], locale);
      await wallet.step(
        locale.code +
          ': inspect native choices before activating either recipient',
        async () => {
          const input = await openChoices(locale);
          const observed = await observeChoices();
          observations[locale.code] = observed;
          await info.attach(`recipient-choices-${locale.code}`, {
            body: await page.screenshot({ animations: 'disabled' }),
            contentType: 'image/png',
          });
          expect
            .soft(
              new Set(observed.native.map((row) => row.name)).size,
              'Distinct addresses with duplicate editable labels need distinct accessible identities'
            )
            .toBe(2);
          for (const [rowIndex, address] of fixture.evmAddresses.entries()) {
            expect(observed.native[rowIndex].name).toBe(
              `${SHARED_LABEL}, ${address}, ${locale.text.transactions.account}`
            );
            expect(observed.visible[rowIndex].title).toBe(address);
            expect(observed.visible[rowIndex].badge).toBe(
              locale.text.transactions.account
            );
            await expect(
              page.locator(ROW_SELECTOR).nth(rowIndex)
            ).toContainText(`${address.slice(0, 8)}...${address.slice(-6)}`);
          }
          await page.setViewportSize({ width: 320, height: 620 });
          const narrow = await observeChoices();
          observations[locale.code + '-320'] = narrow;
          expect(narrow.native).toEqual(observed.native);
          const geometry = await page
            .locator(ROW_SELECTOR)
            .evaluateAll((rows) =>
              rows.map((row) => {
                const box = row.getBoundingClientRect();
                const center = document.elementFromPoint(
                  box.x + box.width / 2,
                  box.y + box.height / 2
                );
                return {
                  contained: box.left >= 0 && box.right <= window.innerWidth,
                  centerHitsRow: center === row || row.contains(center),
                  textFits: row.scrollWidth <= row.clientWidth,
                };
              })
            );
          expect(geometry).toEqual([
            { contained: true, centerHitsRow: true, textFits: true },
            { contained: true, centerHitsRow: true, textFits: true },
          ]);
          await info.attach(`recipient-choices-${locale.code}-320`, {
            body: await page.screenshot({ animations: 'disabled' }),
            contentType: 'image/png',
          });
          await page.setViewportSize({ width: 400, height: 620 });
          // Both ordinary keyboard targets must still insert their own exact
          // public destination. Do not enter an amount or advance to confirmation.
          await input.press('Tab');
          await expect(page.locator(ROW_SELECTOR).nth(0)).toBeFocused();
          await page.keyboard.press('Space');
          await expect(input).toHaveValue(fixture.evmAddresses[0]);
          await input.fill('');
          await input.click();
          await input.press('Tab');
          await page.keyboard.press('Tab');
          await expect(page.locator(ROW_SELECTOR).nth(1)).toBeFocused();
          await page.keyboard.press('Enter');
          await expect(input).toHaveValue(fixture.evmAddresses[1]);
          await expect(page).toHaveURL(/#\/send\/eth$/);
          await wallet!.ensureOnHome();
        }
      );
    }
    expect(pageErrors).toEqual([]);
    expect(forbiddenRequests).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    status = info.errors.length === 0 ? 'passed' : 'failed';
  } finally {
    await info.attach('recipient-suggestion-evidence', {
      body: Buffer.from(
        JSON.stringify(
          {
            ...observations,
            pageErrors,
            forbiddenRequests,
            deniedWrites: routes?.deniedWrites,
          },
          null,
          2
        )
      ),
      contentType: 'application/json',
    });
    try {
      await wallet?.dispose(status);
    } finally {
      try {
        await server.close();
      } finally {
        Object.assign(E2E_CONFIG, before);
      }
    }
  }
});
