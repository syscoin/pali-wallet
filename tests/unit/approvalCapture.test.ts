import { expect as playwrightExpect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import { E2E_CONFIG } from '../../e2e/harness/config';
import { PaliWallet } from '../../e2e/harness/pali';
import { approve } from '../../e2e/harness/testDappConformance';

jest.mock('@playwright/test', () => ({ expect: jest.fn() }));

describe('approval screenshot evidence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  function setup() {
    const events: string[] = [];
    let closed = false;
    const result = { settled: true, result: 'signed-fixture' };
    const popup = {
      url: () => 'chrome-extension://fixture/external.html',
      isClosed: () => closed,
      waitForLoadState: jest.fn(),
      locator: jest.fn(() => ({ waitFor: jest.fn() })),
      screenshot: jest.fn(async (_options: unknown) => {
        void _options;
        expect(closed).toBe(false);
        events.push('screenshot approval');
      }),
      getByRole: () => ({
        last: () => ({
          click: async () => {
            events.push('click approval');
            closed = true;
          },
        }),
      }),
    };
    const page = {
      evaluate: jest.fn(async () => (closed ? result : { settled: false })),
      locator: jest.fn(),
      screenshot: jest.fn(),
    };
    const wallet = {
      page,
      screenshotIndex: 0,
      summary: { addStep: jest.fn() },
      shot: PaliWallet.prototype.shot,
    };
    const matchers = {
      toBeVisible: jest.fn(),
      toBeEnabled: jest.fn(),
      toHaveCSS: jest.fn(),
    };
    (playwrightExpect as unknown as jest.Mock).mockReturnValue(matchers);
    (playwrightExpect as any).poll = (read: () => Promise<unknown>) => ({
      toBe: async (expected: unknown) => expect(await read()).toBe(expected),
    });
    return { events, page, popup, result, wallet };
  }

  it('captures the actual approval before click/close and retains it in the step', async () => {
    const { events, page, popup, result, wallet } = setup();
    const returned = await PaliWallet.prototype.step.call(
      wallet,
      'normal sys_sign',
      (capture) =>
        approve({ pages: () => [popup] } as any, page as any, 0, capture)
    );
    expect(returned).toBe(result);
    expect(events).toEqual(['screenshot approval', 'click approval']);
    expect(popup.screenshot).toHaveBeenCalledTimes(1);
    expect(page.screenshot).not.toHaveBeenCalled();
    const screenshot = popup.screenshot.mock.calls[0][0] as any;
    expect(screenshot.fullPage).toBe(true);
    expect(screenshot.mask).toEqual([popup.locator.mock.results.at(-1)?.value]);
    expect(popup.locator).toHaveBeenLastCalledWith(
      '#import-wallet-input, input[type="password"], textarea'
    );
    expect(wallet.summary.addStep).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'passed',
        screenshot: path.relative(E2E_CONFIG.artifactsDir, screenshot.path),
      })
    );
  });

  it('does not approve when capturing the popup fails', async () => {
    const { events, page, popup, wallet } = setup();
    popup.screenshot.mockRejectedValueOnce(new Error('capture failed'));
    await expect(
      PaliWallet.prototype.step.call(wallet, 'normal sys_sign', (capture) =>
        approve({ pages: () => [popup] } as any, page as any, 0, capture)
      )
    ).rejects.toThrow('capture failed');
    expect(events).toEqual([]);
    expect(wallet.summary.addStep).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', note: 'capture failed' })
    );
  });

  it('retains captured approval evidence if later validation fails', async () => {
    const { page, popup, wallet } = setup();
    await expect(
      PaliWallet.prototype.step.call(
        wallet,
        'normal sys_sign',
        async (capture) => {
          await capture(popup as any);
          throw new Error('invalid response');
        }
      )
    ).rejects.toThrow('invalid response');
    expect(page.screenshot).not.toHaveBeenCalled();
    expect(wallet.summary.addStep).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        note: 'invalid response',
        screenshot: expect.stringContaining('normal-sys-sign.png'),
      })
    );
  });

  it('keeps the existing driver-page screenshot when no capture is requested', async () => {
    const { page, popup, wallet } = setup();
    await PaliWallet.prototype.step.call(wallet, 'driver step', async () => 42);
    expect(page.screenshot).toHaveBeenCalledTimes(1);
    expect(popup.screenshot).not.toHaveBeenCalled();
  });
});
