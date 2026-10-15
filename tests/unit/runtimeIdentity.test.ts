import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import fs from 'fs';

import { verifyExecutingWorker } from '../../e2e/harness/runtimeIdentity';

const extensionId = 'a'.repeat(32);
const workerUrl = `chrome-extension://${extensionId}/js/background.bundle.js`;
const current = '/* synthetic current worker π */';
const digest = (source: string) => ({
  sha256: createHash('sha256').update(source).digest('hex'),
  bytes: Buffer.byteLength(source),
});

function setup(
  source = current,
  mode:
    | 'immediate'
    | 'delayed'
    | 'missing'
    | 'malformed'
    | 'attach timeout'
    | 'source timeout' = 'immediate'
) {
  // A fresh manifest alone must not accept a stale worker.
  const manifest =
    '{"version":"4.0.93","background":{"service_worker":"js/background.bundle.js"}}';
  jest.spyOn(fs, 'lstatSync').mockImplementation(((file: string) => ({
    size: Buffer.byteLength(
      file.endsWith('manifest.json') ? manifest : current
    ),
    isFile: () => true,
    isSymbolicLink: () => false,
  })) as any);
  jest
    .spyOn(fs, 'readFileSync')
    .mockImplementation(((file: string) =>
      file.endsWith('manifest.json') ? manifest : Buffer.from(current)) as any);
  const cdp = Object.assign(new EventEmitter(), {
    send: jest.fn(),
    detach: jest.fn().mockResolvedValue(undefined),
  });
  const emit = (message: unknown) =>
    cdp.emit('Target.receivedMessageFromTarget', {
      sessionId: 'worker-session',
      message: JSON.stringify(message),
    });
  const parsed = () =>
    emit({
      method: 'Debugger.scriptParsed',
      params: { url: workerUrl, scriptId: 'script-1' },
    });
  cdp.send.mockImplementation(async (method: string, params: any) => {
    if (method === 'Target.getTargets')
      return {
        targetInfos: [
          { type: 'service_worker', url: workerUrl, targetId: 'worker-1' },
        ],
      };
    if (method === 'Target.attachToTarget')
      return mode === 'attach timeout'
        ? new Promise(() => undefined)
        : { sessionId: 'worker-session' };
    if (method === 'Target.detachFromTarget') return {};
    if (method !== 'Target.sendMessageToTarget')
      throw new Error('Unexpected CDP command');
    const message = JSON.parse(params.message);
    if (message.method === 'Debugger.enable') {
      emit({ id: message.id, result: {} });
      if (['immediate', 'source timeout', 'malformed'].includes(mode)) parsed();
      if (mode === 'malformed')
        cdp.emit('Target.receivedMessageFromTarget', {
          sessionId: 'worker-session',
          message: '{invalid JSON',
        });
    } else if (message.method === 'Debugger.getScriptSource') {
      if (mode !== 'source timeout')
        emit({ id: message.id, result: { scriptSource: source } });
    } else throw new Error('Only read-only debugger commands are allowed');
    return {};
  });
  const context = {
    browser: () => ({ newBrowserCDPSession: jest.fn().mockResolvedValue(cdp) }),
  } as any;
  const record = jest.fn();
  return {
    cdp,
    parsed,
    record,
    run: () =>
      verifyExecutingWorker(context, extensionId, '/synthetic-build', record),
  };
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('accepts the exact executing source and records only its hash and byte count', async () => {
  const { run, record, cdp } = setup();
  await expect(run()).resolves.toEqual({
    actual: digest(current),
    disk: digest(current),
    matched: true,
  });
  expect(record).toHaveBeenCalledWith({
    actual: digest(current),
    disk: digest(current),
    matched: true,
  });
  expect(JSON.stringify(record.mock.calls)).not.toContain(current);
  expect(cdp.send).toHaveBeenCalledWith('Target.attachToTarget', {
    targetId: 'worker-1',
    flatten: false,
  });
  expect(cdp.send).toHaveBeenCalledWith('Target.detachFromTarget', {
    sessionId: 'worker-session',
  });
  expect(cdp.detach).toHaveBeenCalledTimes(1);
  expect(cdp.listenerCount('Target.receivedMessageFromTarget')).toBe(0);
});

it('refuses a cached worker despite a fresh disk manifest and records the mismatch first', async () => {
  const stale = '/* synthetic stale worker */';
  const { run, record, cdp } = setup(stale);
  await expect(run()).rejects.toThrow('executing source does not match disk');
  expect(record).toHaveBeenCalledWith({
    actual: digest(stale),
    disk: digest(current),
    matched: false,
  });
  expect(JSON.stringify(record.mock.calls)).not.toContain(stale);
  expect(cdp.detach).toHaveBeenCalledTimes(1);
});

it('awaits a scriptParsed event arriving after Debugger.enable resolves', async () => {
  const { run, parsed, cdp } = setup(current, 'delayed');
  let completed = false;
  const pending = run().then(() => {
    completed = true;
  });
  await new Promise(setImmediate);
  expect(completed).toBe(false);
  expect(
    cdp.send.mock.calls.some(([, params]) =>
      params?.message?.includes('Debugger.enable')
    )
  ).toBe(true);
  expect(
    cdp.send.mock.calls.some(([, params]) =>
      params?.message?.includes('Debugger.getScriptSource')
    )
  ).toBe(false);
  parsed();
  await pending;
  expect(completed).toBe(true);
  expect(cdp.detach).toHaveBeenCalledTimes(1);
});

it('keeps a malformed-event refusal sticky between enable and the source read', async () => {
  const { run, cdp, record } = setup(current, 'malformed');
  await expect(run()).rejects.toThrow('read refused or timed out');
  expect(record).not.toHaveBeenCalled();
  expect(cdp.detach).toHaveBeenCalledTimes(1);
});

it.each(['missing', 'attach timeout', 'source timeout'] as const)(
  'bounds %s and detaches without reloading or wallet evaluation',
  async (mode) => {
    jest.useFakeTimers();
    const { run, cdp, record } = setup(current, mode);
    const refused = expect(run()).rejects.toThrow('read refused or timed out');
    await jest.advanceTimersByTimeAsync(15000);
    await refused;
    expect(record).not.toHaveBeenCalled();
    expect(cdp.detach).toHaveBeenCalledTimes(1);
    expect(cdp.listenerCount('Target.receivedMessageFromTarget')).toBe(0);
    if (mode !== 'attach timeout')
      expect(cdp.send).toHaveBeenCalledWith('Target.detachFromTarget', {
        sessionId: 'worker-session',
      });
    for (const [method, params] of cdp.send.mock.calls) {
      expect([
        'Target.getTargets',
        'Target.attachToTarget',
        'Target.sendMessageToTarget',
        'Target.detachFromTarget',
      ]).toContain(method);
      if (method === 'Target.sendMessageToTarget')
        expect(['Debugger.enable', 'Debugger.getScriptSource']).toContain(
          JSON.parse(params.message).method
        );
    }
  }
);
