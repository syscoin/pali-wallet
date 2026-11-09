import { PsbtUtils } from '@sidhujag/sysweb3-keyring/cjs/utils/psbt.js';
import { utils as syscoinUtils } from 'syscoinjs-lib';
import { utils as syscoinTransactionTypes } from 'syscointx-js';

import { assertSynchronousEvmFeeGuard } from '../shared/evmFeeGuard.ts';
import {
  capturePsbtEnvelope,
  type PsbtEnvelope,
} from '../shared/psbtEnvelope.ts';
import { parseSyscoinAssetGuid } from '../shared/syscoinAssetIds.ts';
import {
  inspectUtxoRbf,
  reviewUtxoTransactionOptions,
  type UtxoTransactionOptions,
} from '../shared/utxoTransactionOptions.ts';
import { assertJsonWorkBudget } from '../utils/requestPayloadBudget.ts';
import {
  getAssetReviewRows,
  getCanonicalOutputRecipient,
  getSyscoinPsbtReviewError,
  type IAssetMetadata,
} from '../utils/syscoinPsbtReview.ts';
import {
  createUtxoFeeReview,
  assertUtxoFeeReview,
  getVerifiedSyscoinPsbtValueSummary,
  type UtxoFeeReview,
} from '../utils/syscoinPsbtValues.ts';

import {
  isSentryTransactionVersion,
  type SentryFeeReview,
} from './sentryFeeAuthorizations.ts';
import {
  createUtxoTransactionBinding,
  utxoSubmissionUrl,
} from './utxoSignedBinding.ts';
import type {
  UtxoRecordOwner,
  UtxoRecordSession,
  UtxoSignedRecords,
} from './utxoSignedRecords.ts';
import {
  createUtxoSubmissionDisposition,
  submitReviewedUtxo,
  type UtxoSubmissionDisposition,
} from './utxoSubmission.ts';
import type { ISyscoinTransactions } from '@sidhujag/sysweb3-keyring';
import type { Psbt } from 'bitcoinjs-lib';

export type PsbtApprovalMethod = 'sys_sign' | 'sys_signAndSend';
export type SyscoinPsbtAssetMetadata = Readonly<IAssetMetadata>;
export type PsbtNetwork = Readonly<{
  chainId: number;
  currency: string;
  slip44: number;
  url: string;
}>;
export type PsbtOwnedRead = Parameters<ISyscoinTransactions['signPSBT']>[1];
export type PsbtApprovalReview = Readonly<{
  complete: boolean;
  feeSatoshis: string;
  inputs: readonly Readonly<{
    scriptHex: string;
    txid: string;
    valueSatoshis: string;
    vout: number;
  }>[];
  method: PsbtApprovalMethod;
  origin: string;
  outputs: readonly Readonly<{
    address: string | null;
    assets: readonly Readonly<{
      amount: string;
      assetGuid: string;
      isBurn: boolean;
      rawAmount: string;
      symbol: string;
    }>[];
    index: number;
    scriptHex: string;
    valueSatoshis: string;
  }>[];
  sentry: SentryFeeReview | null;
  transactionOptions: UtxoTransactionOptions;
  transactionType: string;
  unsignedHash: string;
}>;
export type PsbtSigningPorts = Readonly<{
  assertCurrent(): void;
  assertSoftwareSpend(
    inputScripts: readonly Uint8Array[],
    outputs: readonly { script: Uint8Array }[]
  ): void;
  assertUnprotected(resolve: () => Psbt, check: () => void): Promise<void>;
  fee: Readonly<{
    acquire(
      psbt: Psbt,
      capability: unknown,
      check: () => void
    ): (disclosed?: boolean) => void;
    verify(
      psbt: Psbt,
      capability: unknown,
      check: () => void,
      signal: AbortSignal
    ): Promise<SentryFeeReview | null>;
  }>;
  network: PsbtNetwork;
  sdk: Pick<ISyscoinTransactions, 'signPSBT'>;
  withSignatureRelease<T>(
    operation: (markDisclosed: () => void) => Promise<T>
  ): Promise<T>;
}>;
export type PsbtSigningHost = PsbtSigningPorts &
  Readonly<{
    sdk: Pick<
      ISyscoinTransactions,
      'decodeRawTransaction' | 'signPSBT' | 'sendTransaction'
    >;
    withRead<T>(
      check: () => void,
      signal: AbortSignal,
      operation: (read: PsbtOwnedRead) => Promise<T>
    ): Promise<T>;
  }>;
