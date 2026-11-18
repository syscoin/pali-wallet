import { Interface } from 'ethers';

import { MAX_PRIVACY_RELAY_TRANSACTIONS } from './withdrawalTransactionTypes.ts';

// The caller must bind the journal and identity to a freshly re-read encrypted
// note under the persistence mutex and revalidate immediately before storage.
const ABI = new Interface([
  'event Withdrawal(address to, bytes32 nullifierHash, address indexed relayer, uint256 fee)',
]);
const HASH = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;
const DECIMAL = /^(?:0|[1-9][0-9]{0,19})$/;
const MAX_RECEIPT_LOGS = 4096;
const MAX_RUN_MS = 15000;

// The injected transport must enforce a finite raw-response byte cap before
// JSON parsing, avoid logging private request context, and honor abort signals.
type Rpc = (
  method: string,
  params: unknown[],
  signal: AbortSignal
) => Promise<unknown>;
type SubmittedWithdrawal = { phase: 'submitted'; transactionHash: string } & (
  | { from: string; mode: 'direct'; nonce: string }
  | {
      from?: never;
      mode: 'relayed';
      nonce?: never;
      transactionHashes?: readonly string[];
    }
);
interface ISubmittedDeposit {
  from: string;
  nonce: string;
  phase: 'submitted';
  transactionHash: string;
}
interface ISpentCompletionRequest {
  assertCurrent: () => void;
  deposit?: ISubmittedDeposit;
  nullifierHash: string; // Kept local; never put into RPC arguments.
  poolAddress: string;
  rpc: Rpc;
  withdrawal: SubmittedWithdrawal;
}
export type SpentCompletionRequest = ISpentCompletionRequest;
const lower = (x: unknown) => (typeof x === 'string' ? x.toLowerCase() : '');
const obj = (x: unknown): Record<string, any> => {
  if (!x || typeof x !== 'object' || Array.isArray(x))
    throw new Error('invalid');
  return x as Record<string, any>;
};
const quantity = (x: unknown): bigint => {
  if (typeof x !== 'string' || x.length > 66 || !QUANTITY.test(x))
    throw new Error('invalid');
  return BigInt(x);
};
const expectedAccount = (from: unknown, nonce: unknown) => {
  if (
    !ADDRESS.test(lower(from)) ||
    typeof nonce !== 'string' ||
    !DECIMAL.test(nonce) ||
    BigInt(nonce) >= BigInt(1) << BigInt(64)
  )
    throw new Error('invalid');
};

/**
 * Proves receipt-level finality against the configured RPC, not the privacy
 * service. Tx-hash-specific requests still disclose that public transaction to
 * the RPC; checking a related deposit hash can also link deposit to withdrawal.
 * The caller must obtain user consent before invoking this function.
 * No note preimage or nullifier is sent to the RPC. The RPC and Ethereum
 * finality are trust assumptions; this is not a cryptographic receipt proof.
 */
