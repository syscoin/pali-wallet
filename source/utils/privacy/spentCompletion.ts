import { Interface } from 'ethers';

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
  | { mode: 'direct'; from: string; nonce: string }
  | { mode: 'relayed'; from?: never; nonce?: never }
);
interface SubmittedDeposit {
  phase: 'submitted';
  transactionHash: string;
  from: string;
  nonce: string;
}
export interface SpentCompletionRequest {
  poolAddress: string;
  nullifierHash: string; // Kept local; never put into RPC arguments.
  withdrawal: SubmittedWithdrawal;
  deposit?: SubmittedDeposit;
  rpc: Rpc;
  assertCurrent: () => void;
}
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

  const run = async () => {
    const deadline = Date.now() + MAX_RUN_MS;
    const read = async (method: string, params: unknown[]) => {
      assertCurrent();
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('invalid');
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('invalid'));
          }, remaining);
        });
        const result = await Promise.race([
          rpc(method, params, controller.signal),
          timeout,
        ]);
        assertCurrent();
        return result;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    };
    if ((await read('eth_chainId', [])) !== '0x1') throw new Error('invalid');
    const finalized = obj(
      await read('eth_getBlockByNumber', ['finalized', false])
    );
    const finalizedNumber = quantity(finalized.number);
    if (!HASH.test(lower(finalized.hash))) throw new Error('invalid');
    const finalizedAtHeight = obj(
      await read('eth_getBlockByNumber', [finalized.number, false])
    );
    if (
      quantity(finalizedAtHeight.number) !== finalizedNumber ||
      lower(finalizedAtHeight.hash) !== lower(finalized.hash)
    )
      throw new Error('invalid');

    const verify = async (
      hash: string,
      account?: { from?: string; nonce?: string },
      requireEvent = false
    ) => {
      const receipt = obj(await read('eth_getTransactionReceipt', [hash]));
      if (
        lower(receipt.transactionHash) !== hash ||
        !HASH.test(lower(receipt.blockHash)) ||
        (receipt.status !== '0x0' && receipt.status !== '0x1')
      )
        throw new Error('invalid');
      const blockNumber = quantity(receipt.blockNumber);
      if (
        blockNumber > finalizedNumber ||
        (requireEvent && receipt.status !== '0x1')
      )
        throw new Error('invalid');
      const canonical = obj(
        await read('eth_getBlockByNumber', [receipt.blockNumber, false])
      );
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
      if (requireEvent) {
        if (
          !Array.isArray(receipt.logs) ||
          receipt.logs.length > MAX_RECEIPT_LOGS
        )
          throw new Error('invalid');
        const matching = receipt.logs.filter((candidate: unknown) => {
          try {
            const log = obj(candidate);
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
        if (matching.length !== 1) throw new Error('invalid');
      }
    };
    await verify(w.transactionHash, w.mode === 'direct' ? w : undefined, true);
    if (d) await verify(d.transactionHash, d);
    // Check that the exact finalized anchor has not changed during the reads.
    const after = obj(
      await read('eth_getBlockByNumber', [finalized.number, false])
    );
    if (
      quantity(after.number) !== finalizedNumber ||
      lower(after.hash) !== lower(finalized.hash)
    )
      throw new Error('invalid');
    assertCurrent();
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