export type PsbtApprovalHost = PsbtSigningHost &
  Readonly<{
    broadcast: Readonly<{
      owner(): UtxoRecordOwner;
      records: UtxoSignedRecords;
      session: UtxoRecordSession;
      withAdmission<T>(
        operation: (fetch: typeof globalThis.fetch) => Promise<T>
      ): Promise<T>;
    }>;
    readAssetMetadata(
      guid: string,
      check: () => void,
      signal: AbortSignal
    ): Promise<unknown>;
  }>;
export type PreparedPsbtApproval = Readonly<{
  approve(): Promise<PsbtEnvelope | Readonly<{ txid: string }>>;
  assertCurrent(): void;
  dispose(): void;
  disposition(): UtxoSubmissionDisposition;
  review: PsbtApprovalReview;
}>;

export function psbtAssetMetadataUrl(base: string, guid: string): string {
  if (!parseSyscoinAssetGuid(guid)) throw new Error('Invalid asset GUID');
  return (
    utxoSubmissionUrl(base).slice(0, -'sendtx/'.length) +
    `asset/${guid}?details=basic`
  );
}

/** The existing getAsset checks and exact Blockbook asset response, shared by both hosts. */
export function capturePsbtAssetMetadata(
  guid: string,
  response: unknown
): SyscoinPsbtAssetMetadata {
  assertJsonWorkBudget(response, 64 * 1024);
  const asset = (response as { asset?: Record<string, unknown> } | null)?.asset;
  if (
    !asset ||
    typeof asset !== 'object' ||
    Array.isArray(asset) ||
    String(asset.assetGuid) !== guid ||
    typeof asset.symbol !== 'string' ||
    !asset.symbol.trim() ||
    asset.symbol.startsWith('UNKNOWN-') ||
    asset.metaData === 'Unknown Asset Type'
  )
    throw new Error(`Unable to verify asset ${guid}`);
  return Object.freeze({
    assetGuid: guid,
    assetType: asset.assetType as IAssetMetadata['assetType'],
    decimals: asset.decimals as number,
    symbol: asset.symbol,
    ...(asset.contract !== undefined
      ? { contract: asset.contract as string }
      : {}),
    ...(asset.originDecimals !== undefined
      ? { originDecimals: asset.originDecimals as number }
      : {}),
    ...(asset.tokenId !== undefined
      ? { tokenId: asset.tokenId as string }
      : {}),
  });
}

function checkSigningPorts(host: PsbtSigningPorts) {
  if (
    [
      host.assertCurrent,
      host.assertSoftwareSpend,
      host.assertUnprotected,
      host.withSignatureRelease,
      host.fee?.verify,
      host.fee?.acquire,
      host.sdk?.signPSBT,
    ].some((port) => typeof port !== 'function')
  )
    throw new Error('Explicit PSBT signing ports are required');
}

function checkHost(host: PsbtSigningHost) {
  checkSigningPorts(host);
  if (
    [
      host.withRead,
      host.sdk?.decodeRawTransaction,
      host.sdk?.sendTransaction,
    ].some((port) => typeof port !== 'function')
  )
    throw new Error('Explicit PSBT read and submission ports are required');
}

