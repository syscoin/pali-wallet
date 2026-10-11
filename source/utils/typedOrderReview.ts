type OrderProtocol = '0x' | 'Seaport';
type OrderWarning = 'send.nftOrderZeroPayment' | 'send.nftOrderNoReturn';

export interface ITypedOrderReview {
  protocol: OrderProtocol;
  status: 'recognized' | 'unrecognized';
  warnings: OrderWarning[];
}

// These bounds limit local review work. Exceeding them means no semantic
// interpretation, rather than interpreting a truncated portion of an order.
const MAX_INPUT_LENGTH = 64 * 1024;
const MAX_ARRAY_LENGTH = 64;
const MAX_DEPTH = 8;
const MAX_NODES = 4096;
const MAX_BYTES_LENGTH = 4096;
const MAX_UINT256 = BigInt(
  '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
);
const ADDRESS = /^0x[A-Fa-f0-9]{40}$/;
const BYTES = /^0x(?:[A-Fa-f0-9]{2})*$/;
const BYTES32 = /^0x[A-Fa-f0-9]{64}$/;

type RecordValue = Record<string, unknown>;
type Schema = ReadonlyArray<readonly [string, string]>;

const DOMAIN_SCHEMA: Schema = [
  ['name', 'string'],
  ['version', 'string'],
  ['chainId', 'uint256'],
  ['verifyingContract', 'address'],
];
const ZERO_EX_SCHEMA: Schema = [
  ['direction', 'uint8'],
  ['maker', 'address'],
  ['taker', 'address'],
  ['expiry', 'uint256'],
  ['nonce', 'uint256'],
  ['erc20Token', 'address'],
  ['erc20TokenAmount', 'uint256'],
  ['fees', 'Fee[]'],
  ['erc721Token', 'address'],
  ['erc721TokenId', 'uint256'],
  ['erc721TokenProperties', 'Property[]'],
];
const FEE_SCHEMA: Schema = [
  ['recipient', 'address'],
  ['amount', 'uint256'],
  ['feeData', 'bytes'],
];
const PROPERTY_SCHEMA: Schema = [
  ['propertyValidator', 'address'],
  ['propertyData', 'bytes'],
];
const SEAPORT_SCHEMA: Schema = [
  ['offerer', 'address'],
  ['zone', 'address'],
  ['offer', 'OfferItem[]'],
  ['consideration', 'ConsiderationItem[]'],
  ['orderType', 'uint8'],
  ['startTime', 'uint256'],
  ['endTime', 'uint256'],
  ['zoneHash', 'bytes32'],
  ['salt', 'uint256'],
  ['conduitKey', 'bytes32'],
  ['counter', 'uint256'],
];
const OFFER_SCHEMA: Schema = [
  ['itemType', 'uint8'],
  ['token', 'address'],
  ['identifierOrCriteria', 'uint256'],
  ['startAmount', 'uint256'],
  ['endAmount', 'uint256'],
];
const CONSIDERATION_SCHEMA: Schema = [
  ...OFFER_SCHEMA,
  ['recipient', 'address'],
];

const isRecord = (value: unknown): value is RecordValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const hasKeys = (
  value: unknown,
  names: readonly string[]
): value is RecordValue =>
  isRecord(value) &&
  Reflect.ownKeys(value).length === names.length &&
  names.every((name) => Object.prototype.hasOwnProperty.call(value, name));

// Inspect only JSON data properties: never invoke getters or toJSON callbacks.
const withinBounds = (value: unknown): boolean => {
  let nodes = 0;
  let length = 0;
  const visit = (entry: unknown, depth: number): boolean => {
    nodes += 1;
    if (nodes > MAX_NODES || depth > MAX_DEPTH) return false;
    if (typeof entry === 'string') {
      length += entry.length;
      return length <= MAX_INPUT_LENGTH;
    }
    if (entry === null || typeof entry === 'boolean') return true;
    if (typeof entry === 'number') return Number.isFinite(entry);
    if (!entry || typeof entry !== 'object') return false;

    const descriptors = Object.getOwnPropertyDescriptors(entry);
    const keys = Reflect.ownKeys(descriptors);
    if (Array.isArray(entry)) {
      if (
        Object.getPrototypeOf(entry) !== Array.prototype ||
        entry.length > MAX_ARRAY_LENGTH ||
        keys.length !== entry.length + 1
      )
        return false;
      for (let index = 0; index < entry.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (
          !descriptor ||
          !descriptor.enumerable ||
          !('value' in descriptor) ||
          !visit(descriptor.value, depth + 1)
        )
          return false;
      }
      return true;
    }
    if (!isRecord(entry) || keys.length > MAX_ARRAY_LENGTH) return false;
    for (const key of keys) {
      if (typeof key !== 'string') return false;
      length += key.length;
      const descriptor = descriptors[key];
      if (
        length > MAX_INPUT_LENGTH ||
        !descriptor.enumerable ||
        !('value' in descriptor) ||
        !visit(descriptor.value, depth + 1)
      )
        return false;
    }
    return true;
  };
  return visit(value, 0);
};

