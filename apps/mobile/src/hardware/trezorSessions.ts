import type { TrezorHost } from '@sidhujag/sysweb3-keyring/cjs/trezor/host-types.js';
import {
  NativeTrezorHandoff,
  type NativeTrezorHandoffOwner,
  type NativeTrezorHandoffJob,
  type NativeTrezorHandoffSnapshot,
} from './trezorHandoff.ts';
import {
  createNativeTrezorHost,
  type NativeTrezorClient,
} from './trezorHost.ts';

export type NativeTrezorSession = Readonly<{
  job: NativeTrezorHandoffJob;
  host: TrezorHost;
  /** Only drain the old SDK worker; never await this service from this callback. */
  retire(retireSdk: () => Promise<void>): Promise<void>;
  finish(): Promise<void>;
  cancel(): Promise<void>;
}>;
type Admission = Readonly<{
  owner: NativeTrezorHandoffOwner;
  sessionGeneration: number;
  assertCurrent(): void;
}>;
export type NativeTrezorSessions = Readonly<{
  /** Call once after each successful real unlock, not on a resume button press. */
  advanceSessionGeneration(): number;
  start(
    request: Admission & { workflow: 'import' | 'send'; expiresAt: number }
  ): NativeTrezorSession;
  resume(
    request: Admission & { job: NativeTrezorHandoffJob; accepted: true }
  ): NativeTrezorSession;
  getSnapshot():
    | (NativeTrezorHandoffSnapshot & { job: NativeTrezorHandoffJob })
    | null;
  subscribe(listener: () => void): () => void;
  receiveCallback(url: unknown): boolean;
  cancel(job: NativeTrezorHandoffJob): Promise<void>;
  dispose(): Promise<void>;
}>;

/** Process-owned public transport correlation survives lock; SDK workers do not. */
export function createTrezorSessions(
  options: Readonly<{
    randomBytes(length: number): Uint8Array;
    now?: () => number;
    loadClient(): Promise<NativeTrezorClient>;
    openURL(url: string): Promise<unknown>;
  }>
): NativeTrezorSessions {
  let generation = 0;
  const hosts = new Map<
    NativeTrezorHandoffJob,
    Set<ReturnType<typeof createNativeTrezorHost>>
  >();
  const handoff = new NativeTrezorHandoff({
    randomBytes: options.randomBytes,
    now: options.now,
    async retireTransport(job) {
      const owned = hosts.get(job);
      hosts.delete(job);
      const results = await Promise.allSettled(
        [...(owned ?? [])].map((value) => value.host.dispose([]))
      );
      const failure = results.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
    },
  });
  const session = (
    tokens: {
      job: NativeTrezorHandoffJob;
      invocation: Parameters<NativeTrezorHandoff['finish']>[0];
    },
    assertCurrent: () => void
  ): NativeTrezorSession => {
    let currentGuard: (() => void) | undefined = assertCurrent;
    const check = () => {
      if (!currentGuard)
        throw Object.assign(new Error('Trezor operation cancelled'), {
          code: 'Method_Interrupted',
        });
      const result: unknown = currentGuard();
      if (result !== undefined) {
        void Promise.resolve(result).catch(() => undefined);
        throw new Error('Invalid Trezor session guard');
      }
    };
    const owned = createNativeTrezorHost({
      ...options,
      handoff,
      invocation: tokens.invocation,
      assertCurrent: check,
    });
    const set = hosts.get(tokens.job) ?? new Set();
    set.add(owned);
    hosts.set(tokens.job, set);
    let retirement: Promise<void> | undefined;
    return Object.freeze({
      job: tokens.job,
      host: owned.host,
      retire(retireSdk) {
        currentGuard = undefined;
        owned.revoke();
        if (!retirement) {
          let draining: Promise<void> | undefined;
          const drain = () =>
            (draining ??= Promise.allSettled([
              owned.host.dispose([]),
              Promise.resolve().then(retireSdk),
            ]).then((results) => {
              set.delete(owned);
              const failure = results.find(
                (result) => result.status === 'rejected'
              );
              if (failure?.status === 'rejected') throw failure.reason;
            }));
          // Expiry/cancellation has already retired the public invocation. Wait
          // for its cleanup instead of treating its absence as a drain failure.
          const retire = handoff.getSnapshot()?.job === tokens.job
            ? handoff.retireInvocation(tokens.invocation, drain)
            : handoff.cancel(tokens.job);
          retirement = Promise.allSettled([retire, drain()]).then((results) => {
            const failure = results.find(
              (result) => result.status === 'rejected'
            );
            if (failure?.status === 'rejected') throw failure.reason;
          });
        }
        return retirement;
      },
      finish() {
        const closing = handoff.finish(tokens.invocation, check);
        currentGuard = undefined;
        owned.revoke();
        return closing;
      },
      cancel: () => {
        currentGuard = undefined;
        return handoff.cancel(tokens.job);
      },
    });
  };
  return Object.freeze({
    advanceSessionGeneration() {
      if (generation === Number.MAX_SAFE_INTEGER)
        throw new Error('Trezor session generation exhausted');
      return ++generation;
    },
    start(request) {
      if (request.sessionGeneration !== generation || generation === 0)
        throw new Error('Invalid Trezor session generation');
      const tokens = handoff.begin(
        request.owner,
        request.workflow,
        request.expiresAt,
        request
      );
      return session(tokens, request.assertCurrent);
    },
    resume(request) {
      if (request.sessionGeneration !== generation || generation === 0)
        throw new Error('Invalid Trezor session generation');
      return session(
        {
          job: request.job,
          invocation: handoff.acceptFresh(request.job, request.owner, request),
        },
        request.assertCurrent
      );
    },
    getSnapshot() {
      return handoff.getSnapshot();
    },
    subscribe: handoff.subscribe,
    receiveCallback: (url) => handoff.receiveCallback(url),
    cancel: (job) => handoff.cancel(job),
    dispose: () => handoff.dispose(),
  });
}
