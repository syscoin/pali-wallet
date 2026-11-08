import type {
  TrezorHost,
  TrezorHostCalls,
} from '@sidhujag/sysweb3-keyring/cjs/trezor/host-types.js';
import { DAPP_REQUEST_LIMITS } from '../../../../source/utils/requestPayloadBudget.ts';
import {
  NATIVE_TREZOR_HANDOFF_METHODS,
  type NativeTrezorHandoff,
  type NativeTrezorHandoffCall,
  type NativeTrezorHandoffInvocation,
  type NativeTrezorHandoffMethod,
  type NativeTrezorResponse,
} from './trezorHandoff.ts';

const CONNECT_ORIGIN = 'https://connect.trezor.io';
const CONNECT_PATH = '/10/deeplink/1/';
const MANIFEST = Object.freeze({
  appName: 'Pali Wallet',
  appUrl: 'https://paliwallet.com/',
  email: 'support@syscoin.org',
});

/** One fresh official Connect instance per public device request. */
export type NativeTrezorClient = {
  init(settings: {
    manifest: typeof MANIFEST;
    connectSrc: string;
    deeplinkCallbackUrl: string;
    deeplinkOpen(url: string): void;
  }): Promise<void>;
  call(params: Record<string, unknown>): Promise<unknown>;
  cancel(): void;
  dispose(): Promise<unknown>;
};
export type NativeTrezorHostOptions = Readonly<{
  handoff: NativeTrezorHandoff;
  invocation: NativeTrezorHandoffInvocation;
  assertCurrent(): void;
  loadClient(): Promise<NativeTrezorClient>;
  openURL(url: string): Promise<unknown>;
}>;

const cancelled = () =>
  Object.assign(new Error('Trezor operation cancelled'), {
    code: 'Method_Interrupted',
  });
const invalid = () =>
  Object.assign(new Error('Invalid Trezor dispatch'), {
    code: 'TREZOR_HANDOFF_INVALID',
  });
const checkGuard = (guard: () => void) => {
  const result: unknown = guard();
  if (result !== undefined) {
    void Promise.resolve(result).catch(() => undefined);
    throw cancelled();
  }
};

/** Bind only the exact callback generated for this bounded, public SDK request. */
function requestId(
  urlText: string,
  dispatch: NonNullable<NativeTrezorHandoffCall['dispatch']>
): string {
  if (
    typeof urlText !== 'string' ||
    urlText.length > DAPP_REQUEST_LIMITS.bytes * 3 + 2048 ||
    !/^[\x21-\x7e]+$/.test(urlText)
  )
    throw invalid();
  const url = new URL(urlText);
  if (
    url.origin !== CONNECT_ORIGIN ||
    url.pathname !== CONNECT_PATH ||
    url.hash ||
    url.username ||
    url.password
  )
    throw invalid();
  const keys = [...url.searchParams.keys()];
  if (
    keys.length !== 4 ||
    new Set(keys).size !== keys.length ||
    !['method', 'params', 'callback', 'appName'].every((key) =>
      keys.includes(key)
    ) ||
    url.searchParams.get('method') !== dispatch.method ||
    url.searchParams.get('appName') !== MANIFEST.appName ||
    url.searchParams.get('params') !== JSON.stringify(dispatch.params)
  )
    throw invalid();
  const callback = new URL(url.searchParams.get('callback')!);
  const id = callback.searchParams.get('id');
  if (
    callback.protocol !== 'pali:' ||
    callback.host !== 'trezor-callback' ||
    callback.username ||
    callback.password ||
    callback.hash ||
    callback.pathname !== new URL(dispatch.callbackUrl).pathname ||
    [...callback.searchParams].length !== 1 ||
    typeof id !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(id)
  )
    throw invalid();
  return id;
}

type Work = {
  abort(): void;
  client?: NativeTrezorClient;
  vendor?: Promise<unknown>;
  opening?: Promise<unknown>;
  result: Promise<NativeTrezorResponse>;
};

