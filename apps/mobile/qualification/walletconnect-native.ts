import {
  openWalletConnectTransport,
  type WalletConnectSdk,
} from '../src/connections/walletConnect.ts';
import type { NativeConnectionRepository } from '../src/connections/storage.ts';
import type { HttpBuild, HttpLaunch } from './http-contract.ts';
import {
  assertWalletConnectAudit,
  type WalletConnectAudit,
  type WalletConnectReport,
} from './walletconnect-contract.ts';

const SUBSTAGES = ['init', 'pair', 'request', 'close'] as const;
const INITIALIZATION_STAGES = [
  'sdk-import',
  'transport-open',
  'core-create',
  'core-ready',
  'client-init',
  'client-ready',
] as const;
const ERROR_NAMES = [
  'Error',
  'TypeError',
  'ReferenceError',
  'RangeError',
  'SyntaxError',
  'AbortError',
  'TimeoutError',
  'WalletConnectTransportError',
  'UnknownError',
] as const;
const ERROR_CODES = [
  'CONNECTION_UNAVAILABLE',
  'WALLETCONNECT_NATIVE_TIMEOUT',
  'WALLETCONNECT_NATIVE_QUALIFICATION_FAILED',
  'WALLETCONNECT_NATIVE_AUDIT_FAILED',
  'WALLETCONNECT_NATIVE_STATUS_HTTP',
  'WALLETCONNECT_NATIVE_OWNER_REVOKED',
  'WALLETCONNECT_NATIVE_PENDING_OPEN',
  'WALLETCONNECT_NATIVE_ABORT_ACCEPTED',
  'WALLETCONNECT_NATIVE_PAIR_REJECTED',
  'WALLETCONNECT_NATIVE_DISPOSAL_SIGNAL',
  'WALLETCONNECT_NATIVE_DISPOSAL_LISTENERS',
  'WALLETCONNECT_NATIVE_AUDIT_CHANGED',
  'QUALIFICATION_NETWORK_FORBIDDEN',
  'NATIVE_CONNECTION_UNAVAILABLE',
  'UNCLASSIFIED',
] as const;
const COUNT_KEYS = [
  'opened',
  'closed',
  'pending',
  'pendingClosed',
  'frames',
  'invalid',
] as const;

type ErrorDiagnostic = Readonly<{
  errorName: (typeof ERROR_NAMES)[number];
  errorCode: (typeof ERROR_CODES)[number];
}>;
type InitializationDiagnostic = Readonly<{
  stage: (typeof INITIALIZATION_STAGES)[number];
  errorName?: ErrorDiagnostic['errorName'];
  errorCode?: ErrorDiagnostic['errorCode'];
}>;
export type WalletConnectQualificationDiagnostic = ErrorDiagnostic & Readonly<{
  substage: (typeof SUBSTAGES)[number];
  counts?: WalletConnectAudit;
  initialization?: InitializationDiagnostic;
}>;