export async function prepareSpentCompletion(
  req: SpentCompletionRequest
): Promise<{ revalidate: () => Promise<void> }> {
  const pool = lower(req.poolAddress),
    nullifier = lower(req.nullifierHash);
  const rpc = req.rpc,
    assertCurrent = req.assertCurrent;
  if (typeof rpc !== 'function' || typeof assertCurrent !== 'function')
    throw new Error('privacy_spent_proof_unavailable');
  if (
    !ADDRESS.test(pool) ||
    !HASH.test(nullifier) ||
    !req.withdrawal ||
    req.withdrawal.phase !== 'submitted' ||
    !HASH.test(lower(req.withdrawal.transactionHash)) ||
    !['direct', 'relayed'].includes(req.withdrawal.mode)
  )
    throw new Error('privacy_spent_proof_unavailable');
  const w = {
    ...req.withdrawal,
    transactionHash: lower(req.withdrawal.transactionHash),
    from: lower(req.withdrawal.from),
  };
  if (w.mode === 'direct') expectedAccount(w.from, w.nonce);
  else if (
    req.withdrawal.from !== undefined ||
    req.withdrawal.nonce !== undefined
  )
    throw new Error('privacy_spent_proof_unavailable');
  const d = req.deposit
    ? {
        ...req.deposit,
        transactionHash: lower(req.deposit.transactionHash),
        from: lower(req.deposit.from),
      }
    : undefined;
  if (d && (d.phase !== 'submitted' || !HASH.test(d.transactionHash)))
    throw new Error('privacy_spent_proof_unavailable');
  if (d) expectedAccount(d.from, d.nonce);
  const candidates =
    req.withdrawal.mode === 'relayed' &&
    req.withdrawal.transactionHashes !== undefined
      ? [...req.withdrawal.transactionHashes]
      : [w.transactionHash];
  if (
    !candidates.length ||
    candidates.length > MAX_PRIVACY_RELAY_TRANSACTIONS ||
    candidates[0] !== w.transactionHash ||
    candidates.some((hash) => !HASH.test(hash)) ||
    new Set(candidates).size !== candidates.length
  )
    throw new Error('privacy_spent_proof_unavailable');
  type Evidence = {
    anchor: { hash: string; number: string };
    blockHash: string;
    blockNumber: string;
    event: string;
    hash: string;
  };
  let evidence: Evidence | undefined;

  const run = async () => {
    const deadline = Date.now() + MAX_RUN_MS;
    const activeReads = new Set<AbortController>();
    let retired = false;
    const read = async (
      method: string,
      params: unknown[],
      candidate = false
    ) => {
      assertCurrent();
      if (retired) throw new Error('invalid');
      // A multi-candidate lookup reserves time for the final canonical checks.
      const remaining =
        deadline - Date.now() - (candidate && candidates.length > 1 ? 4000 : 0);
      if (remaining <= 0) throw new Error('invalid');
      const controller = new AbortController();
      activeReads.add(controller);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let removeAbort: () => void = () => undefined;
      try {
        const timeout = new Promise<never>((_resolve, reject) => {
          const abort = () => reject(new Error('invalid'));
          controller.signal.addEventListener('abort', abort, { once: true });
          removeAbort = () =>
            controller.signal.removeEventListener('abort', abort);
          timer = setTimeout(() => controller.abort(), remaining);
        });
        const result = await Promise.race([
          rpc(method, params, controller.signal),
          timeout,
        ]);
        assertCurrent();
        if (retired) throw new Error('invalid');
        return result;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        removeAbort();
        activeReads.delete(controller);
      }
    };
    if ((await read('eth_chainId', [])) !== '0x1') throw new Error('invalid');
    const finalized = obj(
      await read('eth_getBlockByNumber', ['finalized', false])
    );
    const finalizedNumber = quantity(finalized.number);
    if (!HASH.test(lower(finalized.hash))) throw new Error('invalid');
    const anchor = evidence?.anchor ?? {
      number: finalized.number,
      hash: lower(finalized.hash),
    };
    const finalizedAtHeight = obj(
      await read('eth_getBlockByNumber', [anchor.number, false])
    );
    if (
      finalizedAtHeight.number !== anchor.number ||
      quantity(anchor.number) > finalizedNumber ||
      lower(finalizedAtHeight.hash) !== anchor.hash
    )
      throw new Error('invalid');

    const blocks = new Map<string, Promise<Record<string, any>>>();
    const verify = async (
      hash: string,
      account?: { from?: string; nonce?: string },
      requireEvent = false,
      candidate = false
    ) => {
      const value = await read('eth_getTransactionReceipt', [hash], candidate);
      if (candidate && value === null) return null;
      const receipt = obj(value);
      if (
        lower(receipt.transactionHash) !== hash ||
        !HASH.test(lower(receipt.blockHash)) ||
        (receipt.status !== '0x0' && receipt.status !== '0x1')
      )
        throw new Error('invalid');
      const blockNumber = quantity(receipt.blockNumber);
      if (
        blockNumber > quantity(anchor.number) ||
        (requireEvent && receipt.status !== '0x1')
      ) {
        if (candidate) return null;
        throw new Error('invalid');
      }
      let block = blocks.get(receipt.blockNumber);
      if (!block) {
        block = read(
          'eth_getBlockByNumber',
          [receipt.blockNumber, false],
          candidate
        ).then(obj);
        blocks.set(receipt.blockNumber, block);
      }
      const canonical = await block;
      if (
        quantity(canonical.number) !== blockNumber ||
        lower(canonical.hash) !== lower(receipt.blockHash)
      )
        throw new Error('invalid');
      if (account) {
        const tx = obj(await read('eth_getTransactionByHash', [hash]));
        if (
          lower(tx.hash) !== hash ||
          lower(tx.from) !== account.from ||
          quantity(tx.nonce) !== BigInt(account.nonce!) ||
          lower(tx.blockHash) !== lower(receipt.blockHash) ||
          quantity(tx.blockNumber) !== blockNumber
        )
          throw new Error('invalid');
      }
      let event = '';
      if (requireEvent) {
        if (
          !Array.isArray(receipt.logs) ||
          receipt.logs.length > MAX_RECEIPT_LOGS
        )
          throw new Error('invalid');
        const matching = receipt.logs.filter((item: unknown) => {
          try {
            const log = obj(item);
            if (
              lower(log.address) !== pool ||
              lower(log.transactionHash) !== hash ||
              lower(log.blockHash) !== lower(receipt.blockHash) ||
              quantity(log.blockNumber) !== blockNumber ||
              (log.removed !== undefined && log.removed !== false) ||
              !Array.isArray(log.topics) ||
              log.topics.length !== 2 ||
              !log.topics.every((topic: unknown) => HASH.test(lower(topic))) ||
              typeof log.data !== 'string' ||
              !/^0x[0-9a-fA-F]{192}$/.test(log.data)
            )
              return false;
            const parsed = ABI.parseLog({ topics: log.topics, data: log.data });
            return (
              parsed?.name === 'Withdrawal' &&
              lower(parsed.args.nullifierHash) === nullifier
            );
          } catch {
            return false;
          }
        });
        if (matching.length !== 1) {
          if (candidate) return null;
          throw new Error('invalid');
        }
        event = JSON.stringify([
          lower(matching[0].data),
          matching[0].topics.map(lower),
        ]);
      }
      return {
        anchor,
        hash,
        blockHash: lower(receipt.blockHash),
        blockNumber: receipt.blockNumber as string,
        event,
      };
    };
    let selected: Evidence | null = null;
    if (evidence || candidates.length === 1) {
      selected = await verify(
        evidence?.hash ?? w.transactionHash,
        w.mode === 'direct' ? w : undefined,
        true
      );
    } else {
      // Four bounded workers share block reads and the operation deadline.
      let next = 0;
      try {
        await Promise.all(
          Array.from({ length: Math.min(4, candidates.length) }, async () => {
            while (!selected && next < candidates.length) {
              const index = next++;
              try {
                const value = await verify(
                  candidates[index]!,
                  undefined,
                  true,
                  true
                );
                if (value && !selected) {
                  selected = value;
                  // A verified replacement ends hint exploration. Peers cannot
                  // hold it hostage with a missing or stalled unrelated hash.
                  for (const controller of activeReads) controller.abort();
                }
              } catch {
                // Hints are not authority: a failed candidate cannot veto an
                // independently verified event. Owner retirement still aborts.
                assertCurrent();
              }
            }
          })
        );
      } catch (error) {
        retired = true;
        for (const controller of activeReads) controller.abort();
        throw error;
      }
    }
    if (
      !selected ||
      (evidence && JSON.stringify(selected) !== JSON.stringify(evidence))
    )
      throw new Error('invalid');
    if (d) await verify(d.transactionHash, d);
    // Check that the exact finalized anchor has not changed during the reads.
    const after = obj(
      await read('eth_getBlockByNumber', [anchor.number, false])
    );
    if (after.number !== anchor.number || lower(after.hash) !== anchor.hash)
      throw new Error('invalid');
    if (candidates.length > 1 && (await read('eth_chainId', [])) !== '0x1')
      throw new Error('invalid');
    assertCurrent();
    evidence = selected;
  };
  const revalidate = async () => {
    try {
      await run();
    } catch {
      throw new Error('privacy_spent_proof_unavailable');
    }
  };
  await revalidate();
  return { revalidate };
}
