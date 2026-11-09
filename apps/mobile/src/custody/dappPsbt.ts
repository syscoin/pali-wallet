import { preparePsbtApproval, psbtAssetMetadataUrl, type PreparedPsbtApproval, type PsbtApprovalHost } from '../../../../source/wallet/psbtApprovals.ts';
import { createOwnedUtxoBlockbookRead } from '../../../../source/wallet/utxoBlockbookReads.ts';
import { isSentryTransactionVersion } from '../../../../source/wallet/sentryFeeAuthorizations.ts';
import { SENTRY_NETWORKS } from '../../../../source/shared/sentryNetworks.ts';
import { assertUtxoSoftwareSpend } from '../../../../source/shared/utxoSoftwareCustody.ts';
import { utxoInputOutpoints } from '../../../../source/utils/utxoAcknowledgedInputs.ts';
import { isCustomUtxoNetworkId, type UtxoNetwork } from '../core/utxoNetworks.ts';
import { verifySavedUtxoEndpoint } from '../core/utxoReadSession.ts';
import type { NativePsbtRequest } from '../connections/psbtRequests.ts';
import type { createNativeSentryCollateral } from './sentryNodeManagement.ts';
import type { UtxoSignedScope } from '../../../../source/wallet/utxoSignedBinding.ts';
import type { UtxoRecordSession, UtxoSignedRecords } from '../../../../source/wallet/utxoSignedRecords.ts';
import type { NativeSentryApprovals } from './sentryApprovals.ts';
import type { ISyscoinTransactions } from '@sidhujag/sysweb3-keyring';

type Ports = Readonly<{
  network: UtxoNetwork;
  scope: UtxoSignedScope;
  session: UtxoRecordSession;
  sdk: ISyscoinTransactions;
  records: UtxoSignedRecords;
  fetch: typeof globalThis.fetch;
  collateral: ReturnType<typeof createNativeSentryCollateral> | null;
  sentry: NativeSentryApprovals['operations'] | null;
}>;

