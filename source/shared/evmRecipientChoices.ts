export type EvmRecipientChoice = Readonly<{ address: string; label: string }>;

const LIMIT = 10;

/** Search compatible local accounts without consulting transaction or RPC data. */
export function findLocalEvmRecipientChoices(
  accounts: readonly Readonly<{ address: string; label?: unknown }>[],
  query: string
): EvmRecipientChoice[] {
  const search = query.toLowerCase();
  const matches: EvmRecipientChoice[] = [];
  const seen = new Set<string>();
  for (const account of accounts) {
    const { address, label: savedLabel } = account;
    if (typeof address !== 'string' || !/^0x[0-9a-f]{40}$/i.test(address))
      continue;
    const key = address.toLowerCase();
    const label =
      typeof savedLabel === 'string' && savedLabel ? savedLabel : address;
    if (
      seen.has(key) ||
      (search && !key.includes(search) && !label.toLowerCase().includes(search))
    )
      continue;
    matches.push({ address, label });
    seen.add(key);
    if (matches.length === LIMIT) break;
  }
  return matches;
}
