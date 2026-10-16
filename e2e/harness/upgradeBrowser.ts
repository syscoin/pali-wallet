import { chromium, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import { E2E_CONFIG } from './config';

// The historical Web Store build's main UI requires a real action POPUP, not
// an app.html tab. Chromium exposes that popup via CDP, but Playwright's first
// pipe connection does not adopt it automatically. A second public CDP
// connection can discover the already-open target; no extension code, storage,
// context classification or guard is changed.
export async function launchUpgradeBrowser(
  extensionPath: string,
  proxyOrigin: string,
  resumeProfileDir?: string
) {
  const profiles = path.resolve(E2E_CONFIG.artifactsDir, 'profiles');
  fs.mkdirSync(profiles, { recursive: true });
  if (fs.realpathSync(profiles) !== profiles)
    throw new Error('Upgrade profiles directory cannot be a symlink');
  const profileDir =
    resumeProfileDir || path.join(profiles, `store-upgrade-${Date.now()}`);
  const relative = path.relative(profiles, profileDir);
  if (
    !relative ||
    relative === '..' ||
    relative.includes(path.sep) ||
    path.isAbsolute(relative)
  )
    throw new Error('Upgrade profile must be a run-owned direct child');
  if (resumeProfileDir) {
    if (
      !fs.lstatSync(profileDir).isDirectory() ||
      fs.lstatSync(profileDir).isSymbolicLink() ||
      fs.realpathSync(profileDir) !== profileDir
    )
      throw new Error('Unsafe upgrade profile resumption');
  } else fs.mkdirSync(profileDir);
  const proxy = new URL(proxyOrigin);
  if (
    proxy.protocol !== 'http:' ||
    proxy.hostname !== '127.0.0.1' ||
    !proxy.port ||
    proxy.username ||
    proxy.password ||
    proxy.pathname !== '/' ||
    proxy.search ||
    proxy.hash
  )
    throw new Error('Upgrade browser requires a loopback deny proxy');
  const context = await chromium.launchPersistentContext(profileDir, {
    args: [
      ...(E2E_CONFIG.headless ? ['--headless=new'] : []),
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      '--enable-unsafe-extension-debugging',
      '--disable-quic',
    ],
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    proxy: { server: proxyOrigin, bypass: '<-loopback>' },
    viewport: { width: 600, height: 800 },
  });
  try {
    let [worker] = context.serviceWorkers();
    worker ||= await context.waitForEvent('serviceworker', { timeout: 30000 });
    const extensionId = new URL(worker.url()).hostname;
    const devtoolsPort = fs
      .readFileSync(path.join(profileDir, 'DevToolsActivePort'), 'utf8')
      .split('\n')[0];
    if (
      !/^\d{1,5}$/.test(devtoolsPort) ||
      Number(devtoolsPort) < 1 ||
      Number(devtoolsPort) > 65535
    )
      throw new Error('Invalid owned browser debugging port');
    const adoptPopup = async () => {
      const connection = await chromium.connectOverCDP(
        `http://127.0.0.1:${devtoolsPort}`
      );
      const [adopted] = connection.contexts();
      if (!adopted) throw new Error('Owned popup browser context unavailable');
      return adopted;
    };
    const activatePackage = async () => {
      const cdp = await context.browser()!.newBrowserCDPSession();
      try {
        return await cdp.send('Extensions.loadUnpacked', {
          path: extensionPath,
        });
      } finally {
        await cdp.detach();
      }
    };
    const triggerAction = async () => {
      const cdp = await context.browser()!.newBrowserCDPSession();
      try {
        const { targetInfos } = await cdp.send('Target.getTargets', {
          filter: [{ type: 'tab', exclude: false }],
        });
        const tab = targetInfos.find(
          (target) =>
            target.type === 'tab' &&
            (target.url === 'about:blank' || target.url.startsWith(proxyOrigin))
        );
        if (!tab) throw new Error('Owned action target tab unavailable');
        await cdp.send('Extensions.triggerAction', {
          id: extensionId,
          targetId: tab.targetId,
        });
        await expect
          .poll(
            async () => {
              const targets = await cdp.send('Target.getTargets');
              return targets.targetInfos.filter((target) =>
                target.url.startsWith(
                  `chrome-extension://${extensionId}/app.html`
                )
              ).length;
            },
            { timeout: 10000 }
          )
          .toBe(1);
      } finally {
        await cdp.detach();
      }
    };
    return {
      context,
      extensionId,
      profileDir,
      adoptPopup,
      activatePackage,
      triggerAction,
    };
  } catch (error) {
    await context.close();
    throw error;
  }
}

export type UpgradeBrowser = Awaited<ReturnType<typeof launchUpgradeBrowser>>;