/** A host holds a guard only while its SDK invocation is active. It never owns custody. */
export function createNativeTrezorHost(options: NativeTrezorHostOptions): {
  host: TrezorHost;
  revoke(): void;
} {
  const { handoff, invocation, loadClient, openURL } = options;
  let ownerGuard: (() => void) | undefined = options.assertCurrent;
  let cleanupFailed = false;
  let cleanupFailure: unknown;
  let initialized = false;
  let disposal: Promise<void> | undefined;
  const work = new Set<Work>();
  const check = (sdkGuard: () => void) => {
    if (!ownerGuard) throw cancelled();
    checkGuard(ownerGuard);
    checkGuard(sdkGuard);
    if (!ownerGuard) throw cancelled();
  };
  const revoke = () => {
    ownerGuard = undefined;
    initialized = false;
    for (const active of work) active.abort();
  };
  const run = (
    method: NativeTrezorHandoffMethod,
    sdkGuard: () => void,
    args: unknown[]
  ) => {
    check(sdkGuard);
    if (!initialized) throw cancelled();
    if (args.length !== 1 && !(method === 'getFeatures' && args.length === 0))
      throw invalid();
    const guard = () => check(sdkGuard);
    const prepared = handoff.request(
      invocation,
      method,
      args.length === 0 ? {} : args[0],
      guard
    );
    let rejectAbort!: (error: Error) => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject;
    });
    void aborted.catch(() => undefined);
    const active: Work = {
      abort: () => rejectAbort(cancelled()),
      result: Promise.resolve()
        .then(async () => {
          try {
            guard();
            let vendorFailure: Promise<never> | undefined;
            if (prepared.dispatch) {
              const dispatch = prepared.dispatch;
              const client = await loadClient();
              active.client = client;
              guard();
              let dispatched = false;
              await client.init({
                manifest: MANIFEST,
                connectSrc: CONNECT_ORIGIN + '/10/',
                deeplinkCallbackUrl: dispatch.callbackUrl,
                deeplinkOpen(url) {
                  guard();
                  if (dispatched) throw invalid();
                  handoff.bindRequestId(
                    invocation,
                    requestId(url, dispatch),
                    guard
                  );
                  dispatched = true;
                  active.opening = Promise.resolve().then(() => {
                    guard();
                    return openURL(url);
                  });
                  void active.opening.catch(() => undefined);
                },
              });
              guard();
              active.vendor = Promise.resolve(
                client.call({ ...dispatch.params, method })
              );
              // The public result comes only from our bounded callback parser.
              void active.vendor.catch(() => undefined);
              vendorFailure = active.vendor.then(
                () => new Promise<never>(() => undefined),
                (error) => Promise.reject(error)
              );
              void vendorFailure.catch(() => undefined);
              if (!dispatched || !active.opening) throw invalid();
              await Promise.race([active.opening, aborted]);
            }
            const response = await Promise.race([
              prepared.result,
              aborted,
              ...(vendorFailure ? [vendorFailure] : []),
            ]);
            guard();
            return response;
          } finally {
            // Connect's dispose does not settle its deferred call; cancel first.
            const cleanup = Promise.allSettled([
              Promise.resolve().then(() => active.client?.cancel()),
              Promise.resolve().then(() => active.client?.dispose()),
            ]).then((results) => {
              const failed = results.find(
                (result) => result.status === 'rejected'
              );
              if (failed?.status === 'rejected') {
                cleanupFailed = true;
                cleanupFailure = failed.reason;
                throw failed.reason;
              }
            });
            const results = await Promise.allSettled([
              cleanup,
              active.vendor,
              active.opening,
            ]);
            const failed = results.find(
              (result) => result.status === 'rejected'
            );
            if (failed?.status === 'rejected') throw failed.reason;
          }
        })
        .finally(() => {
          work.delete(active);
        }),
    };
    work.add(active);
    void active.result.catch(() => undefined);
    return active.result;
  };
  const calls = Object.fromEntries(
    NATIVE_TREZOR_HANDOFF_METHODS.map((method) => [
      method,
      (guard: () => void, ...args: unknown[]) => run(method, guard, args),
    ])
  ) as Pick<TrezorHostCalls, NativeTrezorHandoffMethod>;
  const unsupported = () => {
    throw Object.assign(new Error('Trezor method unavailable on mobile'), {
      code: 'Method_NotAllowed',
    });
  };
  const methods = {
    ...calls,
    signMessage: unsupported,
    ethereumSignMessage: unsupported,
    ethereumSignTypedData: unsupported,
    verifyMessage: unsupported,
    ethereumVerifyMessage: unsupported,
  } as TrezorHostCalls;
  return {
    revoke,
    host: {
      ...methods,
      async init(sdkGuard) {
        check(sdkGuard);
        initialized = true;
      },
      dispose(pendingCalls) {
        revoke();
        disposal ??= Promise.allSettled(
          [...work].map((active) => active.result)
        ).then(() => {
          // A rejected SDK operation is not a failed resource drain.
          if (cleanupFailed) throw cleanupFailure;
        });
        return Promise.allSettled([disposal, ...pendingCalls]).then(
          (results) => {
            const first = results[0];
            if (first?.status === 'rejected') throw first.reason;
          }
        );
      },
    },
  };
}