const uint = (value: unknown, maximum = MAX_UINT256): bigint | null => {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return null;
  } else if (
    typeof value !== 'string' ||
    value.length > 78 ||
    !/^(?:[0-9]+|0x[A-Fa-f0-9]+)$/.test(value)
  ) {
    return null;
  }
  const parsed = BigInt(value);
  return parsed <= maximum ? parsed : null;
};
const isAddress = (value: unknown): value is string =>
  typeof value === 'string' && ADDRESS.test(value);
const isBytes = (value: unknown) =>
  typeof value === 'string' &&
  value.length <= MAX_BYTES_LENGTH &&
  BYTES.test(value);
const isBytes32 = (value: unknown) =>
  typeof value === 'string' && BYTES32.test(value);
const schemaKeys = (schema: Schema) => schema.map(([name]) => name);

const matchesSchema = (value: unknown, schema: Schema) =>
  Array.isArray(value) &&
  value.length === schema.length &&
  value.every(
    (entry, index) =>
      hasKeys(entry, ['name', 'type']) &&
      entry.name === schema[index][0] &&
      entry.type === schema[index][1]
  );

const matchesTypes = (
  value: unknown,
  schemas: Record<string, Schema>
): value is RecordValue =>
  hasKeys(value, Object.keys(schemas)) &&
  Object.entries(schemas).every(([name, schema]) =>
    matchesSchema(value[name], schema)
  );

const matchesDomain = (value: unknown, protocol: OrderProtocol) =>
  hasKeys(value, schemaKeys(DOMAIN_SCHEMA)) &&
  value.name === (protocol === '0x' ? 'ZeroEx' : 'Seaport') &&
  (protocol === '0x'
    ? value.version === '1.0.0'
    : value.version === '1.1' ||
      value.version === '1.2' ||
      value.version === '1.3' ||
      value.version === '1.4' ||
      value.version === '1.5' ||
      value.version === '1.6') &&
  uint(value.chainId) !== null &&
  isAddress(value.verifyingContract);

const validZeroEx = (message: unknown): message is RecordValue => {
  if (!hasKeys(message, schemaKeys(ZERO_EX_SCHEMA))) return false;
  const direction = uint(message.direction, BigInt(1));
  return (
    direction !== null &&
    ['maker', 'taker', 'erc20Token', 'erc721Token'].every((name) =>
      isAddress(message[name])
    ) &&
    ['expiry', 'nonce', 'erc20TokenAmount', 'erc721TokenId'].every(
      (name) => uint(message[name]) !== null
    ) &&
    Array.isArray(message.fees) &&
    message.fees.every(
      (fee) =>
        hasKeys(fee, schemaKeys(FEE_SCHEMA)) &&
        isAddress(fee.recipient) &&
        uint(fee.amount) !== null &&
        isBytes(fee.feeData)
    ) &&
    Array.isArray(message.erc721TokenProperties) &&
    message.erc721TokenProperties.every(
      (property) =>
        hasKeys(property, schemaKeys(PROPERTY_SCHEMA)) &&
        isAddress(property.propertyValidator) &&
        isBytes(property.propertyData)
    )
  );
};

const validItem = (item: unknown, consideration: boolean) =>
  hasKeys(
    item,
    schemaKeys(consideration ? CONSIDERATION_SCHEMA : OFFER_SCHEMA)
  ) &&
  uint(item.itemType, BigInt(5)) !== null &&
  isAddress(item.token) &&
  uint(item.identifierOrCriteria) !== null &&
  uint(item.startAmount) !== null &&
  uint(item.endAmount) !== null &&
  (!consideration || isAddress(item.recipient));

