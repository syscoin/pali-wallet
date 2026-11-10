import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import {
  abortable,
  boundedResponseText,
  cancelResponseBody,
} from '../../../../source/shared/boundedHttp.ts';
import {
  SENTRY_NETWORKS,
  type SentryNetwork,
} from '../../../../source/shared/sentryNetworks.ts';
import { readSentryServiceSettings } from '../../../../source/shared/sentrySettings.ts';
import {
  createSentryKeyVault,
  type ISentryKeyVaultHost,
} from '../../../../source/wallet/sentryKeyVault.ts';
import { SharedSentryVoteApprovals } from '../../../../source/wallet/sentryVoteApprovals.ts';
import { SharedSentryOperationApprovals } from '../../../../source/wallet/sentryOperationApprovals.ts';
import { consumeSentrySigningMaterial, sentryAuthorityRequestId, type SentryApprovalHost, type SentrySigningMaterialRequest } from '../../../../source/wallet/sentryApprovalHost.ts';
import { HOST_WALLET_AUTHENTICATION, isHostWalletAuthentication } from '../../../../source/shared/walletAuthentication.ts';
import type { SentryApprovalScope, SentryRequestScope, SentryRequestLifetime } from '../../../../source/wallet/sentryApprovalTypes.ts';
import type {
  RunSentryCrypto,
  SentryCryptoResult,
} from '../../../../source/wallet/sentryCryptoJobs.ts';
import type { createNativeSentryCollateral } from './sentryNodeManagement.ts';
import type { NativeSentryWalletAuthority } from './sentryWalletAuthority.ts';
import type { SentryNodeStorage } from '../storage/sentryNodeDomain.ts';
import { encodeBoundedStorageValue } from '../storage/json.ts';

export function createNativeSentryJsonReader(
  ports: Readonly<{
    assertCurrent(): void;
    fetch: typeof globalThis.fetch;
    lifetime: AbortSignal;
  }>
) {
  return async (
    url: string,
    limit: number,
    assertRequest: () => void,
    signal: AbortSignal
  ): Promise<unknown> => {
    const request = new AbortController();
    const abort = () => request.abort();
    const check = () => {
      assertSynchronousEvmFeeGuard(ports.assertCurrent);
      assertSynchronousEvmFeeGuard(assertRequest);
      if (ports.lifetime.aborted || signal.aborted || request.signal.aborted)
        throw new Error('CANCELLED');
    };
    ports.lifetime.addEventListener('abort', abort, { once: true });
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 15_000);
    try {
      check();
      const pending = ports
        .fetch(url, {
          method: 'GET',
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
          headers: { Accept: 'application/json' },
          signal: request.signal,
        })
        .then((response) => {
          try {
            check();
            return response;
          } catch (error) {
            cancelResponseBody(response);
            throw error;
          }
        });
      // An owner can abort synchronously inside fetch, before abortable installs
      // its listener; the late guarded transport rejection still needs an owner.
      void pending.catch(() => undefined);
      const response = await abortable(pending, request.signal);
      check();
      if (
        !response.ok ||
        response.redirected ||
        response.url !== url ||
        !response.body?.getReader
      ) {
        cancelResponseBody(response);
        throw new Error('Sentry data service is unavailable');
      }
      const text = await boundedResponseText(response, request.signal, limit);
      check();
      return JSON.parse(text);
    } finally {
      clearTimeout(timer);
      ports.lifetime.removeEventListener('abort', abort);
      signal.removeEventListener('abort', abort);
      request.abort();
    }
  };
}

type Ports = Readonly<{
  assertCurrent(): void;
  collateral: ReturnType<typeof createNativeSentryCollateral>;
  lifetime: AbortSignal;
  network: SentryNetwork;
  scope: SentryApprovalScope;
  nodeStorage: SentryNodeStorage;
  vaultHost: ISentryKeyVaultHost;
  vaultId: string;
  readSettings(): Promise<unknown>;
  readJson: ReturnType<typeof createNativeSentryJsonReader>;
  isAuthenticating(): boolean;
  withSigningMaterial<T>(request: SentrySigningMaterialRequest, work: (seed: string, privateAccount: string | null) => Promise<T>): Promise<T>;
  run<T>(operation: () => Promise<T>): Promise<T>;
  runCrypto: RunSentryCrypto;
  walletAuthority: NativeSentryWalletAuthority;
}>;

