import { type BrowserContext, type Page, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import { E2E_CONFIG } from './config';
import { type LaunchOptions, launchExtension } from './launch';
import { type Finding, JourneySummary } from './summary';

// High-level driver for the Pali extension UI. Journeys compose these
// primitives inside `step()` blocks so every action is screenshotted and
// recorded in the machine-readable run summary for agent loops.
export class PaliWallet {
  readonly context: BrowserContext;
  readonly extensionId: string;
  readonly page: Page;
  readonly summary: JourneySummary;

  private screenshotIndex = 0;

  private constructor(
    context: BrowserContext,
    extensionId: string,
    page: Page,
    summary: JourneySummary
  ) {
    this.context = context;
    this.extensionId = extensionId;
    this.page = page;
    this.summary = summary;
  }

  static async launch(
    journeyName: string,
    options: LaunchOptions = {}
  ): Promise<PaliWallet> {
    const summary = new JourneySummary(journeyName);
    const { context, extensionId } = await launchExtension(
      journeyName,
      options
    );
    const page = context.pages()[0] || (await context.newPage());
    const wallet = new PaliWallet(context, extensionId, page, summary);
    await wallet.gotoRoute('#/');
    return wallet;
  }

  appUrl(route: string): string {
    return `chrome-extension://${this.extensionId}/app.html${route}`;
  }

  async gotoRoute(route: string) {
    await this.page.goto(this.appUrl(route));
    await this.waitAppReady();
  }

  async waitAppReady() {
    await this.page
      .locator('#app-root, #external-root')
      .first()
      .waitFor({ state: 'attached', timeout: 30_000 });
    // The splash loader is removed once the store is rehydrated.
    await this.page
      .locator('#initial-loader')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);
  }

  // Wraps an action with timing, auto-screenshot and summary recording.
  async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    try {
      const result = await fn();
      const screenshot = await this.shot(name);
      this.summary.addStep({
        durationMs: Date.now() - startedAt,
        name,
        screenshot,
        status: 'passed',
      });
      return result;
    } catch (error) {
      const screenshot = await this.shot(`FAILED ${name}`).catch(
        () => undefined
      );
      this.summary.addStep({
        durationMs: Date.now() - startedAt,
        name,
        note: error instanceof Error ? error.message : String(error),
        screenshot,
        status: 'failed',
      });
      throw error;
    }
  }

  async shot(label: string): Promise<string> {
    this.screenshotIndex += 1;
    const file = path.join(
      E2E_CONFIG.artifactsDir,
      'screenshots',
      `${String(this.screenshotIndex).padStart(3, '0')}-${label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 80)}.png`
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await this.page.screenshot({
      fullPage: true,
      // Screenshots get published to GitHub comments via the e2e-media
      // branch, and failure shots can land mid-onboarding with the seed or
      // password on screen. Mask every input that could hold a secret
      // (#import-wallet-input is the seed textarea; SeedPhraseDisplay pages
      // are hidden by default behind the eye toggle).
      mask: [
        this.page.locator(
          '#import-wallet-input, input[type="password"], textarea'
        ),
      ],
      path: file,
    });
    return path.relative(E2E_CONFIG.artifactsDir, file);
  }

  finding(finding: Finding) {
    this.summary.addFinding(finding);
  }

  // --- Onboarding -----------------------------------------------------------

  async importSeedAndCreatePassword() {
    await this.gotoRoute('#/');
    await this.page.click('#import-wallet-link');

    // Screenshots are masked (see shot()), but the context video records the
    // page as-is. Render the seed input as bullets so the mnemonic never
    // appears in any published frame; the input value itself is unaffected.
    await this.page.addStyleTag({
      content:
        '#import-wallet-input { -webkit-text-security: disc !important; }',
    });

    const seedInput = this.page.locator('#import-wallet-input');
    await seedInput.fill(E2E_CONFIG.seedPhrase);
    await this.page
      .locator('#import-wallet-action, button:has-text("Import")')
      .first()
      .click();

    await expect(this.page).toHaveURL(/create-password-import/);
    const passwordFields = this.page.locator('#create-password');
    await passwordFields.first().fill(E2E_CONFIG.password);
    await passwordFields.last().fill(E2E_CONFIG.password);

    const nextButton = this.page
      .locator('#create-password-action, button:has-text("Next")')
      .first();
    await expect(nextButton).toBeEnabled();
    await nextButton.click();

    await expect(this.page).toHaveURL(/#\/home/, { timeout: 60_000 });
  }

  async unlock() {
    await this.page.locator('#password').fill(E2E_CONFIG.password);
    await this.page.locator('#unlock-btn').click();
    await expect(this.page).toHaveURL(/#\/home/, { timeout: 60_000 });
  }

  async ensureOnHome() {
    if (!this.page.url().includes('#/home')) {
      await this.gotoRoute('#/home');
    }
    if (this.page.url().endsWith('#/') || this.page.url().includes('#/?')) {
      await this.unlock();
    }
    await this.page
      .locator('#home-balance')
      .waitFor({ state: 'visible', timeout: 60_000 });
    await this.dismissBlockingModals();
  }

  // First-run prompts stack on home: the "Connect hardware wallet" bottom
  // sheet intercepts all pointer events, and dismissing it opens a
  // "Congratulations" headlessui Dialog whose open state marks the rest of
  // the page aria-hidden (breaking every getByRole locator). The Dialog's
  // close control is an <img>, so Escape is the only reliable dismissal.
  async dismissBlockingModals() {
    const dismissed: string[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      const dismissButton = this.page
        .getByRole('button', { name: /^(cancel|close|not now|skip)$/i })
        .first();
      if (await dismissButton.isVisible().catch(() => false)) {
        const label = await dismissButton.innerText().catch(() => 'dismiss');
        await dismissButton.click().catch(() => undefined);
        dismissed.push(`button "${label.trim()}"`);
        await this.page.waitForTimeout(400);
        continue;
      }

      const openDialog = this.page
        .locator('[role="dialog"], [id^="headlessui-dialog"]')
        .first();
      if (await openDialog.isVisible().catch(() => false)) {
        await this.page.keyboard.press('Escape');
        dismissed.push('dialog via Escape');
        await this.page.waitForTimeout(400);
        continue;
      }

      break;
    }
    if (dismissed.length > 0) {
      this.finding({
        detail: `Dismissed blocking first-run modals: ${dismissed.join(', ')}`,
        severity: 'quirk',
      });
    }
  }

  // --- Network --------------------------------------------------------------

  async getActiveNetworkLabel(): Promise<string> {
    const headerButton = this.networkMenuButton();
    return (await headerButton.innerText())
      .replace(/\s*(UTXO|EVM)\s*$/, '')
      .trim();
  }

  async switchNetwork(label: string, group: 'EVM' | 'UTXO' = 'EVM') {
    await this.ensureOnHome();
    const current = await this.getActiveNetworkLabel();
    if (current.toLowerCase() === label.toLowerCase()) {
      return;
    }

    await this.networkMenuButton().click();
    const groupButton = this.page
      .getByRole('button', { name: new RegExp(`${group} Networks`, 'i') })
      .first();
    await groupButton.click();
    await this.page
      .locator('li', { hasText: new RegExp(`^\\s*${label}\\s*$`) })
      .first()
      .click();

    await expect(this.networkMenuButton()).toContainText(label, {
      timeout: 120_000,
    });
    await this.page
      .locator('#home-balance')
      .waitFor({ state: 'visible', timeout: 120_000 });
  }

  private networkMenuButton() {
    // The header network button is the only header button carrying the
    // UTXO/EVM kind badge next to the active network label.
    return this.page
      .getByRole('button')
      .filter({ hasText: /UTXO|EVM/ })
      .first();
  }

  // --- Accounts -------------------------------------------------------------

  async getActiveAccountAddress(): Promise<string> {
    await this.gotoRoute('#/receive');
    const body = this.page.locator('body');
    await expect(body).toContainText(/0x[a-fA-F0-9]{6,}/, { timeout: 30_000 });
    const text = await body.innerText();
    const match = text.match(/0x[a-fA-F0-9]{40}/);
    if (!match) {
      throw new Error('Could not read active account address from #/receive');
    }
    await this.gotoRoute('#/home');
    return match[0];
  }

  async dispose(status?: 'passed' | 'failed') {
    this.summary.finish(status);
    await this.context.close();
  }
}
