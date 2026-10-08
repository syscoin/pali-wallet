import { ITokenEthProps } from 'types/tokens';
import { Contract, formatUnits, id } from 'utils/ethersV6Compat';

type RefreshJob = {
  attempt: number;
  block: number;
  due: number;
  run: (isCurrent: () => boolean) => Promise<void>;
};

// SYSCOIN: Receipt-driven reads are bounded, coalesced per account/chain/asset,
// and silent when idle. A successful unchanged balance is still success.
export class ReceiptBalanceRefresh {
  private jobs = new Map<string, RefreshJob>();
  private completed = new Map<string, number>();
  private running = new Set<RefreshJob>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;

  schedule(key: string, block: number, run: RefreshJob['run']) {
    if (!Number.isSafeInteger(block) || block <= 0) return;
    if ((this.completed.get(key) || 0) >= block) return;
    const previous = this.jobs.get(key);
    if (previous && previous.block >= block) return;
    if (!previous && this.jobs.size >= 256) return;
    this.jobs.set(key, { attempt: 0, block, due: Date.now() + 100, run });
    this.pump();
  }

  cancel() {
    this.generation += 1;
    this.jobs.clear();
    this.completed.clear();
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private pump() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const generation = this.generation;
    for (const [key, job] of this.jobs) {
      if (this.running.size >= 3) break;
      if (this.running.has(job) || job.due > Date.now()) continue;
      this.running.add(job);
      const isCurrent = () =>
        generation === this.generation && this.jobs.get(key) === job;
      void Promise.resolve()
        .then(() => (isCurrent() ? job.run(isCurrent) : undefined))
        .then(() => {
          if (!isCurrent()) return;
          this.jobs.delete(key);
          this.completed.delete(key);
          this.completed.set(key, job.block);
          if (this.completed.size > 512) {
            this.completed.delete(this.completed.keys().next().value!);
          }
        })
        .catch(() => {
          if (!isCurrent()) return;
          // Only RPC errors (including a node behind the receipt block) retry.
          const retryDelay = [250, 1000, 3000][job.attempt++];
          if (retryDelay === undefined) this.jobs.delete(key);
          else job.due = Date.now() + retryDelay;
        })
        .finally(() => {
          this.running.delete(job);
          this.pump();
        });
    }
    const waiting = [...this.jobs.values()].filter(
      (job) => !this.running.has(job)
    );
    if (waiting.length && this.running.size < 3) {
      const nextDue = Math.min(...waiting.map((job) => job.due));
      this.timer = setTimeout(
        () => this.pump(),
        Math.max(0, nextDue - Date.now())
      );
    }
  }
}

export const tokenBalanceKey = (token: ITokenEthProps) =>
  `${token.contractAddress.toLowerCase()}:${token.tokenStandard || 'ERC-20'}:${
    token.tokenId || ''
  }`;

// No name/symbol/decimals metadata requests on the receipt hot path.
export const readTrackedTokenBalance = async (
  provider: any,
  address: string,
  token: ITokenEthProps,
  blockTag: number | 'latest' = 'latest'
): Promise<Pick<ITokenEthProps, 'balance' | 'rawBalance'>> => {
  const is1155 = token.tokenStandard === 'ERC-1155';
  const contract = new Contract(
    token.contractAddress,
    [
      is1155
        ? 'function balanceOf(address,uint256) view returns (uint256)'
        : 'function balanceOf(address) view returns (uint256)',
    ],
    provider
  );
  const raw = is1155
    ? await contract.balanceOf(address, token.tokenId, { blockTag })
    : await contract.balanceOf(address, { blockTag });
  const balance = Number(formatUnits(raw, token.isNft ? 0 : token.decimals));
  if (!Number.isFinite(balance) || balance < 0)
    throw new Error('Invalid balance');
  return { balance, rawBalance: raw.toString() };
};

const address = (value: unknown): string =>
  typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value)
    ? value.toLowerCase()
    : '';
const TRANSFER =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const TRANSFER_SINGLE = id(
  'TransferSingle(address,address,address,uint256,uint256)'
);
const TRANSFER_BATCH = id(
  'TransferBatch(address,address,address,uint256[],uint256[])'
);

// API token-history rows and direct EOA/AA receipts both reach this planner.
// Only known local accounts and already-tracked contracts are refreshed.
export const receiptBalanceTargets = (tx: any) => {
  const tokens = new Set<string>();
  const owners = new Set<string>();
  const native = new Set<string>();
  const add = (set: Set<string>, value: unknown) => {
    const parsed = address(value);
    if (parsed) set.add(parsed);
  };
  const list = (value: unknown): any[] =>
    Array.isArray(value) ? value.slice(0, 2048) : [];
  if (!tx.smartAccountExecutionFrom) {
    add(owners, tx.from);
    add(owners, tx.to);
  }
  add(owners, tx.smartAccountExecutionFrom);
  add(owners, tx.tokenRecipient);
  add(native, tx.from); // the actual outer EOA gas payer, also on failed receipts
  try {
    if (BigInt(tx.value || 0) > BigInt(0) && !tx.contractAddress)
      add(native, tx.to);
  } catch {
    // Malformed explorer amounts do not invalidate other receipt evidence.
  }
  for (const value of list(tx.balanceRefreshNativeAddresses)) {
    add(native, value);
  }
  for (const value of list(tx.balanceRefreshTokenAddresses)) add(tokens, value);
  add(tokens, tx.contractAddress);
  if (!tx.smartAccountExecutionFrom) add(tokens, tx.to);
  for (const log of list(tx.logs || tx.receipt?.logs)) {
    if (!log || typeof log !== 'object') continue;
    add(tokens, log.address);
    const topics = list(log.topics);
    const signature =
      typeof topics[0] === 'string' ? topics[0].toLowerCase() : '';
    if ([TRANSFER, TRANSFER_SINGLE, TRANSFER_BATCH].includes(signature)) {
      const offset = signature === TRANSFER ? 1 : 2;
      for (const topic of topics.slice(offset, offset + 2)) {
        if (typeof topic === 'string' && /^0x0{24}[0-9a-f]{40}$/i.test(topic))
          add(owners, `0x${topic.slice(-40)}`);
      }
    }
  }
  return { native, owners, tokens };
};
