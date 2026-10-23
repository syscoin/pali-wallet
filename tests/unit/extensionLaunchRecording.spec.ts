/** @jest-environment node */

import { chromium } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { E2E_CONFIG } from '../../e2e/harness/config';
import { launchExtension } from '../../e2e/harness/launch';

// Only the browser boundary is mocked. Manifest/profile handling, option
// validation and worker discovery are the actual launch helper under test.
jest.mock('@playwright/test', () => ({
  chromium: { launchPersistentContext: jest.fn() },
}));

const launch = chromium.launchPersistentContext as jest.Mock;
const proxy = 'http://127.0.0.1:61421';
const extensionId = 'a'.repeat(32);

describe('extension launch recording privacy contract', () => {
  let directory: string;
  let previous: typeof E2E_CONFIG;
  let worker: { url: jest.Mock };
  let context: {
    close: jest.Mock;
    serviceWorkers: jest.Mock;
    waitForEvent: jest.Mock;
  };

  beforeEach(() => {
    directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'pali-launch-recording-')
    );
    previous = { ...E2E_CONFIG };
    const extensionPath = path.join(directory, 'extension');
    fs.mkdirSync(extensionPath);
    fs.writeFileSync(path.join(extensionPath, 'manifest.json'), '{}');
    Object.assign(E2E_CONFIG, {
      extensionPath,
      artifactsDir: path.join(directory, 'artifacts'),
      headless: true,
    });
    worker = {
      url: jest.fn(
        () => `chrome-extension://${extensionId}/background.bundle.js`
      ),
    };
    context = {
      close: jest.fn().mockResolvedValue(undefined),
      serviceWorkers: jest.fn(() => [worker]),
      waitForEvent: jest.fn().mockResolvedValue(worker),
    };
    launch.mockReset();
    launch.mockResolvedValue(context);
  });

  afterEach(() => {
    Object.assign(E2E_CONFIG, previous);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const extensionArgs = () => [
    '--headless=new',
    `--disable-extensions-except=${E2E_CONFIG.extensionPath}`,
    `--load-extension=${E2E_CONFIG.extensionPath}`,
  ];

  it('preserves the exact default recording object and ordinary extension launch', async () => {
    const result = await launchExtension('default-recording');
    expect(launch).toHaveBeenCalledTimes(1);
    const [profile, options] = launch.mock.calls[0];
    expect(path.dirname(profile)).toBe(
      path.join(E2E_CONFIG.artifactsDir, 'profiles')
    );
    expect(path.basename(profile)).toMatch(/^default-recording-\d+$/);
    expect(fs.statSync(profile).isDirectory()).toBe(true);
    expect(options).toEqual({
      args: extensionArgs(),
      deviceScaleFactor: undefined,
      headless: false,
      recordVideo: {
        dir: path.join(E2E_CONFIG.artifactsDir, 'videos'),
        size: { height: 800, width: 600 },
      },
      viewport: { height: 800, width: 600 },
    });
    expect(result).toEqual({ context, extensionId, profileDir: profile });
    expect(context.serviceWorkers).toHaveBeenCalledTimes(1);
    expect(context.waitForEvent).not.toHaveBeenCalled();
    expect(context.close).not.toHaveBeenCalled();
  });

  it('keeps explicit video sizing and recording by default even with a deny proxy', async () => {
    await launchExtension('fenced-recording', {
      offlineHttpProxy: proxy,
      videoSize: { height: 720, width: 480 },
      viewport: { height: 620, width: 400 },
    });
    expect(launch.mock.calls[0][1]).toEqual({
      args: [...extensionArgs(), '--disable-quic'],
      ignoreDefaultArgs: ['--disable-extensions'],
      proxy: { server: proxy, bypass: '<-loopback>' },
      deviceScaleFactor: undefined,
      headless: false,
      recordVideo: {
        dir: path.join(E2E_CONFIG.artifactsDir, 'videos'),
        size: { height: 720, width: 480 },
      },
      viewport: { height: 620, width: 400 },
    });
  });

  it('rejects recording suppression without a launch-time deny proxy before browser launch', async () => {
    await expect(
      launchExtension('unfenced-no-record', { recordVideo: false })
    ).rejects.toThrow();
    expect(launch).not.toHaveBeenCalled();
  });

  it.each([
    'https://127.0.0.1:61421',
    'http://localhost:61421',
    'http://127.0.0.1',
    'http://127.0.0.1:61421/path',
    'http://127.0.0.1:61421/?query=1',
    'http://127.0.0.1:61421/#fragment',
    'http://user:password@127.0.0.1:61421',
    'http://192.0.2.1:61421',
  ])(
    'rejects a non-exact loopback proxy %s before non-recording launch',
    async (invalidProxy) => {
      await expect(
        launchExtension('invalid-no-record', {
          offlineHttpProxy: invalidProxy,
          recordVideo: false,
        })
      ).rejects.toThrow();
      expect(launch).not.toHaveBeenCalled();
    }
  );

  it('omits video only for explicit false plus a valid deny proxy without changing the fence or worker discovery', async () => {
    context.serviceWorkers.mockReturnValue([]);
    const viewport = { height: 620, width: 400 };
    const result = await launchExtension('private-phrase', {
      deviceScaleFactor: 1,
      offlineHttpProxy: proxy,
      recordVideo: false,
      viewport,
    });
    expect(launch).toHaveBeenCalledTimes(1);
    const [profile, options] = launch.mock.calls[0];
    expect(path.dirname(profile)).toBe(
      path.join(E2E_CONFIG.artifactsDir, 'profiles')
    );
    expect(path.basename(profile)).toMatch(/^private-phrase-\d+$/);
    expect(fs.statSync(profile).isDirectory()).toBe(true);
    expect(options).toEqual({
      args: [...extensionArgs(), '--disable-quic'],
      ignoreDefaultArgs: ['--disable-extensions'],
      proxy: { server: proxy, bypass: '<-loopback>' },
      deviceScaleFactor: 1,
      headless: false,
      viewport,
    });
    expect(Object.prototype.hasOwnProperty.call(options, 'recordVideo')).toBe(
      false
    );
    expect(context.waitForEvent).toHaveBeenCalledWith('serviceworker', {
      timeout: 30_000,
    });
    expect(result).toEqual({ context, extensionId, profileDir: profile });
    expect(context.close).not.toHaveBeenCalled();
  });

  it('retains context cleanup when a non-recording worker fails to appear', async () => {
    const failure = new Error('Synthetic worker discovery failure');
    context.serviceWorkers.mockReturnValue([]);
    context.waitForEvent.mockRejectedValue(failure);
    await expect(
      launchExtension('worker-failure', {
        offlineHttpProxy: proxy,
        recordVideo: false,
      })
    ).rejects.toBe(failure);
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(
      Object.prototype.hasOwnProperty.call(
        launch.mock.calls[0][1],
        'recordVideo'
      )
    ).toBe(false);
  });
});