export async function verifyPsbtEnvelope(
  network: PsbtNetwork,
  envelope: PsbtEnvelope,
  read: PsbtOwnedRead,
  check: () => void
) {
  check();
  const psbt: Psbt = PsbtUtils.fromPali(envelope, network);
  const summary = await getVerifiedSyscoinPsbtValueSummary(psbt, (txid) => {
    check();
    return syscoinUtils.fetchBackendRawTx(network.url, txid, read);
  });
  check();
  return { psbt, summary };
}

type VerifiedPsbt = Awaited<ReturnType<typeof verifyPsbtEnvelope>>;

async function verifyFee(
  host: PsbtSigningPorts,
  psbt: Psbt,
  capability: unknown,
  check: () => void,
  signal: AbortSignal
) {
  check();
  const fee = await host.fee.verify(psbt, capability, check, signal);
  check();
  if (
    (isSentryTransactionVersion(psbt.version) ||
      (capability !== null && capability !== undefined)) &&
    !fee
  )
    throw new Error('SENTRY_FEE_AUTHORIZATION_REQUIRED');
  return fee;
}

/** The released SDK signing and guarded disclosure sequence, without browser or custody imports. */
export async function signReviewedPsbt(
  host: PsbtSigningHost,
  input: Readonly<{
    assertCurrent(): void;
    feeAuthorization: unknown;
    psbt: PsbtEnvelope;
    review: UtxoFeeReview;
    signal: AbortSignal;
  }>
): Promise<PsbtEnvelope> {
  checkHost(host);
  const envelope = capturePsbtEnvelope(input.psbt);
  const check = () => {
    assertSynchronousEvmFeeGuard(host.assertCurrent);
    assertSynchronousEvmFeeGuard(input.assertCurrent);
    if (input.signal.aborted) throw new Error('PSBT approval was cancelled');
  };
  check();
  host.assertSoftwareSpend([], []);
  return host.withRead(check, input.signal, async (read) => {
    const verified = await verifyPsbtEnvelope(
      host.network,
      envelope,
      read,
      check
    );
    return signVerifiedPsbt(host, { ...input, psbt: envelope, verified, read });
  });
}

/** Reuse a host's already verified prevouts within the same owned read. */
export async function signVerifiedPsbt(
  host: PsbtSigningPorts,
  input: Readonly<{
    assertCurrent(): void;
    feeAuthorization: unknown;
    psbt: PsbtEnvelope;
    read: PsbtOwnedRead;
    review: UtxoFeeReview | null;
    signal: AbortSignal;
    verified: VerifiedPsbt;
  }>
): Promise<PsbtEnvelope> {
  checkSigningPorts(host);
  const envelope = capturePsbtEnvelope(input.psbt);
  const check = () => {
    assertSynchronousEvmFeeGuard(host.assertCurrent);
    assertSynchronousEvmFeeGuard(input.assertCurrent);
    if (input.signal.aborted) throw new Error('PSBT approval was cancelled');
  };
  check();
  const { psbt, summary } = input.verified;
  const review = input.review ?? createUtxoFeeReview(psbt, summary.feeSatoshis);
  assertUtxoFeeReview(psbt, summary.feeSatoshis, review);
  const sentry = await verifyFee(
    host,
    psbt,
    input.feeAuthorization,
    check,
    input.signal
  );
  await host.assertUnprotected(() => psbt, check);
  check();
  const finishFee = sentry
    ? host.fee.acquire(psbt, input.feeAuthorization, check)
    : undefined;
  if (sentry && typeof finishFee !== 'function')
    throw new Error('Invalid PSBT fee authority');
  try {
    host.assertSoftwareSpend(summary.inputScripts, psbt.txOutputs);
    const result = await host.sdk.signPSBT(
      { psbt: PsbtUtils.toPali(psbt) },
      input.read
    );
    check();
    const signed = capturePsbtEnvelope(result);
    const signedPsbt = PsbtUtils.fromPali(signed, host.network);
    assertUtxoFeeReview(signedPsbt, summary.feeSatoshis, review);
    return await host.withSignatureRelease(async (markDisclosed) => {
      await host.assertUnprotected(() => signedPsbt, check);
      check();
      if (sentry)
        await verifyFee(
          host,
          signedPsbt,
          input.feeAuthorization,
          check,
          input.signal
        );
      check();
      finishFee?.(true);
      markDisclosed();
      return Object.freeze({ psbt: signed.psbt, assets: envelope.assets });
    });
  } finally {
    finishFee?.();
  }
}

