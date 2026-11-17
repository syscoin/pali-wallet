import { AbiCoder, Interface, keccak256 } from 'ethers';
import { Transaction } from 'ethers/transaction';

import { FIELD_SIZE } from './merkle.ts';
import {
  captureWithdrawalPublicInputs,
  captureWithdrawalRootAnchor,
} from './withdrawalMetadata.ts';
import type {
  IPrivacyWithdrawalJournal,
  IPrivacyWithdrawalPublicInputs,
  IPrivacyWithdrawalRecoveryReceipt,
} from './withdrawalTransactionTypes';

const ABI = new Interface([
  'function withdraw(bytes proof,bytes32 root,bytes32 nullifierHash,address recipient,address relayer,uint256 fee,uint256 refund)',
  'function isKnownRoot(bytes32 root) view returns (bool)',
  'function isSpent(bytes32 nullifierHash) view returns (bool)',
]);
const HASH = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;
const FALSE = '0x' + '0'.repeat(64);
const TRUE = '0x' + '0'.repeat(63) + '1';
const invalid = (): never => {
  throw new Error('privacy_withdrawal_recovery_unavailable');
};
const lower = (value: unknown) =>
  typeof value === 'string' ? value.toLowerCase() : '';
const object = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  return value as Record<string, any>;
};
const quantity = (value: unknown): bigint => {
  if (typeof value !== 'string' || value.length > 66 || !QUANTITY.test(value))
    return invalid();
  return BigInt(value);
};

export interface IWithdrawalRecoveryRequest {
  assertCurrent: () => void;
  nullifierHash: string;
  poolAddress: string;
  /** Exact bytes loaded from authenticated custody, never supplied by a renderer. */
  readOriginalRawTransaction?: () => Promise<string | null>;
  /** Background-only lookup for older, hash-bound known relayer jobs. */
  readRelayedPublicInputs?: (
    signal: AbortSignal
  ) => Promise<IPrivacyWithdrawalPublicInputs | null>;
  rpc: (
    method: string,
    params: unknown[],
    signal: AbortSignal
  ) => Promise<unknown>;
  withdrawal: IPrivacyWithdrawalJournal;
}

/**
 * Explicit, privacy-sensitive recovery only. A reverted transaction alone is
 * insufficient: its disclosed proof remains usable until its root is evicted.
 * A displaced, never-mined original also requires its authenticated signed
 * bytes and finalized consumption of that payer nonce.
 * The pinned Classic pools only append to their trees; an evicted historical
 * root cannot return absent a hash collision. This retains the configured RPC
 * and Ethereum finality assumptions, not a trustless receipt proof.
 */