const validSeaport = (message: unknown): message is RecordValue =>
  hasKeys(message, schemaKeys(SEAPORT_SCHEMA)) &&
  isAddress(message.offerer) &&
  isAddress(message.zone) &&
  Array.isArray(message.offer) &&
  message.offer.every((item) => validItem(item, false)) &&
  Array.isArray(message.consideration) &&
  message.consideration.every((item) => validItem(item, true)) &&
  uint(message.orderType, BigInt(3)) !== null &&
  ['startTime', 'endTime', 'salt', 'counter'].every(
    (name) => uint(message[name]) !== null
  ) &&
  isBytes32(message.zoneHash) &&
  isBytes32(message.conduitKey);

/**
 * Explain only canonical declared order formats. This does not verify the
 * contract, ownership, approvals, execution outcome, or whether an order is
 * malicious. Review leaves the signed payload and approval policy untouched.
 */
export const getTypedOrderReview = (
  payload: unknown
): ITypedOrderReview | null => {
  try {
    const data =
      typeof payload === 'string'
        ? payload.length <= MAX_INPUT_LENGTH
          ? JSON.parse(payload)
          : null
        : payload;
    if (!isRecord(data)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(data, 'primaryType');
    const primaryType = descriptor && 'value' in descriptor && descriptor.value;
    const protocol =
      primaryType === 'ERC721Order'
        ? '0x'
        : primaryType === 'OrderComponents'
        ? 'Seaport'
        : null;
    if (!protocol) return null;
    const unrecognized: ITypedOrderReview = {
      protocol,
      status: 'unrecognized',
      warnings: [],
    };
    if (
      !withinBounds(data) ||
      !hasKeys(data, ['types', 'domain', 'primaryType', 'message']) ||
      !matchesDomain(data.domain, protocol)
    )
      return unrecognized;

    const warnings: OrderWarning[] = [];
    if (protocol === '0x') {
      if (
        !matchesTypes(data.types, {
          EIP712Domain: DOMAIN_SCHEMA,
          ERC721Order: ZERO_EX_SCHEMA,
          Fee: FEE_SCHEMA,
          Property: PROPERTY_SCHEMA,
        }) ||
        !validZeroEx(data.message)
      )
        return unrecognized;
      // The buyer pays fees separately from the sale price. Only a fee paid
      // directly to the maker counts as a signed return to that creator.
      const maker = (data.message.maker as string).toLowerCase();
      const makerFee = (data.message.fees as RecordValue[]).some(
        (fee) =>
          (fee.recipient as string).toLowerCase() === maker &&
          (uint(fee.amount) as bigint) > BigInt(0)
      );
      if (
        uint(data.message.direction) === BigInt(0) &&
        uint(data.message.erc20TokenAmount) === BigInt(0) &&
        !makerFee
      )
        warnings.push('send.nftOrderZeroPayment');
    } else {
      if (
        !matchesTypes(data.types, {
          EIP712Domain: DOMAIN_SCHEMA,
          OrderComponents: SEAPORT_SCHEMA,
          OfferItem: OFFER_SCHEMA,
          ConsiderationItem: CONSIDERATION_SCHEMA,
        }) ||
        !validSeaport(data.message)
      )
        return unrecognized;
      const offerer = (data.message.offerer as string).toLowerCase();
      const positiveAmount = (item: RecordValue) =>
        (uint(item.startAmount) as bigint) > BigInt(0) ||
        (uint(item.endAmount) as bigint) > BigInt(0);
      const offersNft = (data.message.offer as RecordValue[]).some(
        (item) =>
          (uint(item.itemType) as bigint) >= BigInt(2) && positiveAmount(item)
      );
      const returnsAsset = (data.message.consideration as RecordValue[]).some(
        (item) =>
          (item.recipient as string).toLowerCase() === offerer &&
          positiveAmount(item)
      );
      if (offersNft && !returnsAsset) warnings.push('send.nftOrderNoReturn');
    }
    return { protocol, status: 'recognized', warnings };
  } catch {
    return null;
  }
};
