import { chromium } from '@playwright/test';
import fs from 'fs';

import { launchExtension } from '../../e2e/harness/launch';
import { PaliWallet } from '../../e2e/harness/pali';
import { JourneySummary } from '../../e2e/harness/summary';
import { summaryReportIcon } from '../../e2e/scripts/summary-status.cjs';

jest.mock('@playwright/test', () => ({
  chromium: { launchPersistentContext: jest.fn() },
  expect: jest.fn(),
}));
jest.mock('../../e2e/harness/launch', () => ({
  launchExtension: jest.fn(),
}));

describe('journey summary completion', () => {
  let written: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    jest.spyOn(fs, 'writeFileSync').mockImplementation((_, data) => {
      written = JSON.parse(String(data));
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
});
