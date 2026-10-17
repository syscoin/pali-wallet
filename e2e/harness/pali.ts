import { type BrowserContext, type Page, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';

import { E2E_CONFIG } from './config';
import { type LaunchOptions, launchExtension } from './launch';
import { verifyExecutingWorker } from './runtimeIdentity';
import { type Finding, JourneySummary } from './summary';

// High-level driver for the Pali extension UI. Journeys compose these
// primitives inside `step()` blocks so every action is screenshotted and
// recorded in the machine-readable run summary for agent loops.
export class PaliWallet {
  readonly context: BrowserContext;
  readonly extensionId: string;
  readonly page: Page;
  readonly profileDir: string;
  readonly summary: JourneySummary;

  private screenshotIndex = 0;

  private constructor(
    context: BrowserContext,
    extensionId: string,
    page: Page,
    summary: JourneySummary,
    profileDir: string
  ) {
    this.context = context;
    this.extensionId = extensionId;
    this.page = page;
    this.summary = summary;
    this.profileDir = profileDir;
  }

  static async launch(
    journeyName: string,
    options: LaunchOptions = {}
  ): Promise<PaliWallet> {
    const summary = new JourneySummary(journeyName);
    const startedAt = Date.now();
    let context: BrowserContext | undefined;
    try {
      const launched = await launchExtension(journeyName, options);
      context = launched.context;
      await verifyExecutingWorker(
        context,
        launched.extensionId,
        E2E_CONFIG.extensionPath,
        (value) => summary.setWorkerIdentity(value)
      );
      const page = context.pages()[0] || (await context.newPage());
      const wallet = new PaliWallet(
        context,
        launched.extensionId,
        page,
        summary,
        launched.profileDir
      );
      await wallet.gotoRoute('#/');
      return wallet;
    } catch (error) {
      try {
        summary.addStep({
          durationMs: Date.now() - startedAt,
          name: 'launch extension',
          note: error instanceof Error ? error.message : String(error),
          status: 'failed',
        });
        summary.finish('failed');
      } finally {
        await context?.close().catch(() => undefined);
      }
      throw error;
    }
  }

  appUrl(route: string): string {
    return `chrome-extension://${this.extensionId}/app.html${route}`;
  }

  async gotoRoute(route: string) {
    await this.page.goto(this.appUrl(route));
    await this.waitAppReady();
  }

  async waitAppReady() {
    const root = this.page.locator('#app-root, #external-root').first();
    await root.waitFor({ state: 'attached', timeout: 30_000 });
    // The loader stays attached; app-loaded fades it out without display:none.
    await this.page
      .locator('body.app-loaded')
      .waitFor({ state: 'attached', timeout: 30_000 });
    await expect(this.page.locator('#initial-loader')).toHaveCSS(
      'opacity',
      '0',
      {
        timeout: 30_000,
      }
    );
    await expect(root).toHaveCSS('opacity', '1', { timeout: 30_000 });
  }

  // Wraps an action with timing, auto-screenshot and summary recording.
  async step<T>(
    name: string,
    fn: (capture: (page: Page) => Promise<void>) => Promise<T>
  ): Promise<T> {
    const startedAt = Date.now();
    let screenshot: string | undefined;
    // Approval windows close on submission. Capture their UI while it is live,
    // then retain that evidence instead of replacing it with the driver tab.
    const capture = async (page: Page) => {
      screenshot = await this.shot(name, page);
    };
    try {
      const result = await fn(capture);
      screenshot ??= await this.shot(name);
      this.summary.addStep({
        durationMs: Date.now() - startedAt,
        name,
        screenshot,
        status: 'passed',
      });
      return result;
    } catch (error) {
      screenshot ??= await this.shot(`FAILED ${name}`).catch(() => undefined);
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

  async shot(label: string, page: Page = this.page): Promise<string> {
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
    await page.screenshot({
      // Finish finite route fades before capture; do not publish a nearly
      // transparent transition frame as evidence of the completed screen.
      animations: 'disabled',
      fullPage: true,
      // Screenshots get published to GitHub comments via the e2e-media
      // branch, and failure shots can land mid-onboarding with the seed or
      // password on screen. Mask every input that could hold a secret
      // (#import-wallet-input is the seed textarea; SeedPhraseDisplay pages
      // are hidden by default behind the eye toggle).
      mask: [
        page.locator('#import-wallet-input, input[type="password"], textarea'),
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
    await this.page.locator('#create-password').fill(E2E_CONFIG.password);
    await this.page.locator('#confirm-password').fill(E2E_CONFIG.password);

    const nextButton = this.page
      .locator('#create-password-action, button:has-text("Next")')
      .first();
    await expect(nextButton).toBeEnabled();
    await nextButton.click();

    await expect(this.page).toHaveURL(/#\/home/, { timeout: 60_000 });
  }

  async unlock() {
    const login = this.page.locator('#login');
    await login.locator('#password').fill(E2E_CONFIG.password);
    await login.locator('#unlock-btn').click();
    await expect(this.page).toHaveURL(/#\/home/, { timeout: 60_000 });
  }

  async ensureOnHome() {
    // A HashRouter query belongs to the same screen, but a child route such
    // as /home/smart-account is the Hub, not Home with a visible balance.
    const hashPath = new URL(this.page.url()).hash.split('?')[0];
    if (hashPath !== '#/home') {
      await this.gotoRoute('#/home');
    }
    const balance = this.page
      .locator('#home-balance, #home-balance-pending')
      .first();
    const login = this.page.locator('#login');
    const password = login.locator('#password');
    const unlock = login.locator('#unlock-btn');
    const isIdleLockedForm = async () =>
      new URL(this.page.url()).hash.split('?')[0] === '#/' &&
      (await login.isVisible()) &&
      (await password.isVisible()) &&
      (await unlock.isVisible()) &&
      (await unlock.isEnabled());
    let readyToUnlock = false;
    // A rehydrating router can still show #/home before redirecting to Lock.
    // A completed unlock can also leave its old form visible briefly at Home.
    // Authenticate only the real idle login form on its root route, never a
    // stale button or an in-flight submit (other prompts reuse unlock-btn).
    // Pending is valid readiness when the fenced fixture denies the default
    // network; each journey still asserts its own exact balance afterward.
    await expect
      .poll(
        async () => {
          readyToUnlock = false;
          if (
            new URL(this.page.url()).hash.split('?')[0] === '#/home' &&
            (await balance.isVisible())
          )
            return true;
          readyToUnlock = await isIdleLockedForm();
          return readyToUnlock;
        },
        {
          timeout: 60_000,
        }
      )
      .toBe(true);
    if (readyToUnlock && (await isIdleLockedForm())) {
      await this.unlock();
    }
    await balance.waitFor({ state: 'visible', timeout: 60_000 });
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
    return (await this.networkMenuLabel().innerText()).trim();
  }

  async switchNetwork(label: string, group: 'EVM' | 'UTXO' = 'EVM') {
    await this.ensureOnHome();
    const current = await this.getActiveNetworkLabel();
    if (current.toLowerCase() === label.toLowerCase()) {
      return;
    }

    await this.networkMenuButton().click();
    const menu = this.page.getByRole('menu');
    const groupButton = menu
      .getByRole('menuitem', { name: new RegExp(`${group} Networks`, 'i') })
      .first();
    await expect(groupButton).toHaveAttribute(
      'aria-expanded',
      /^(true|false)$/
    );
    if ((await groupButton.getAttribute('aria-expanded')) !== 'true')
      await groupButton.click();
    await expect(groupButton).toHaveAttribute('aria-expanded', 'true');
    await menu
      .getByRole('menuitem', { name: label, exact: true })
      .first()
      .click();

    const escapeRegex = (value: string) =>
      value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const faucetTitle = new RegExp(
      '^' +
        escapeRegex(en.faucet.firstAccessTitle)
          .replace(escapeRegex('{{token}}'), '\\S+')
          .replace(escapeRegex('{{network}}'), escapeRegex(label)) +
        '$'
    );
    const faucet = this.page.getByRole('dialog', { name: faucetTitle });
    const balance = this.page.locator('#home-balance');
    let previouslyReady = false;
    // The informational prompt can mount after the network selection. Its
    // accessible dialog correctly hides the header until the user closes it.
    // Never dismiss an approval/security dialog or activate the faucet here.
    await expect
      .poll(
        async () => {
          const resetReadiness = () => {
            previouslyReady = false;
            return false;
          };
          // Observe the existing read-only state response, projecting only
          // network readiness. A cached balance can precede post-load finish.
          const status = await this.page.evaluate(
            () =>
              new Promise<{
                network: {
                  chainId: number;
                  kind: string;
                  label: string;
                  url: string;
                };
                networkStatus: string;
                postLoading: boolean;
                switchingAccount: boolean;
              } | null>((resolve) => {
                let finished = false;
                const finish = (value: any) => {
                  if (finished) return;
                  finished = true;
                  clearTimeout(timer);
                  resolve(value);
                };
                const timer = setTimeout(() => finish(null), 1000);
                try {
                  chrome.runtime.sendMessage(
                    { type: 'getCurrentState' },
                    (state) => {
                      if (
                        chrome.runtime.lastError ||
                        !state?.vault?.activeNetwork ||
                        !state?.vaultGlobal
                      ) {
                        finish(null);
                        return;
                      }
                      const network = state.vault.activeNetwork;
                      finish({
                        network: {
                          chainId: network.chainId,
                          kind: network.kind,
                          label: network.label,
                          url: network.url,
                        },
                        networkStatus: state.vaultGlobal.networkStatus,
                        postLoading:
                          state.vaultGlobal.isPostNetworkSwitchLoading,
                        switchingAccount: state.vaultGlobal.isSwitchingAccount,
                      });
                    }
                  );
                } catch {
                  finish(null);
                }
              })
          );
          if (
            !status ||
            status.network.label !== label ||
            status.network.kind !==
              (group === 'EVM' ? 'ethereum' : 'syscoin') ||
            !Number.isSafeInteger(status.network.chainId) ||
            !status.network.url ||
            status.networkStatus !== 'idle' ||
            status.postLoading !== false ||
            status.switchingAccount !== false
          )
            return resetReadiness();
          if (
            (await faucet.isVisible()) &&
            (await faucet
              .getByRole('button', {
                name: en.faucet.grabTokens,
                exact: true,
              })
              .isVisible())
          ) {
            await faucet
              .getByRole('button', { name: en.buttons.close, exact: true })
              .click();
            return resetReadiness();
          }
          const header = this.networkMenuButton();
          if (!(await header.isVisible()) || !(await balance.isVisible()))
            return resetReadiness();
          // A late prompt may hide it between the visibility read and text
          // read. Retry within the same bounded readiness check in that case.
          const text = await this.networkMenuLabel()
            .innerText({ timeout: 1000 })
            .catch(() => '');
          if (
            text.trim() !== label ||
            (await faucet.isVisible()) ||
            !(await header.isVisible()) ||
            !(await balance.isVisible())
          )
            return resetReadiness();
          const settled = previouslyReady;
          previouslyReady = true;
          return settled;
        },
        { timeout: 120_000 }
      )
      .toBe(true);
  }

  private networkMenuButton() {
    // The header network button is the only header button carrying the
    // UTXO/EVM kind badge next to the active network label.
    return this.page
      .getByRole('button')
      .filter({ hasText: /UTXO|EVM/ })
      .first();
  }

  private networkMenuLabel() {
    // NetworkMenu's first direct span is the name; the next span is its
    // UTXO/EVM badge. Custom ChainIcon children may also contain a chain id.
    return this.networkMenuButton().locator(':scope > span').first();
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
