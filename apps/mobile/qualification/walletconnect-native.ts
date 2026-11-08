import {
  openWalletConnectTransport,
  type WalletConnectSdk,
} from '../src/connections/walletConnect.ts';
import type { NativeConnectionRepository } from '../src/connections/storage.ts';
import type { HttpBuild, HttpLaunch } from './http-contract.ts';
import {
  assertWalletConnectAudit,
  type WalletConnectReport,
} from './walletconnect-contract.ts';

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
const assert = (condition: unknown) => {
  if (!condition) throw Error('WALLETCONNECT_NATIVE_QUALIFICATION_FAILED');
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
  const [
    { Core },
    { SignClient, SESSION_REQUEST_EXPIRY_BOUNDARIES },
    { parseUri },
  ] = await Promise.all([
    import('@walletconnect/core'),
    import('@walletconnect/sign-client'),
    import('@walletconnect/utils'),
  ]);
  const { launch } = options;
  const status = async () => {
    const response = await bounded(
      options.walletFetch(
        `http://127.0.0.1:${launch.port}/${launch.token}/wc-status?q=exact`,
        { credentials: 'omit', redirect: 'error' }
      )
    );
    assert(response.ok);
    return response.json() as Promise<{
      opened: number;
      closed: number;
      pending: number;
      pendingClosed: number;
      frames: number;
      invalid: number;
    }>;
  };
  for (const pending of [false, true]) {
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
        core = new Core({
          ...input,
          relayUrl: `ws://127.0.0.1:${launch.port}/${launch.token}/${
            pending ? 'wc-pending' : 'wc-open'
          }`,
        });
        return core;
      },
      async initialize(input) {
        client = await SignClient.init({
          ...input,
          core: core!,
          metadata: { ...input.metadata, icons: [...input.metadata.icons] },
        });
        return client;
      },
    };
    const transport = await bounded(
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
          assert(!owner.signal.aborted);
        },
        async preparePlatform() {},
        onEvent() {},
        loadSdk: async () => sdk,
      })
    );
    try {
      const pairing = transport.pair(
        `wc:${'a1'.repeat(32)}@2?relay-protocol=irn&symKey=${'b2'.repeat(32)}`,
        () => assert(!owner.signal.aborted),
        () => undefined
      );
      const outcome = pairing.then(
        () => true,
        () => false
      );
      if (pending) {
        const started = Date.now();
        while ((await status()).pending !== 1 && Date.now() - started < 6000)
          await pause(50);
        assert((await status()).pending === 1);
        owner.abort();
        assert((await bounded(outcome)) === false);
      } else assert(await bounded(outcome));
      await bounded(transport.close());
      assert(core?.signal.aborted && client?.signal.aborted);
      assert(
        core!.heartbeat.events.eventNames().length === 0 &&
          core!.relayer.events.eventNames().length === 0
      );
    } finally {
      owner.abort();
      await bounded(transport.close());
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
  assertWalletConnectAudit(audit);
  await pause(6000);
  const later = await status();
  assert(JSON.stringify(later) === JSON.stringify(audit));
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