function publicSnapshot<T>(value: T): T {
  const copied = JSON.parse(JSON.stringify(value));
  const freeze = (item: unknown): void => {
    if (item && typeof item === 'object') {
      for (const child of Object.values(item)) freeze(child);
      Object.freeze(item);
    }
  };
  freeze(copied);
  return copied;
}
const captureRequest = (value: unknown): unknown =>
  JSON.parse(
    encodeBoundedStorageValue(value, {
      valueBytes: 4 * 1024 * 1024,
      depth: 24,
      nodes: 32_000,
    })
  );

/** Custody-only adapter. Public facades contain no seed, key or host capability. */
export function createNativeSentryApprovals(ports: Ports) {
  let disposed = false;
  const scope = Object.freeze({
    ...ports.scope,
    network: Object.freeze({ ...ports.scope.network }),
    assertRequestCurrent: () => check(),
  });
  const check = () => {
    assertSynchronousEvmFeeGuard(ports.assertCurrent);
    if (disposed || ports.lifetime.aborted) throw new Error('CANCELLED');
  };
  const assertScope = (captured: SentryApprovalScope) => {
    check();
    if (captured.identity !== scope.identity || captured.network !== scope.network || captured.rootPublicIdentity !== scope.rootPublicIdentity) throw new Error('CANCELLED');
  };
  const vault = createSentryKeyVault(ports.vaultHost);
  const host: SentryApprovalHost = {
    captureScope: () => {
      check();
      return scope;
    },
    assertCurrent: assertScope,
    async withSigningMaterial(request, work) {
      assertScope(request.scope);
      if (!isHostWalletAuthentication(request.authentication)) throw new Error('Native authentication is required');
      const prepared = new Map<string, Awaited<ReturnType<NativeSentryWalletAuthority['prepare']>>>();
      for (const authority of request.walletAuthorities) {
        assertSynchronousEvmFeeGuard(request.assertCurrent);
        prepared.set(sentryAuthorityRequestId(authority), await ports.walletAuthority.prepare(authority.address, authority.purpose));
        assertScope(request.scope);
      }
      return ports.withSigningMaterial(request, async (seed, privateAccount) => {
        const resolved = new Map<string, { scheme: 'ecdsa'; secretKey: string } | undefined>();
        try {
          for (const [id, resolve] of prepared) resolved.set(id, resolve && privateAccount !== null ? resolve(privateAccount) : undefined);
          return await consumeSentrySigningMaterial(request, seed, resolved, work);
        } finally {
          for (const authority of resolved.values()) if (authority) authority.secretKey = '';
          resolved.clear(); prepared.clear();
        }
      });
    },
    async getSettings(captured) {
      assertScope(captured);
      const saved = await ports.readSettings();
      assertScope(captured);
      const service = readSentryServiceSettings(saved, ports.network);
      const keys = await vault.listSentryKeys(ports.vaultId, ports.network);
      assertScope(captured);
      const nodes = await ports.nodeStorage.read();
      assertScope(captured);
      return {
        ...service,
        keys,
        network: ports.network,
        collateral: [...(nodes?.collateral ?? [])],
        linkedNodes: [...(nodes?.linkedNodes ?? [])],
      };
    },
    async loadKey({ scope: captured, network, id, seed, assertCurrent }) {
      assertScope(captured);
      if (network !== ports.network) throw new Error('CANCELLED');
      const key = await vault.loadSentryKey({
        vaultId: ports.vaultId,
        network,
        id,
        seed,
        assertCurrent: () => {
          assertScope(captured);
          assertSynchronousEvmFeeGuard(assertCurrent);
        },
      });
      assertScope(captured);
      return key;
    },
    async readJson(url, limit, captured, assertRequest, signal) {
      assertScope(captured);
      const value = await ports.readJson(url, limit, () => {
        assertScope(captured);
        assertSynchronousEvmFeeGuard(assertRequest);
      }, signal);
      assertScope(captured);
      return value;
    },
    async hasWalletAuthority(address, captured) {
      assertScope(captured);
      const result = await ports.walletAuthority.has(address);
      assertScope(captured);
      return result;
    },
    async runCrypto<T extends SentryCryptoResult>(
      job: Parameters<RunSentryCrypto>[0],
      assertRequest: () => void
    ): Promise<T> {
      const guard = () => {
        check();
        assertSynchronousEvmFeeGuard(assertRequest);
        check();
      };
      guard();
      const result = await ports.runCrypto<T>(job, guard);
      guard();
      return result;
    },
    runExclusive: (operation) =>
      ports.run(async () => {
        check();
        return operation();
      }),
  };
  check();
  if (
    scope.network.chainId !== SENTRY_NETWORKS[ports.network].chainId ||
    scope.rootPublicIdentity !== ports.collateral.scope.walletIdentity ||
    ports.collateral.scope.genesisHash !==
      SENTRY_NETWORKS[ports.network].genesisHash
  )
    throw new Error('CANCELLED');
  const votes = new SharedSentryVoteApprovals(host);
  const operations = new SharedSentryOperationApprovals({
    ...host,
    network: (captured) => {
      assertScope(captured);
      return ports.network;
    },
    async captureCollateralAdmission(captured) {
      assertScope(captured);
      const admission =
        await ports.collateral.registry.captureSentryCollateralAdmission(
          ports.collateral.scope
        );
      assertScope(captured);
      return admission;
    },
    async ownsCollateral(outpoint, captured) {
      assertScope(captured);
      const result = await ports.walletAuthority.owns(outpoint);
      assertScope(captured);
      return result;
    },
    async reserveCollateral(
      captured,
      { admission, reservation },
      assertRequest
    ) {
      assertScope(captured);
      await ports.collateral.registry.reserveSentryCollateral({
        ...ports.collateral.scope,
        admission,
        reservation,
        assertCurrent: () => {
          assertScope(captured);
          assertSynchronousEvmFeeGuard(assertRequest);
        },
      });
      assertScope(captured);
    },
  });
  function dispose() {
    disposed = true;
    votes.clear();
    operations.clear();
    ports.lifetime.removeEventListener('abort', dispose);
  }
  ports.lifetime.addEventListener('abort', dispose, { once: true });
  const captureScope = (assertGrant: () => void): SentryRequestScope => {
    check(); assertSynchronousEvmFeeGuard(assertGrant);
    return Object.freeze({ ...scope, assertRequestCurrent: () => { check(); assertSynchronousEvmFeeGuard(assertGrant); } });
  };
  return Object.freeze({
    assertCurrent: check,
    isAuthenticating: ports.isAuthenticating,
    votes: Object.freeze({
      prepare: (raw: unknown, origin: string, assertGrant: () => void, lifetime: SentryRequestLifetime) => {
        check();
        const request = captureRequest(raw);
        return ports.run(async () => {
          check();
          const id = await votes.prepare(request, origin, captureScope(assertGrant), lifetime);
          check();
          return id;
        });
      },
      getApproval: (id: string) => {
        check();
        return publicSnapshot(votes.getApproval(id));
      },
      cancel: (id: string) => votes.cancel(id),
      clear: () => votes.clear(),
      sign: (params: Omit<Parameters<SharedSentryVoteApprovals['sign']>[0], 'password'>) => {
        check();
        return votes.sign({ ...params, password: HOST_WALLET_AUTHENTICATION });
      },
    }),
    operations: Object.freeze({
      prepare: (raw: unknown, origin: string, assertGrant: () => void, lifetime: SentryRequestLifetime) => {
        check();
        const request = captureRequest(raw);
        return ports.run(async () => {
          check();
          const id = await operations.prepare(request, origin, captureScope(assertGrant), lifetime);
          check();
          return id;
        });
      },
      getApproval: (id: string) => {
        check();
        return publicSnapshot(operations.getApproval(id));
      },
      cancel: (id: string) => operations.cancel(id),
      clear: () => operations.clear(),
      publishFeeAuthorization: (id: string) => { check(); operations.publishFeeAuthorization(id); },
      revalidate: () => operations.revalidate(),
      sign: (params: Omit<Parameters<SharedSentryOperationApprovals['sign']>[0], 'password'>) => {
        check();
        return operations.sign({ ...params, password: HOST_WALLET_AUTHENTICATION });
      },
      prepareFeePsbt: (transactionHex: string, origin: string) => {
        check();
        return operations.prepareFeePsbt(transactionHex, origin);
      },
      beginFeeSigning: (id: string, transactionHex: string) => {
        check();
        return operations.beginFeeSigning(id, transactionHex);
      },
      async reviewFeePsbt(id: string, transactionHex: string, lifetime: SentryRequestLifetime) {
        // Public verification runs inside the child PSBT's existing ownership.
        // Re-entering the private gate would reject that same admitted child.
        check();
        const review = await operations.reviewFeePsbt(id, transactionHex, lifetime);
        check();
        return publicSnapshot(review);
      },
    }),
    dispose,
  });
}

export type NativeSentryApprovals = ReturnType<
  typeof createNativeSentryApprovals
>;
