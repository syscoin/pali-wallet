import { chromium } from '@playwright/test';
import fs from 'fs';

import { launchExtension } from '../../e2e/harness/launch';
import { PaliWallet } from '../../e2e/harness/pali';
import { JourneySummary } from '../../e2e/harness/summary';
import { summaryReportIcon } from '../../e2e/scripts/summary-status.cjs';
import {
  registerVisualSummaryHooks,
  visualJourneyName,
} from '../../e2e/visual/summaryHooks';

jest.mock('@playwright/test', () => ({
  chromium: { launchPersistentContext: jest.fn() },
  expect: jest.fn(),
}));
jest.mock('../../e2e/harness/launch', () => ({
  launchExtension: jest.fn(),
}));

describe('journey summary completion', () => {
  let written: any;
  let files: Map<string, any>;

  beforeEach(() => {
    jest.clearAllMocks();
    files = new Map();
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    jest.spyOn(fs, 'writeFileSync').mockImplementation((file, data) => {
      written = JSON.parse(String(data));
      files.set(String(file), written);
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('starts running, never passed before an explicit successful finish', () => {
    const summary = new JourneySummary('synthetic');
    expect(written).toMatchObject({ status: 'running', steps: [] });
    expect(written.endedAt).toBeUndefined();
    summary.addStep({ name: 'check', durationMs: 1, status: 'passed' });
    expect(written.status).toBe('running');
    summary.finish('passed');
    expect(written.status).toBe('passed');
    expect(written.endedAt).toEqual(expect.any(String));
  });

  it('keeps a failed step failed even if cleanup requests a successful finish', () => {
    const summary = new JourneySummary('synthetic');
    summary.addStep({ name: 'check', durationMs: 1, status: 'failed' });
    summary.finish('passed');
    expect(written.status).toBe('failed');
    expect(written.endedAt).toEqual(expect.any(String));
  });

  it('does not infer success from a finish without a status', () => {
    const summary = new JourneySummary('synthetic');
    summary.finish();
    expect(written.status).toBe('failed');
  });

  it('records a launch rejection before a wallet exists and preserves the error', async () => {
    const error = new Error('Synthetic Chromium startup failure');
    (launchExtension as jest.Mock).mockRejectedValueOnce(error);
    await expect(PaliWallet.launch('synthetic')).rejects.toBe(error);
    expect(written.status).toBe('failed');
    expect(written.endedAt).toEqual(expect.any(String));
    expect(written.steps).toEqual([
      expect.objectContaining({
        name: 'launch extension',
        note: error.message,
        status: 'failed',
      }),
    ]);
  });

  it('closes a returned context if app readiness fails before a wallet is returned', async () => {
    const error = new Error('Synthetic app readiness failure');
    const page = { goto: jest.fn().mockRejectedValue(error) };
    const context = {
      pages: () => [page],
      close: jest.fn().mockResolvedValue(undefined),
    };
    (launchExtension as jest.Mock).mockResolvedValueOnce({
      context,
      extensionId: 'synthetic',
    });
    await expect(PaliWallet.launch('synthetic')).rejects.toBe(error);
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(written.status).toBe('failed');
    expect(written.endedAt).toEqual(expect.any(String));
  });

  it('bounds service-worker startup and closes the context if that wait fails', async () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    const error = new Error('Synthetic service-worker timeout');
    const context = {
      serviceWorkers: () => [],
      waitForEvent: jest.fn().mockRejectedValue(error),
      close: jest.fn().mockResolvedValue(undefined),
    };
    (chromium.launchPersistentContext as jest.Mock).mockResolvedValueOnce(
      context
    );
    const actual = jest.requireActual('../../e2e/harness/launch');
    await expect(actual.launchExtension('synthetic')).rejects.toBe(error);
    expect(context.waitForEvent).toHaveBeenCalledWith('serviceworker', {
      timeout: 30_000,
    });
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('renders only completed successful summaries as passed', () => {
    const passed = {
      status: 'passed',
      endedAt: '2026-10-15T00:00:00.000Z',
      steps: [{ status: 'passed' }],
    };
    expect(summaryReportIcon(passed)).toBe('✅');
    expect(summaryReportIcon({ ...passed, endedAt: undefined })).toBe('❌');
    expect(summaryReportIcon({ ...passed, endedAt: 'invalid' })).toBe('❌');
    expect(
      summaryReportIcon({ ...passed, steps: [{ status: 'failed' }] })
    ).toBe('❌');
    expect(summaryReportIcon({ status: 'running', steps: [] })).toBe('⏳');
  });

  async function finishVisual(outcomes: string[]) {
    const summary = new JourneySummary('visual');
    const context = { close: jest.fn().mockResolvedValue(undefined) };
    const wallet = {
      summary,
      dispose: (status: 'passed' | 'failed') =>
        PaliWallet.prototype.dispose.call({ summary, context }, status),
    };
    const hooks: Record<string, (...args: any[]) => any> = {};
    const suite = {
      afterEach: (hook: (...args: any[]) => any) => {
        hooks.afterEach = hook;
      },
      afterAll: (hook: (...args: any[]) => any) => {
        hooks.afterAll = hook;
      },
    } as Parameters<typeof registerVisualSummaryHooks>[0];
    registerVisualSummaryHooks(suite, () => wallet);
    for (const status of outcomes) {
      await hooks.afterEach({}, { title: 'screen', duration: 1, status });
    }
    await hooks.afterAll();
    expect(context.close).toHaveBeenCalledTimes(1);
  }

  it('finishes successful visual test outcomes with an explicit pass', async () => {
    await finishVisual(['passed', 'passed']);
    expect(written.status).toBe('passed');
    expect(written.steps).toHaveLength(2);
    expect(summaryReportIcon(written)).toBe('✅');
  });

  it.each(['failed', 'timedOut', 'interrupted', 'skipped'])(
    'does not hide a visual %s outcome behind successful cleanup',
    async (status) => {
      await finishVisual([status, 'passed']);
      expect(written.status).toBe('failed');
      expect(summaryReportIcon(written)).toBe('❌');
    }
  );

  it('does not report a visual setup with no completed tests as passed', async () => {
    await finishVisual([]);
    expect(written.status).toBe('failed');
  });

  it('preserves a failed visual summary when a later worker succeeds', () => {
    const failed = new JourneySummary(visualJourneyName(0));
    failed.addStep({ name: 'screen', durationMs: 1, status: 'failed' });
    failed.finish('failed');
    const restarted = new JourneySummary(visualJourneyName(1));
    restarted.addStep({ name: 'next screen', durationMs: 1, status: 'passed' });
    restarted.finish('passed');
    expect(failed.filePath).not.toBe(restarted.filePath);
    expect(files.get(failed.filePath).status).toBe('failed');
    expect(files.get(restarted.filePath).status).toBe('passed');
    expect(summaryReportIcon(files.get(failed.filePath))).toBe('❌');
  });
});
