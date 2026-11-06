import {
  getSyscoinUTXOMainnetNetwork,
  getSyscoinUTXOTestnetNetwork,
} from '../utils/defaultNetworks.ts';

const syscoinMainnet = getSyscoinUTXOMainnetNetwork().chainId;
const syscoinTestnet = getSyscoinUTXOTestnetNetwork().chainId;
const ZERO = BigInt(0);
// SPT wire values are at most 64 bits. Blockbook also reports cumulative
// big.Int counters, so allow 256-bit-scale text while bounding parsing work.
const MAX_INTEGER_DIGITS = 78;

/** Apply to the captured UTXO registration, not the generic SDK family. */
export function supportsSptUtxoChain(chainId: number): boolean {
  return chainId === syscoinMainnet || chainId === syscoinTestnet;
}

export type SptHolding = Readonly<{
  assetGuid: string;
  confirmedUnits: bigint;
  decimals: number;
  metadata: Readonly<Record<string, unknown>>;
  pendingDeltaUnits: bigint;
  receivedUnits: bigint;
  sentUnits: bigint;
  transfers: number;
  utxoCount: number;
}>;

type SptInventory = Readonly<{
  holdings: ReadonlyMap<string, SptHolding>;
  lookup(assetGuid: string): SptHolding | undefined;
}>;

const invalid = () =>
  new Error('SPT token inventory is unavailable or invalid');

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalid();
  return value as Record<string, unknown>;
}

function integer(value: unknown, signed = false): bigint {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    (typeof value === 'number' && !Number.isSafeInteger(value))
  )
    throw invalid();
  const text = String(value);
  const signLength = signed && text.startsWith('-') ? 1 : 0;
  if (
    text.length > MAX_INTEGER_DIGITS + signLength ||
    text !== text.trim() ||
    !(signed ? /^-?\d+$/ : /^\d+$/).test(text)
  )
    throw invalid();
  return BigInt(text);
}

function count(value: unknown): number {
  const result = Number(integer(value));
  if (!Number.isSafeInteger(result)) throw invalid();
  return result;
}

const optionalInteger = (value: unknown, signed = false) =>
  value === undefined ? ZERO : integer(value, signed);

/** A complete account response can establish zero. A failed or partial read cannot. */
export function parseSptInventory(
  value: unknown,
  expectedIdentifier: string
): SptInventory {
  const account = record(value);
  if ('error' in account) throw invalid();
  const identifier = account.addressOrXpub ?? account.address;
  if (
    (account.addressOrXpub !== undefined &&
      account.addressOrXpub !== expectedIdentifier) ||
    (account.address !== undefined && account.address !== expectedIdentifier)
  )
    throw invalid();
  const requireCompleteSummary = () => {
    if (!expectedIdentifier || identifier !== expectedIdentifier)
      throw invalid();
    integer(account.balance);
    integer(account.unconfirmedBalance, true);
    count(account.txs);
    count(account.unconfirmedTxs);
  };
  let rows: readonly unknown[] = [];
  if (account.tokensAsset !== undefined) {
    if (!Array.isArray(account.tokensAsset)) throw invalid();
    rows = account.tokensAsset;
  }
  const holdings = new Map<string, SptHolding>();
  // An omitted list and an explicitly empty list have the same evidence gate.
  if (!rows.length) requireCompleteSummary();
  for (const item of rows) {
    const row = record(item);
    const assetGuid = integer(row.assetGuid).toString();
    const decimals = row.decimals;
    const previous = holdings.get(assetGuid);
    if (
      typeof decimals !== 'number' ||
      !Number.isSafeInteger(decimals) ||
      decimals < 0 ||
      decimals > 8 ||
      (previous && previous.decimals !== decimals)
    )
      throw invalid();
    const transfers =
      (previous?.transfers ?? 0) +
      count(row.transfers === undefined ? 0 : row.transfers);
    if (!Number.isSafeInteger(transfers)) throw invalid();
    holdings.set(assetGuid, {
      assetGuid,
      confirmedUnits: (previous?.confirmedUnits ?? ZERO) + integer(row.balance),
      decimals,
      metadata: previous?.metadata ?? row,
      pendingDeltaUnits:
        (previous?.pendingDeltaUnits ?? ZERO) +
        optionalInteger(row.unconfirmedBalance, true),
      receivedUnits:
        (previous?.receivedUnits ?? ZERO) + optionalInteger(row.totalReceived),
      sentUnits: (previous?.sentUnits ?? ZERO) + optionalInteger(row.totalSent),
      transfers,
      utxoCount: (previous?.utxoCount ?? 0) + 1,
    });
  }
  return {
    holdings,
    lookup(assetGuid) {
      const holding = holdings.get(assetGuid);
      if (!holding) requireCompleteSummary();
      return holding;
    },
  };
}
