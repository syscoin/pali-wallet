import { ethErrors } from 'helpers/errors';

const ADDRESS = /^0x[\da-f]{40}$/i;
const BYTES = /^0x(?:[\da-f]{2})*$/i;
const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);
const invalid = (field: string) => {
  throw ethErrors.rpc.invalidParams(`Invalid transaction ${field}`);
};

// Paired with the qualified keyring zero-tip implementation: zero priority is
// valid, while a zero maximum or priority above maximum remains unsupported.
// Do not deploy this guard change with the older model-switching SDK.
export const assertSupportedEvmFees = (
  tx: Record<string, any>,
  isLegacy = false
) => {
  if (isLegacy) return;
  const feeQuantity = (value: any, field: string) => {
    if (value !== null && typeof value === 'object')
      value = value._hex ?? value.hex ?? value.toString?.();
    if (typeof value === 'bigint') value = value.toString();
    return quantity(value, field);
  };
  const maximum =
    tx.maxFeePerGas === undefined
      ? undefined
      : feeQuantity(tx.maxFeePerGas, 'maximum fee');
  const priority =
    tx.maxPriorityFeePerGas === undefined
      ? undefined
      : feeQuantity(tx.maxPriorityFeePerGas, 'priority fee');
  if (maximum === BigInt(0))
    throw ethErrors.provider.unsupportedMethod(
      'A positive EIP-1559 maximum fee is required.'
    );
  if (maximum !== undefined && priority !== undefined && priority > maximum)
    return invalid('priority fee');
};

// Accept the wallet's existing integer/decimal/padded-hex compatibility forms,
// but never coerce malformed provided values into an omitted/default field.
const quantity = (value: unknown, field: string): bigint => {
  if (
    !(
      (typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value >= 0) ||
      (typeof value === 'string' &&
        value.length <= 80 &&
        /^(?:0x[\da-f]+|\d+)$/i.test(value))
    )
  )
    return invalid(field);
  const parsed = BigInt(value as string | number);
  if (parsed > MAX_UINT256) return invalid(field);
  return parsed;
};

export const normalizeDappTransaction = (input: unknown) => {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return invalid('parameters');
  const tx = { ...input } as Record<string, any>;
  const quantities: Record<string, bigint> = {};
  for (const field of [
    'value',
    'gas',
    'gasLimit',
    'gasPrice',
    'maxFeePerGas',
    'maxPriorityFeePerGas',
    'nonce',
    'chainId',
    'type',
  ]) {
    if (tx[field] === undefined) continue;
    quantities[field] = quantity(tx[field], field);
    tx[field] = `0x${quantities[field].toString(16)}`;
  }
  if (
    (quantities.gas !== undefined && quantities.gas === BigInt(0)) ||
    (quantities.gasLimit !== undefined && quantities.gasLimit === BigInt(0)) ||
    (quantities.nonce !== undefined &&
      quantities.nonce > BigInt(Number.MAX_SAFE_INTEGER))
  )
    return invalid('gas or nonce');
  if (
    quantities.gas !== undefined &&
    quantities.gasLimit !== undefined &&
    quantities.gas !== quantities.gasLimit
  )
    return invalid('gas/gasLimit aliases');
  if (
    quantities.gasPrice !== undefined &&
    (quantities.maxFeePerGas !== undefined ||
      quantities.maxPriorityFeePerGas !== undefined)
  )
    return invalid('fee combination');
  if (
    quantities.maxFeePerGas !== undefined &&
    quantities.maxPriorityFeePerGas !== undefined &&
    quantities.maxPriorityFeePerGas > quantities.maxFeePerGas
  )
    return invalid('priority fee');
  if (
    (quantities.type === BigInt(0) &&
      (quantities.maxFeePerGas !== undefined ||
        quantities.maxPriorityFeePerGas !== undefined)) ||
    (quantities.type === BigInt(2) && quantities.gasPrice !== undefined)
  )
    return invalid('type/fee combination');
  if (
    quantities.type !== undefined &&
    quantities.type !== BigInt(0) &&
    quantities.type !== BigInt(2)
  )
    throw ethErrors.provider.unsupportedMethod(
      'Pali supports legacy and EIP-1559 transactions (types 0 and 2).'
    );
  assertSupportedEvmFees(tx, quantities.type === BigInt(0));
  for (const field of [
    'authorizationList',
    'blobVersionedHashes',
    'blobs',
    'maxFeePerBlobGas',
  ])
    if (tx[field] !== undefined)
      throw ethErrors.provider.unsupportedMethod(
        `Transaction ${field} is not supported`
      );
  if (
    tx.from !== undefined &&
    (typeof tx.from !== 'string' || !ADDRESS.test(tx.from))
  )
    return invalid('from address');
  if (tx.from !== undefined) tx.from = `0x${tx.from.slice(2)}`;
  if (
    tx.to !== undefined &&
    tx.to !== null &&
    (typeof tx.to !== 'string' ||
      (!ADDRESS.test(tx.to) &&
        !(
          tx.to.length > 4 &&
          tx.to.toLowerCase().endsWith('.eth') &&
          !/[\s/?#@\\]/.test(tx.to)
        )))
  )
    return invalid('to address');
  if (typeof tx.to === 'string' && ADDRESS.test(tx.to))
    tx.to = `0x${tx.to.slice(2)}`;
  for (const field of ['data', 'input'])
    if (
      tx[field] !== undefined &&
      (typeof tx[field] !== 'string' || !BYTES.test(tx[field]))
    )
      return invalid(field);
  if (
    tx.data !== undefined &&
    tx.input !== undefined &&
    tx.data.toLowerCase() !== tx.input.toLowerCase()
  )
    return invalid('data/input aliases');
  tx.data = tx.data ?? tx.input ?? '0x';
  tx.data = `0x${tx.data.slice(2)}`;
  delete tx.input;
  if (tx.accessList !== undefined) {
    if (!Array.isArray(tx.accessList)) return invalid('access list');
    for (const entry of tx.accessList)
      if (
        !entry ||
        typeof entry !== 'object' ||
        Array.isArray(entry) ||
        typeof entry.address !== 'string' ||
        !ADDRESS.test(entry.address) ||
        !Array.isArray(entry.storageKeys) ||
        entry.storageKeys.some(
          (key: unknown) =>
            typeof key !== 'string' || !/^0x[\da-f]{64}$/i.test(key)
        )
      )
        return invalid('access list');
    if (quantities.type === BigInt(0) || quantities.gasPrice !== undefined)
      return invalid('legacy access list');
    tx.accessList = tx.accessList.map((entry: any) => ({
      address: `0x${entry.address.slice(2)}`,
      storageKeys: entry.storageKeys.map((key: string) => `0x${key.slice(2)}`),
    }));
  }
  return tx;
};
