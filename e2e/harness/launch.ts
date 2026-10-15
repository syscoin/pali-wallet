import { type BrowserContext, chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import { E2E_CONFIG } from './config';

export type LaunchedExtension = {
  context: BrowserContext;
  extensionId: string;
};

export type LaunchOptions = {
  // Render at a higher device pixel ratio for crisp docs screenshots.
  deviceScaleFactor?: number;
  // Fixture-only HTTP(S) egress fence, installed before the MV3 worker starts.
  // The loopback proxy must reject CONNECT rather than forward public traffic.
  offlineHttpProxy?: string;
  videoSize?: { height: number; width: number };
  viewport?: { height: number; width: number };
};

// Launches a fresh Chromium profile with the built extension loaded. Each run
// gets its own profile under the artifacts dir so runs are reproducible and
// never inherit vault state from a previous loop iteration.
export const launchExtension = async (
  profileName: string,
  options: LaunchOptions = {}
): Promise<LaunchedExtension> => {
  const manifest = path.join(E2E_CONFIG.extensionPath, 'manifest.json');
  if (!fs.existsSync(manifest)) {
    throw new Error(
      `Extension build not found at ${E2E_CONFIG.extensionPath}. Run "yarn build" first.`
    );
  }

  // Unique suffix so a relaunch (e.g. Playwright restarting the worker after
  // a failed test re-runs beforeAll) never inherits vault state from the
  // previous launch's profile.
  const profileDir = path.join(
    E2E_CONFIG.artifactsDir,
    'profiles',
    `${profileName}-${Date.now()}`
  );
  fs.mkdirSync(profileDir, { recursive: true });

  const args = [
    `--disable-extensions-except=${E2E_CONFIG.extensionPath}`,
    `--load-extension=${E2E_CONFIG.extensionPath}`,
  ];
  if (options.offlineHttpProxy) {
    const proxy = new URL(options.offlineHttpProxy);
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
      throw new Error('Offline fixture proxy must be a loopback HTTP origin');
    args.push('--disable-quic');
  }
  if (E2E_CONFIG.headless) {
    // MV3 extensions require the new headless mode.
    args.unshift('--headless=new');
  }

  const viewport = options.viewport ?? { height: 800, width: 600 };
  const context = await chromium.launchPersistentContext(profileDir, {
    args,
    ...(options.offlineHttpProxy
      ? {
          ignoreDefaultArgs: ['--disable-extensions'],
          // Disable Chromium's implicit loopback bypass too: only the proxy's own
          // exact dapp URL is served, and no local/public service is forwarded.
          proxy: { server: options.offlineHttpProxy, bypass: '<-loopback>' },
        }
      : {}),
    deviceScaleFactor: options.deviceScaleFactor,
    headless: false,
    recordVideo: {
      dir: path.join(E2E_CONFIG.artifactsDir, 'videos'),
      size: options.videoSize ?? viewport,
    },
    viewport,
  });

  let [background] = context.serviceWorkers();
  if (!background) {
    background = await context.waitForEvent('serviceworker');
  }
  const extensionId = background.url().split('/')[2];

  return { context, extensionId };
};