function ownField(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function validCounts(value: unknown): value is WalletConnectAudit {
  return (
    !!value &&
    typeof value === 'object' &&
    Object.keys(value).sort().join(',') === [...COUNT_KEYS].sort().join(',') &&
    COUNT_KEYS.every((key) => {
      const count = ownField(value, key);
      return (
        typeof count === 'number' &&
        Number.isSafeInteger(count) &&
        count >= 0 &&
        count <= 100000
      );
    })
  );
}

function validInitialization(value: unknown): value is InitializationDiagnostic {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const name = ownField(value, 'errorName');
  const code = ownField(value, 'errorCode');
  const keys = name === undefined && code === undefined
    ? ['stage']
    : ['errorCode', 'errorName', 'stage'];
  return Object.keys(value).sort().join(',') === keys.join(',') &&
    (INITIALIZATION_STAGES as readonly unknown[]).includes(ownField(value, 'stage')) &&
    (keys.length === 1 || (
      (ERROR_NAMES as readonly unknown[]).includes(name) &&
      (ERROR_CODES as readonly unknown[]).includes(code)
    ));
}

export function isWalletConnectQualificationDiagnostic(
  value: unknown
): value is WalletConnectQualificationDiagnostic {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const counts = ownField(value, 'counts');
  const initialization = ownField(value, 'initialization');
  const keys = ['errorCode', 'errorName', 'substage',
    ...(counts === undefined ? [] : ['counts']),
    ...(initialization === undefined ? [] : ['initialization']),
  ].sort();
  return (
    Object.keys(value).sort().join(',') === keys.join(',') &&
    (SUBSTAGES as readonly unknown[]).includes(ownField(value, 'substage')) &&
    (ERROR_NAMES as readonly unknown[]).includes(
      ownField(value, 'errorName')
    ) &&
    (ERROR_CODES as readonly unknown[]).includes(
      ownField(value, 'errorCode')
    ) &&
    (counts === undefined || validCounts(counts)) &&
    (initialization === undefined || (
      ownField(value, 'substage') === 'init' && validInitialization(initialization)
    ))
  );
}

/** Project immediately; never retain an SDK exception or arbitrary error text. */
function errorDiagnostic(error: unknown): ErrorDiagnostic {
  let name = ownField(error, 'name');
  if (name === undefined) {
    try {
      name =
        error instanceof TypeError
          ? 'TypeError'
          : error instanceof ReferenceError
          ? 'ReferenceError'
          : error instanceof RangeError
          ? 'RangeError'
          : error instanceof SyntaxError
          ? 'SyntaxError'
          : error instanceof Error
          ? 'Error'
          : 'UnknownError';
    } catch {
      name = 'UnknownError';
    }
  }
  const code = ownField(error, 'code');
  const message = ownField(error, 'message');
  return Object.freeze({
    errorName: (ERROR_NAMES as readonly unknown[]).includes(name)
      ? (name as ErrorDiagnostic['errorName'])
      : 'UnknownError',
    errorCode: (ERROR_CODES as readonly unknown[]).includes(code)
      ? (code as ErrorDiagnostic['errorCode'])
      : (ERROR_CODES as readonly unknown[]).includes(message)
      ? (message as ErrorDiagnostic['errorCode'])
      : 'UNCLASSIFIED',
  });
}

export class WalletConnectQualificationError extends Error {
  readonly diagnostic: WalletConnectQualificationDiagnostic;
  constructor(
    substage: WalletConnectQualificationDiagnostic['substage'],
    error: unknown,
    counts?: WalletConnectAudit,
    initialization?: InitializationDiagnostic
  ) {
    super('WALLETCONNECT_NATIVE_QUALIFICATION_FAILED');
    this.diagnostic = Object.freeze({
      substage,
      ...errorDiagnostic(error),
      ...(validCounts(counts) ? { counts: Object.freeze({ ...counts }) } : {}),
      ...(substage === 'init' && validInitialization(initialization)
        ? { initialization: Object.freeze({ ...initialization }) }
        : {}),
    });
  }
}

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
const assert = (
  condition: unknown,
  code: WalletConnectQualificationDiagnostic['errorCode']
) => {
  if (!condition) throw Error(code);
};
async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(Error('WALLETCONNECT_NATIVE_TIMEOUT')),
          8000
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Uses public test topics and a loopback relay fixture; no wallet or remote relay. */
export async function qualifyNativeWalletConnect(options: {
  launch: HttpLaunch;
  build: HttpBuild;
  candidateIdentity: string;
  platform: WalletConnectReport['platform'];
  phase: WalletConnectReport['phase'];
  scenario: WalletConnectReport['scenario'];
  sessionId: string;
  walletFetch: typeof import('../src/platform/http').walletFetch;
}): Promise<WalletConnectReport> {
  let lastCounts: WalletConnectAudit | undefined;
  let firstFailure: WalletConnectQualificationError | undefined;
  let initialization: InitializationDiagnostic = Object.freeze({ stage: 'sdk-import' });
  const run = async <T>(
    substage: WalletConnectQualificationDiagnostic['substage'],
    operation: () => Promise<T>
  ): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      firstFailure ??=
        error instanceof WalletConnectQualificationError
          ? error
          : new WalletConnectQualificationError(substage, error, lastCounts,
            substage === 'init' ? initialization : undefined);
      throw firstFailure;
    }
  };
  const [
    { Core },
    { SignClient, SESSION_REQUEST_EXPIRY_BOUNDARIES },
    { parseUri },
  ] = await run('init', () =>
    Promise.all([
      import('@walletconnect/core'),
      import('@walletconnect/sign-client'),
      import('@walletconnect/utils'),
    ])
  );
  const { launch } = options;
  const status = () =>
    run('request', async () => {
      const response = await bounded(
        options.walletFetch(
          `http://127.0.0.1:${launch.port}/${launch.token}/wc-status?q=exact`,
          { credentials: 'omit', redirect: 'error' }
        )
      );
      assert(response.ok, 'WALLETCONNECT_NATIVE_STATUS_HTTP');
      const counts: unknown = await response.json();
      if (validCounts(counts)) lastCounts = Object.freeze({ ...counts });
      return counts as {
        opened: number;
        closed: number;
        pending: number;
        pendingClosed: number;
        frames: number;
        invalid: number;
      };
    });
  for (const pending of [false, true]) {
    initialization = Object.freeze({ stage: 'transport-open' });
    const owner = new AbortController();
    const values = new Map<string, unknown>();
    let core: InstanceType<typeof Core> | undefined;
    let client: InstanceType<typeof SignClient> | undefined;
    const repository: Omit<NativeConnectionRepository, 'calls'> = {
      assertHealthy() {},
      bindings: () => [],
      async reconcileSessions() {
        throw Error('Unused qualification reconciliation');
      },
      permissions() {
        throw Error('Unused qualification permission');
      },
      async retireAccount() {
        throw Error('Unused qualification account');
      },
      async dispose() {},
      transport: {
        getKeys: async () => [...values.keys()],
        getEntries: async <T>() => [...values.entries()] as [string, T][],
        getItem: async <T>(key: string) => values.get(key) as T | undefined,
        async setItem<T>(key: string, value: T) {
          values.set(key, value);
        },
        async removeItem(key: string) {
          values.delete(key);
        },
      },
    };
    const sdk: WalletConnectSdk = {
      requestExpirySeconds: SESSION_REQUEST_EXPIRY_BOUNDARIES,
      parseUri,
      createCore(input) {
        initialization = Object.freeze({ stage: 'core-create' });
        try {
          core = new Core({
            ...input,
            relayUrl: `ws://127.0.0.1:${launch.port}/${launch.token}/${
              pending ? 'wc-pending' : 'wc-open'
            }`,
          });
          initialization = Object.freeze({ stage: 'core-ready' });
          return core;
        } catch (error) {
          initialization = Object.freeze({ stage: 'core-create', ...errorDiagnostic(error) });
          throw error;
        }
      },
      async initialize(input) {
        initialization = Object.freeze({ stage: 'client-init' });
        try {
          client = await SignClient.init({
            ...input,
            core: core!,
            metadata: { ...input.metadata, icons: [...input.metadata.icons] },
          });
          initialization = Object.freeze({ stage: 'client-ready' });
          return client;
        } catch (error) {
          initialization = Object.freeze({ stage: 'client-init', ...errorDiagnostic(error) });
          throw error;
        }
      },
    };
    const transport = await run('init', () =>
      bounded(
        openWalletConnectTransport({
          projectId: '00000000000000000000000000000000',
          repository,
          signal: owner.signal,
          metadata: {
            name: 'Pali loopback qualification',
            description: '',
            url: 'https://paliwallet.com',
            icons: [],
          },
          supportedMethods: ['personal_sign'],
          supportedEvents: ['accountsChanged'],
          assertOwner() {
            assert(!owner.signal.aborted, 'WALLETCONNECT_NATIVE_OWNER_REVOKED');
          },
          async preparePlatform() {},
          onEvent() {},
          loadSdk: async () => sdk,
        })
      )
    );
    try {
      await run('pair', async () => {
        const pairing = transport.pair(
          `wc:${'a1'.repeat(32)}@2?relay-protocol=irn&symKey=${'b2'.repeat(
            32
          )}`,
          () =>
            assert(!owner.signal.aborted, 'WALLETCONNECT_NATIVE_OWNER_REVOKED'),
          () => undefined
        );
        const outcome = pairing.then(
          () => true,
          (error) => {
            if (!pending) throw error;
            return false;
          }
        );
        if (pending) {
          const started = Date.now();
          while ((await status()).pending !== 1 && Date.now() - started < 6000)
            await pause(50);
          assert(
            (await status()).pending === 1,
            'WALLETCONNECT_NATIVE_PENDING_OPEN'
          );
          owner.abort();
          assert(
            (await bounded(outcome)) === false,
            'WALLETCONNECT_NATIVE_ABORT_ACCEPTED'
          );
        } else
          assert(await bounded(outcome), 'WALLETCONNECT_NATIVE_PAIR_REJECTED');
      });
      await run('close', async () => {
        await bounded(transport.close());
        assert(
          core?.signal.aborted && client?.signal.aborted,
          'WALLETCONNECT_NATIVE_DISPOSAL_SIGNAL'
        );
        assert(
          core!.heartbeat.events.eventNames().length === 0 &&
            core!.relayer.events.eventNames().length === 0,
          'WALLETCONNECT_NATIVE_DISPOSAL_LISTENERS'
        );
      });
    } finally {
      owner.abort();
      await run('close', () => bounded(transport.close()));
    }
  }
  const closedAt = Date.now();
  let audit = await status();
  while (
    (audit.closed !== 1 || audit.pendingClosed !== 1) &&
    Date.now() - closedAt < 6000
  ) {
    await pause(50);
    audit = await status();
  }
  await run('request', async () => assertWalletConnectAudit(audit));
  await pause(6000);
  const later = await status();
  await run('request', async () =>
    assert(
      JSON.stringify(later) === JSON.stringify(audit),
      'WALLETCONNECT_NATIVE_AUDIT_CHANGED'
    )
  );
  return Object.freeze({
    ...options.build,
    kind: 'native-walletconnect',
    status: 'passed',
    candidateIdentity: options.candidateIdentity,
    token: launch.token,
    platform: options.platform,
    phase: options.phase,
    scenario: options.scenario,
    sessionId: options.sessionId,
  });
}
