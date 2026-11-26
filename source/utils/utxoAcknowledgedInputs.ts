/** A short UI catch-up fence, not an assertion about consensus spendability. */
export const UTXO_ACKNOWLEDGED_INPUTS_WINDOW_MS = 2 * 60 * 1000;
export const UTXO_NETWORK_CATCHING_UP = 'UTXO_NETWORK_CATCHING_UP';

export type UtxoAcknowledgedReplacement = Readonly<{
  kind: 'speed-up' | 'cancel';
  originalTxid: string;
}>;

export type UtxoAcknowledgedInputs = {
  accountXpub: string;
  acknowledgedAt: number;
  networkUrl: string;
  outpoints: string[];
  replacement?: UtxoAcknowledgedReplacement;
};

type Input = { hash: Uint8Array; index: number };
type Scope = { accountXpub: string; chainId: number; networkUrl: string };
type History = Record<
  number,
  Array<{ localAcknowledgedInputs?: UtxoAcknowledgedInputs }>
>;

const outpointPattern = /^[0-9a-f]{64}:(0|[1-9][0-9]*)$/;
const validOutpoint = (value: unknown): value is string => {
  if (typeof value !== 'string' || !outpointPattern.test(value)) return false;
  const index = Number(value.slice(65));
  return Number.isSafeInteger(index) && index <= 0xffffffff;
};

export const utxoInputOutpoints = (inputs: readonly Input[]): string[] => {
  if (!Array.isArray(inputs) || inputs.length === 0)
    throw new Error('Transaction inputs are unavailable.');
  const values = inputs.map((input) => {
    if (
      !input ||
      !(input.hash instanceof Uint8Array) ||
      input.hash.length !== 32 ||
      !Number.isSafeInteger(input.index) ||
      input.index < 0 ||
      input.index > 0xffffffff
    )
      throw new Error('Transaction inputs are invalid.');
    return `${Buffer.from(input.hash).reverse().toString('hex')}:${
      input.index
    }`;
  });
  if (new Set(values).size !== values.length)
    throw new Error('Transaction inputs are duplicated.');
  return values;
};

/** Only trusted local ACK handling constructs this compact public metadata. */
export const createUtxoAcknowledgedInputs = (
  inputs: readonly Input[],
  scope: Pick<Scope, 'accountXpub' | 'networkUrl'> & {
    replacement?: UtxoAcknowledgedReplacement;
  },
  acknowledgedAt = Date.now()
): UtxoAcknowledgedInputs => {
  if (
    !scope.accountXpub ||
    !scope.networkUrl ||
    !Number.isSafeInteger(acknowledgedAt) ||
    acknowledgedAt < 0
  )
    throw new Error('Transaction acknowledgement context is invalid.');
  return {
    networkUrl: scope.networkUrl,
    accountXpub: scope.accountXpub,
    acknowledgedAt,
    outpoints: utxoInputOutpoints(inputs),
    ...(scope.replacement && { replacement: { ...scope.replacement } }),
  };
};

export const getRecentAcknowledgedInputOutpoints = (
  history: History | undefined,
  scope: Scope,
  now = Date.now(),
  clearedHistoryAcknowledgements: readonly UtxoAcknowledgedInputs[] = []
): Set<string> => {
  const outpoints = new Set<string>();
  if (!Number.isSafeInteger(now)) return outpoints;
  const transactions = history?.[scope.chainId];
  const acknowledgements = Array.isArray(transactions)
    ? transactions.map((transaction) => transaction?.localAcknowledgedInputs)
    : [];
  for (const local of [
    ...acknowledgements,
    ...clearedHistoryAcknowledgements,
  ]) {
    if (
      !local ||
      typeof local !== 'object' ||
      local.networkUrl !== scope.networkUrl ||
      local.accountXpub !== scope.accountXpub ||
      !Number.isSafeInteger(local.acknowledgedAt) ||
      local.acknowledgedAt < 0 ||
      local.acknowledgedAt > now ||
      now - local.acknowledgedAt >= UTXO_ACKNOWLEDGED_INPUTS_WINDOW_MS ||
      !Array.isArray(local.outpoints) ||
      !local.outpoints.length ||
      !local.outpoints.every(validOutpoint) ||
      new Set(local.outpoints).size !== local.outpoints.length
    )
      continue;
    for (const outpoint of local.outpoints) outpoints.add(outpoint);
  }
  return outpoints;
};

export const utxoNetworkCatchingUpError = () =>
  Object.assign(
    new Error(
      'The network is still updating your previous transaction. Please try again shortly.'
    ),
    { code: UTXO_NETWORK_CATCHING_UP, transactionNotBroadcast: true }
  );

/** Ordinary Send only. Explicit external PSBT/RBF approval remains unchanged. */
export const assertNoRecentAcknowledgedInputOverlap = (
  inputs: readonly Input[],
  history: History | undefined,
  scope: Scope,
  now = Date.now(),
  clearedHistoryAcknowledgements?: readonly UtxoAcknowledgedInputs[]
) => {
  const acknowledged = getRecentAcknowledgedInputOutpoints(
    history,
    scope,
    now,
    clearedHistoryAcknowledgements
  );
  if (utxoInputOutpoints(inputs).some((outpoint) => acknowledged.has(outpoint)))
    throw utxoNetworkCatchingUpError();
};