/** One request-owned review and one signing decision; caller UI never owns its bytes. */
export async function preparePsbtApproval(
  host: PsbtApprovalHost,
  request: Readonly<{
    feeAuthorization: unknown;
    method: PsbtApprovalMethod;
    origin: string;
    psbt: unknown;
  }>
): Promise<PreparedPsbtApproval> {
  checkHost(host);
  if (
    [
      host.readAssetMetadata,
      host.broadcast?.owner,
      host.broadcast?.withAdmission,
    ].some((port) => typeof port !== 'function') ||
    !host.broadcast.records ||
    !host.broadcast.session ||
    !['sys_sign', 'sys_signAndSend'].includes(request.method) ||
    typeof request.origin !== 'string' ||
    !request.origin ||
    request.origin.length > 2048
  )
    throw new Error('Explicit PSBT approval ports are required');
  const method = request.method,
    origin = request.origin,
    feeAuthorization = request.feeAuthorization;
  const envelope = capturePsbtEnvelope(request.psbt);
  const network = Object.freeze({ ...host.network });
  const capturedHost = { ...host, network };
  const controller = new AbortController();
  const submission = createUtxoSubmissionDisposition();
  let disposed = false,
    used = false;
  const check = () => {
    assertSynchronousEvmFeeGuard(host.assertCurrent);
    if (disposed || controller.signal.aborted)
      throw new Error('PSBT approval was cancelled');
  };
  const dispose = () => {
    disposed = true;
    controller.abort();
  };
  try {
    check();
    const { psbt, summary } = await host.withRead(
      check,
      controller.signal,
      (read) => verifyPsbtEnvelope(network, envelope, read, check)
    );
    if (
      method === 'sys_signAndSend' &&
      syscoinTransactionTypes.isPoDATx(psbt.version)
    )
      throw new Error(
        'This wallet can sign PoDA PSBTs for external submission'
      );
    if (
      method === 'sys_signAndSend' &&
      isSentryTransactionVersion(psbt.version)
    )
      throw new Error(
        'Sentry operations require sys_sign for fee inputs and submission through the node-management service.'
      );
    const sentry = await verifyFee(
      capturedHost,
      psbt,
      feeAuthorization,
      check,
      controller.signal
    );
    const decoded = host.sdk.decodeRawTransaction(envelope);
    check();
    if (
      !Array.isArray(decoded?.vout) ||
      decoded.vout.length !== summary.outputValuesSatoshis.length
    )
      throw new Error('Decoded outputs do not match the PSBT');
    const verified = {
      ...decoded,
      feeSatoshis: summary.feeSatoshis,
      ...(sentry ? { sentry } : {}),
      syscoin: {
        ...decoded.syscoin,
        allocations: summary.assetAllocations.length
          ? { assets: summary.assetAllocations }
          : null,
        inputAssets: summary.inputAssets,
      },
    };
    const metadata: Record<string, SyscoinPsbtAssetMetadata> = {};
    const readMetadata = async (guid: string) => {
      check();
      const raw = await host.readAssetMetadata(guid, check, controller.signal);
      check();
      return capturePsbtAssetMetadata(guid, raw);
    };
    for (const guid of new Set(
      summary.assetAllocations.map((asset) => asset.assetGuid)
    ))
      metadata[guid] = await readMetadata(guid);
    const error = getSyscoinPsbtReviewError(verified, metadata);
    if (error) throw new Error(error);
    const feeReview = createUtxoFeeReview(psbt, summary.feeSatoshis);
    const binding = createUtxoTransactionBinding(
      psbt,
      summary.feeSatoshis,
      check
    );
    const assetRows = getAssetReviewRows(verified, metadata);
    const review: PsbtApprovalReview = Object.freeze({
      method,
      origin,
      feeSatoshis: summary.feeSatoshis,
      unsignedHash: feeReview.unsignedHash,
      transactionType: decoded.syscoin?.txtype || 'bitcoin',
      transactionOptions: reviewUtxoTransactionOptions(
        inspectUtxoRbf(psbt.txInputs),
        summary.assetAllocations.length > 0
      ),
      complete: psbt.data.inputs.every(
        (input) => !!(input.finalScriptSig || input.finalScriptWitness)
      ),
      inputs: Object.freeze(
        psbt.txInputs.map((input, index) => {
          const valueSatoshis = summary.inputValuesSatoshis[index];
          const script = summary.inputScripts[index];
          if (valueSatoshis === undefined || script === undefined)
            throw new Error('Verified PSBT input is missing');
          return Object.freeze({
            txid: Buffer.from(input.hash).reverse().toString('hex'),
            vout: input.index,
            valueSatoshis,
            scriptHex: Buffer.from(script).toString('hex'),
          });
        })
      ),
      outputs: Object.freeze(
        psbt.txOutputs.map((output, index) => {
          const valueSatoshis = summary.outputValuesSatoshis[index];
          if (valueSatoshis === undefined)
            throw new Error('Verified PSBT output is missing');
          return Object.freeze({
            index,
            address: getCanonicalOutputRecipient(decoded.vout[index]) || null,
            scriptHex: Buffer.from(output.script).toString('hex'),
            valueSatoshis,
            assets: Object.freeze(
              assetRows
                .filter((row) => row.outputIndex === index)
                .map((row) =>
                  Object.freeze({
                    assetGuid: row.assetGuid,
                    rawAmount: row.rawAmount,
                    amount: row.amount,
                    symbol: row.symbol,
                    isBurn: row.isBurn,
                  })
                )
            ),
          });
        })
      ),
      sentry,
    });
    check();
    return Object.freeze({
      review,
      assertCurrent: check,
      disposition: submission.read,
      dispose,
      async approve() {
        check();
        if (used) throw new Error('This PSBT approval was already used');
        used = true;
        for (const guid of Object.keys(metadata)) {
          if (
            JSON.stringify(await readMetadata(guid)) !==
            JSON.stringify(metadata[guid])
          )
            throw new Error(
              'PSBT asset metadata changed. Review the transaction again.'
            );
        }
        const signed = await signReviewedPsbt(capturedHost, {
          psbt: envelope,
          review: feeReview,
          feeAuthorization,
          signal: controller.signal,
          assertCurrent: check,
        });
        check();
        if (method === 'sys_sign') return signed;
        const finalized = PsbtUtils.fromPali(signed, network);
        const transaction = binding.bindSigned(finalized);
        await host.assertUnprotected(() => finalized, check);
        check();
        const owner = host.broadcast.owner();
        check();
        const record = Object.freeze({
          owner,
          operation: 'external' as const,
          url: utxoSubmissionUrl(network.url),
          ...transaction,
        });
        return host.broadcast.withAdmission(async (fetch) => {
          await host.assertUnprotected(() => finalized, check);
          check();
          return submitReviewedUtxo({
            record,
            sender: host.sdk,
            records: host.broadcast.records,
            session: {
              ...host.broadcast.session,
              assertCurrent() {
                check();
                assertSynchronousEvmFeeGuard(
                  host.broadcast.session.assertCurrent
                );
                check();
              },
            },
            fetch: submission.trackPost(record, fetch),
          });
        });
      },
    });
  } catch (error) {
    dispose();
    throw error;
  }
}