export async function prepareWithdrawalRecovery(
  req: IWithdrawalRecoveryRequest
): Promise<{
  publicInputs?: Readonly<IPrivacyWithdrawalPublicInputs>;
  receipt: IPrivacyWithdrawalRecoveryReceipt;
  revalidate: () => Promise<void>;
}> {
  try {
    const pool = lower(req.poolAddress),
      nullifier = lower(req.nullifierHash);
    const w = { ...req.withdrawal };
    if (
      !ADDRESS.test(pool) ||
      !HASH.test(nullifier) ||
      !w ||
      !['direct', 'relayed'].includes(w.mode) ||
      !['submitted', 'unknown'].includes(w.phase) ||
      w.recovery ||
      w.unsigned ||
      !HASH.test(lower(w.proofHash)) ||
      !HASH.test(lower(w.inputHash)) ||
      (w.mode === 'relayed' &&
        !w.publicInputs &&
        !req.readRelayedPublicInputs) ||
      (w.mode === 'direct' &&
        (w.phase !== 'submitted' ||
          !HASH.test(lower(w.transactionHash)) ||
          !ADDRESS.test(lower(w.from)) ||
          typeof w.nonce !== 'string' ||
          !/^(?:0|[1-9][0-9]{0,19})$/.test(w.nonce) ||
          BigInt(w.nonce) >= BigInt(1) << BigInt(64))) ||
      typeof req.rpc !== 'function' ||
      typeof req.assertCurrent !== 'function'
    )
      return invalid();
    const transactionHash = lower(w.transactionHash);
    let publicInputs: Readonly<IPrivacyWithdrawalPublicInputs> | undefined =
      w.mode === 'relayed' && w.publicInputs
        ? captureWithdrawalPublicInputs(w.publicInputs, w.inputHash)
        : undefined;
    // Missing legacy provenance is not evidence that a root has expired.
    const origin =
      w.mode === 'relayed'
        ? captureWithdrawalRootAnchor(w.rootAnchor, publicInputs?.root)
        : undefined;
    const nonce = w.nonce!;
    const readOriginal = req.readOriginalRawTransaction;
    let original: Record<string, unknown> | undefined;
    let receiptWasMissing: boolean | undefined;
    const run = async (evidence?: IPrivacyWithdrawalRecoveryReceipt) => {
      const deadline = Date.now() + 15000;
      const owned = async <T>(work: (signal: AbortSignal) => Promise<T>) => {
        req.assertCurrent();
        const remaining = deadline - Date.now();
        if (remaining <= 0) return invalid();
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const value = await Promise.race([
            work(controller.signal),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => {
                controller.abort();
                reject(new Error('expired'));
              }, remaining);
            }),
          ]);
          req.assertCurrent();
          return value;
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      };
      const read = (method: string, params: unknown[]) =>
        owned((signal) => req.rpc(method, params, signal));
      if (w.mode === 'relayed') {
        if (!publicInputs) {
          const captured = req.readRelayedPublicInputs
            ? await owned(req.readRelayedPublicInputs)
            : null;
          publicInputs = captureWithdrawalPublicInputs(captured, w.inputHash);
        }
        if (
          publicInputs.root !== origin!.root ||
          publicInputs.nullifierHash !== nullifier ||
          BigInt(publicInputs.relayer) === BigInt(0)
        )
          return invalid();
      }
      if ((await read('eth_chainId', [])) !== '0x1') return invalid();
      const finalized = object(
        await read('eth_getBlockByNumber', ['finalized', false])
      );
      const finalizedNumber = quantity(finalized.number);
      if (!HASH.test(lower(finalized.hash))) return invalid();
      const blockNumber = evidence
        ? '0x' + BigInt(evidence.blockNumber).toString(16)
        : finalized.number;
      const anchor = object(
        await read('eth_getBlockByNumber', [blockNumber, false])
      );
      if (
        quantity(anchor.number) > finalizedNumber ||
        anchor.number !== blockNumber ||
        !HASH.test(lower(anchor.hash)) ||
        (evidence
          ? lower(anchor.hash) !== evidence.blockHash
          : lower(anchor.hash) !== lower(finalized.hash))
      )
        return invalid();
      let root: string;
      let originTag: string | undefined;
      if (w.mode === 'relayed') {
        if (evidence && evidence.root !== publicInputs!.root) return invalid();
        root = publicInputs!.root;
        if (
          !origin ||
          origin.root !== root ||
          BigInt(origin.blockNumber) >= quantity(blockNumber)
        )
          return invalid();
        originTag = '0x' + BigInt(origin.blockNumber).toString(16);
        const positive = object(
          await read('eth_getBlockByNumber', [originTag, false])
        );
        if (
          positive.number !== originTag ||
          lower(positive.hash) !== origin.blockHash
        )
          return invalid();
        const known = await read('eth_call', [
          { to: pool, data: ABI.encodeFunctionData('isKnownRoot', [root]) },
          originTag,
        ]);
        if (lower(known) !== TRUE) return invalid();
      } else {
        const receiptValue = await read('eth_getTransactionReceipt', [
          transactionHash,
        ]);
        const missing = receiptValue === null;
        if (receiptWasMissing !== undefined && missing !== receiptWasMissing)
          return invalid();
        receiptWasMissing = missing;
        let tx: Record<string, any>;
        if (missing) {
          if (!readOriginal) return invalid();
          if (!original) {
            const raw = await owned(() => readOriginal());
            if (
              typeof raw !== 'string' ||
              raw.length > 8194 ||
              !/^0x[\da-f]+$/i.test(raw)
            )
              return invalid();
            const signed = Transaction.from(raw);
            if (
              !signed.signature ||
              !signed.hash ||
              !signed.from ||
              signed.chainId !== BigInt(1)
            )
              return invalid();
            original = Object.freeze({
              hash: signed.hash,
              from: signed.from,
              to: signed.to,
              nonce: '0x' + signed.nonce.toString(16),
              value: '0x' + signed.value.toString(16),
              input: signed.data,
              chainId: '0x1',
            });
          }
          tx = original;
          const consumed = quantity(
            await read('eth_getTransactionCount', [lower(w.from), blockNumber])
          );
          if (consumed <= BigInt(nonce) || consumed >= BigInt(1) << BigInt(64))
            return invalid();
        } else {
          const receipt = object(receiptValue);
          if (
            lower(receipt.transactionHash) !== transactionHash ||
            receipt.status !== '0x0' ||
            !HASH.test(lower(receipt.blockHash)) ||
            quantity(receipt.blockNumber) > quantity(blockNumber)
          )
            return invalid();
          const canonical = object(
            await read('eth_getBlockByNumber', [receipt.blockNumber, false])
          );
          if (
            canonical.number !== receipt.blockNumber ||
            lower(canonical.hash) !== lower(receipt.blockHash)
          )
            return invalid();
          tx = object(
            await read('eth_getTransactionByHash', [transactionHash])
          );
          if (
            lower(tx.blockHash) !== lower(receipt.blockHash) ||
            tx.blockNumber !== receipt.blockNumber
          )
            return invalid();
        }
        if (
          lower(tx.hash) !== transactionHash ||
          lower(tx.from) !== lower(w.from) ||
          lower(tx.to) !== pool ||
          quantity(tx.nonce) !== BigInt(nonce) ||
          quantity(tx.value) !== BigInt(0) ||
          (tx.chainId !== undefined && quantity(tx.chainId) !== BigInt(1)) ||
          typeof tx.input !== 'string' ||
          !/^0x[0-9a-fA-F]{1032}$/.test(tx.input)
        )
          return invalid();
        const input = lower(tx.input);
        const values = ABI.decodeFunctionData('withdraw', input);
        if (
          lower(ABI.encodeFunctionData('withdraw', values)) !== input ||
          !/^0x[0-9a-f]{512}$/.test(lower(values[0])) ||
          lower(values[2]) !== nullifier ||
          BigInt(values[4]) !== BigInt(0) ||
          values[5] !== BigInt(0) ||
          values[6] !== BigInt(0) ||
          keccak256(values[0]) !== lower(w.proofHash)
        )
          return invalid();
        root = lower(values[1]);
        if (
          !HASH.test(root) ||
          root === FALSE ||
          BigInt(root) >= FIELD_SIZE ||
          (evidence && evidence.root !== root)
        )
          return invalid();
        const inputHash = keccak256(
          AbiCoder.defaultAbiCoder().encode(
            Array(6).fill('uint256'),
            [
              values[1],
              values[2],
              values[3],
              values[4],
              values[5],
              values[6],
            ].map((value) => BigInt(value).toString())
          )
        );
        if (inputHash !== lower(w.inputHash)) return invalid();
      }
      // These calls disclose the public root/nullifier to the selected RPC.
      for (const [method, value] of [
        ['isKnownRoot', root],
        ['isSpent', nullifier],
      ] as const) {
        const result = await read('eth_call', [
          { to: pool, data: ABI.encodeFunctionData(method, [value]) },
          blockNumber,
        ]);
        if (lower(result) !== FALSE) return invalid();
      }
      if (originTag) {
        const positiveAfter = object(
          await read('eth_getBlockByNumber', [originTag, false])
        );
        if (
          positiveAfter.number !== originTag ||
          lower(positiveAfter.hash) !== origin!.blockHash
        )
          return invalid();
      }
      const after = object(
        await read('eth_getBlockByNumber', [blockNumber, false])
      );
      if (
        after.number !== blockNumber ||
        lower(after.hash) !== lower(anchor.hash)
      )
        return invalid();
      req.assertCurrent();
      return {
        ...(w.mode === 'relayed'
          ? { kind: 'relayed-proof-expired' as const }
          : {}),
        root,
        blockNumber: quantity(blockNumber).toString(),
        blockHash: lower(anchor.hash),
      };
    };
    const evidence = await run();
    const receipt = Object.freeze({ ...evidence });
    return {
      receipt,
      ...(publicInputs ? { publicInputs } : {}),
      revalidate: async () => {
        try {
          await run(evidence);
        } catch {
          return invalid();
        }
      },
    };
  } catch {
    return invalid();
  }
}