/** Captured custody ports feed the same external-PSBT engine as the extension. */
export async function prepareNativeDappPsbt(request: NativePsbtRequest, lifetime: AbortSignal, ports: Ports): Promise<PreparedPsbtApproval> {
  const { scope, network, session, sdk, collateral } = ports;
  const sentryChain = Object.values(SENTRY_NETWORKS).some(item => item.chainId === scope.network.chainId && item.genesisHash === scope.network.genesisHash);
  const supplied = collateral !== null && typeof collateral === 'object' && !!collateral.registry && !!collateral.scope;
  if ((collateral !== null && !supplied) || sentryChain !== supplied ||
      collateral && collateral.scope.genesisHash !== scope.network.genesisHash)
    throw new Error('PSBT_CUSTODY_UNAVAILABLE');
  let disposed = false;
  let prepared: PreparedPsbtApproval | undefined;
  const check = () => {
    session.assertCurrent();
    if (disposed || lifetime.aborted) throw new Error('CONTEXT_CHANGED');
  };
  const dispose = () => {
    disposed = true;
    lifetime.removeEventListener('abort', dispose);
    prepared?.dispose();
  };
  lifetime.addEventListener('abort', dispose, { once: true });
  const verifyEndpoint = (signal: AbortSignal, current: () => void) =>
    verifySavedUtxoEndpoint(network, { fetch: ports.fetch, timeoutMs: 10_000 }, signal, current);
  const custom = isCustomUtxoNetworkId(network.id);
  const sender: PsbtApprovalHost['sdk'] = {
    decodeRawTransaction: (...args) => sdk.decodeRawTransaction(...args),
    signPSBT: (...args) => sdk.signPSBT(...args),
    sendTransaction: (raw, authority) => sdk.sendTransaction(raw, custom ? {
      ...authority,
      async prepare(candidate) {
        await authority.prepare(candidate);
        await verifyEndpoint(authority.signal, authority.assertCurrent);
        authority.assertCurrent();
      },
    } : authority),
  };
  const assertUnprotected: PsbtApprovalHost['assertUnprotected'] = async (resolve, current) => {
    check(); current();
    if (!collateral) return;
    const reservations = await collateral.registry.getSentryCollateralReservations(collateral.scope);
    check(); current();
    const protectedSet = new Set(reservations.map(item => `${item.txid}:${item.vout}`));
    if (utxoInputOutpoints(resolve().txInputs).some(point => protectedSet.has(point)))
      throw new Error('PSBT_PROTECTED_COLLATERAL');
  };
  let feeAuthorization: string | undefined;
  const transactionHex = (psbt: Parameters<PsbtApprovalHost['fee']['verify']>[0]) => Buffer.from(psbt.data.globalMap.unsignedTx.toBuffer()).toString('hex');
  const host: PsbtApprovalHost = {
    network: scope.network,
    sdk: sender,
    assertCurrent: check,
    assertSoftwareSpend(inputs, outputs) {
      check(); assertUtxoSoftwareSpend(scope.network, [...inputs, ...outputs.map(output => output.script)]);
    },
    async withRead(current, signal, operation) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      lifetime.addEventListener('abort', abort, { once: true });
      const owned = () => { check(); current(); if (signal.aborted || controller.signal.aborted) throw new Error('CONTEXT_CHANGED'); };
      try {
        owned(); if (custom) await verifyEndpoint(controller.signal, owned);
        const read = createOwnedUtxoBlockbookRead({ kind: 'wallet', url: scope.network.url, xpub: scope.account.xpub, address: scope.account.address }, controller.signal, owned, ports.fetch);
        const result = await operation(read); owned(); return result;
      } finally { signal.removeEventListener('abort', abort); lifetime.removeEventListener('abort', abort); controller.abort(); }
    },
    async readAssetMetadata(guid, current, signal) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      lifetime.addEventListener('abort', abort, { once: true });
      const owned = () => { check(); current(); if (signal.aborted || controller.signal.aborted) throw new Error('CONTEXT_CHANGED'); };
      try {
        owned(); if (custom) await verifyEndpoint(controller.signal, owned);
        const read = createOwnedUtxoBlockbookRead({ kind: 'asset', assetGuid: guid, url: scope.network.url }, controller.signal, owned, ports.fetch);
        const response = await read.fetch(psbtAssetMetadataUrl(scope.network.url, guid), { method: 'GET', signal: controller.signal });
        owned(); if (!response.ok) throw new Error('PSBT_ASSET_UNAVAILABLE');
        const result: unknown = await response.json(); owned(); return result;
      } finally { signal.removeEventListener('abort', abort); lifetime.removeEventListener('abort', abort); controller.abort(); }
    },
    assertUnprotected,
    withSignatureRelease(operation) {
      check();
      return collateral ? collateral.registry.withSentryCollateralSignatureRelease(collateral.scope, operation) : operation(() => undefined);
    },
    fee: {
      async verify(psbt, capability, current, signal) {
        check(); current();
        if (capability !== null && capability !== undefined) throw new Error('SENTRY_FEE_AUTHORIZATION_REQUIRED');
        if (!isSentryTransactionVersion(psbt.version)) return null;
        if (request.method !== 'sys_sign' || !ports.sentry) throw new Error('SENTRY_FEE_AUTHORIZATION_REQUIRED');
        const hex = transactionHex(psbt);
        const id = ports.sentry.prepareFeePsbt(hex, request.origin);
        if (feeAuthorization !== undefined && feeAuthorization !== id) throw new Error('SENTRY_FEE_AUTHORIZATION_REQUIRED');
        feeAuthorization = id;
        const controller = new AbortController(), abort = () => controller.abort();
        signal.addEventListener('abort', abort, { once: true });
        lifetime.addEventListener('abort', abort, { once: true });
        const owned = () => { check(); current(); if (signal.aborted || controller.signal.aborted) throw new Error('CONTEXT_CHANGED'); };
        try { owned(); return await ports.sentry.reviewFeePsbt(id, hex, { assertCurrent: owned, signal: controller.signal }); }
        finally { signal.removeEventListener('abort', abort); lifetime.removeEventListener('abort', abort); controller.abort(); }
      },
      acquire(psbt, capability, current) {
        check(); current();
        if (capability !== null && capability !== undefined || !ports.sentry || !feeAuthorization) throw new Error('SENTRY_FEE_AUTHORIZATION_REQUIRED');
        return ports.sentry.beginFeeSigning(feeAuthorization, transactionHex(psbt));
      },
    },
    broadcast: {
      owner: () => ({ chainId: scope.network.chainId, slip44: scope.network.slip44, genesisHash: scope.network.genesisHash, account: scope.account }),
      records: ports.records,
      session: { keyring: session.keyring, assertCurrent: check },
      withAdmission(operation) {
        check();
        const submit = (markInvoked: () => void) => operation((input, init) => {
          check(); if (init?.method === 'POST') markInvoked(); return ports.fetch(input, init);
        });
        return collateral ? collateral.registry.withSentryCollateralBroadcast(collateral.scope, submit) : submit(() => undefined);
      },
    },
  };
  try {
    check();
    prepared = await preparePsbtApproval(host, { ...request, feeAuthorization: null });
    check(); prepared.assertCurrent();
    const retained = prepared;
    return Object.freeze({ review: retained.review, disposition: retained.disposition, assertCurrent() { check(); retained.assertCurrent(); },
      async approve() { check(); const result = await retained.approve(); check(); return result; },
      dispose });
  } catch (cause) { dispose(); throw cause; }
}
