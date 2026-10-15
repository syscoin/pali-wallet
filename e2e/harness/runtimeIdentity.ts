import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import type { BrowserContext } from '@playwright/test';

export type WorkerSourceIdentity = { bytes: number; sha256: string };
export type WorkerIdentityObservation = {
  actual: WorkerSourceIdentity;
  disk: WorkerSourceIdentity;
  matched: boolean;
};

const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const WORKER_PATH = 'js/background.bundle.js';
const identity = (source: string | Buffer): WorkerSourceIdentity => ({
  bytes: Buffer.byteLength(source),
  sha256: createHash('sha256').update(source).digest('hex'),
});
const failure = (tag: string) => new Error(`Executing worker identity: ${tag}`);

async function bounded<T>(work: Promise<T>, ms: number, tag: string) {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(failure(tag)), Math.max(1, ms));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Adapted from the reviewed async runtimeHash observer. This only attaches a
// debugger, reads the exact worker source and detaches: never evaluate/reload.
async function executingIdentity(context: BrowserContext, workerUrl: string) {
  const deadline = Date.now() + 15000;
  const remaining = () => Math.max(1, deadline - Date.now());
  const browser = context.browser();
  if (!browser) throw failure('browser unavailable');
  const cdp = await bounded(
    browser.newBrowserCDPSession(),
    remaining(),
    'CDP attach timeout'
  ).catch(() => {
    throw failure('CDP attach refused or timed out');
  });
  let sessionId: string | undefined;
  let receive: ((event: any) => void) | undefined;
  let firstTimer: ReturnType<typeof setTimeout>;
  let next = 0,
    events = 0;
  let terminalError: Error | undefined;
  const pending = new Map<
    number,
    {
      reject: (error: Error) => void;
      resolve: (value: any) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let firstResolve!: (id: string) => void;
  let firstReject!: (error: Error) => void;
  const firstScript = new Promise<string>((resolve, reject) => {
    firstResolve = resolve;
    firstReject = reject;
  });
  firstScript.catch(() => undefined);
  const refuse = (tag: string) => {
    const error = (terminalError ??= failure(tag));
    firstReject(error);
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  };
  const send = (method: string, params = {}) =>
    new Promise<any>((resolve, reject) => {
      if (terminalError) {
        reject(terminalError);
        return;
      }
      const id = ++next;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(failure('CDP command timeout'));
      }, remaining());
      pending.set(id, { resolve, reject, timer });
      cdp
        .send('Target.sendMessageToTarget', {
          sessionId,
          message: JSON.stringify({ id, method, params }),
        })
        .catch(() => refuse('CDP command refused'));
    });
  try {
    const { targetInfos } = await bounded(
      cdp.send('Target.getTargets'),
      remaining(),
      'target discovery timeout'
    );
    const targets = targetInfos.filter(
      (target) => target.type === 'service_worker' && target.url === workerUrl
    );
    if (targets.length !== 1) throw failure('expected one exact worker');
    sessionId = (
      await bounded(
        cdp.send('Target.attachToTarget', {
          targetId: targets[0].targetId,
          flatten: false,
        }),
        remaining(),
        'worker attach timeout'
      )
    ).sessionId;
    receive = (event) => {
      if (event.sessionId !== sessionId) return;
      let message: any;
      try {
        message = JSON.parse(event.message);
      } catch {
        refuse('invalid CDP message');
        return;
      }
      if (!message || typeof message !== 'object') {
        refuse('invalid CDP message');
        return;
      }
      if (
        message.method === 'Debugger.scriptParsed' &&
        message.params?.url === workerUrl
      ) {
        events++;
        const id = message.params.scriptId;
        if (events !== 1 || typeof id !== 'string' || !id || id.length > 128) {
          refuse('expected one exact script');
          return;
        }
        firstResolve(id);
      }
      if (pending.has(message.id)) {
        const item = pending.get(message.id)!;
        pending.delete(message.id);
        clearTimeout(item.timer);
        if (message.error) item.reject(failure('CDP response refused'));
        else item.resolve(message.result);
      }
    };
    cdp.on('Target.receivedMessageFromTarget', receive);
    firstTimer = setTimeout(
      () => refuse('script discovery timeout'),
      remaining()
    );
    await send('Debugger.enable');
    // The event can arrive after Debugger.enable resolves; no immediate count assertion.
    const scriptId = await firstScript;
    const result = await send('Debugger.getScriptSource', { scriptId });
    if (terminalError) throw terminalError;
    if (events !== 1) throw failure('expected one exact script');
    if (
      typeof result?.scriptSource !== 'string' ||
      !result.scriptSource.length ||
      Buffer.byteLength(result.scriptSource) > MAX_SOURCE_BYTES
    )
      throw failure('source size refused');
    return identity(result.scriptSource);
  } catch {
    // Never propagate source text or arbitrary protocol messages to reports.
    throw failure('read refused or timed out');
  } finally {
    clearTimeout(firstTimer);
    if (receive) cdp.off('Target.receivedMessageFromTarget', receive);
    refuse('reader closed');
    if (sessionId)
      await bounded(
        cdp.send('Target.detachFromTarget', { sessionId }),
        1000,
        'worker detach timeout'
      ).catch(() => undefined);
    await bounded(cdp.detach(), 1000, 'CDP detach timeout').catch(() => {
      throw failure('CDP detach refused or timed out');
    });
  }
}

function diskIdentity(extensionPath: string) {
  const manifestPath = path.join(extensionPath, 'manifest.json');
  if (fs.lstatSync(manifestPath).size > 1024 * 1024)
    throw failure('manifest size refused');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.background?.service_worker !== WORKER_PATH)
    throw failure('manifest worker refused');
  const file = path.join(extensionPath, WORKER_PATH);
  const stat = fs.lstatSync(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size <= 0 ||
    stat.size > MAX_SOURCE_BYTES
  )
    throw failure('disk source refused');
  const source = fs.readFileSync(file);
  if (source.length !== stat.size) throw failure('disk source changed');
  return identity(source);
}

export async function verifyExecutingWorker(
  context: BrowserContext,
  extensionId: string,
  extensionPath: string,
  record: (value: WorkerIdentityObservation) => void
) {
  if (!/^[a-p]{32}$/.test(extensionId)) throw failure('extension id refused');
  const disk = diskIdentity(extensionPath);
  const actual = await executingIdentity(
    context,
    `chrome-extension://${extensionId}/${WORKER_PATH}`
  );
  const closingDisk = diskIdentity(extensionPath);
  const matched =
    actual.sha256 === disk.sha256 &&
    actual.bytes === disk.bytes &&
    closingDisk.sha256 === disk.sha256 &&
    closingDisk.bytes === disk.bytes;
  const observation = { actual, disk, matched };
  record(observation); // Retain actual hash/bytes before any equality refusal.
  if (!matched) throw failure('executing source does not match disk');
  return observation;
}
