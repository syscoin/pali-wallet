/** Public derivation metadata kept inside the existing authenticated UTXO journal. */
export type UtxoDiscoveryState = Readonly<{
  changeIndex: number;
  receivingIndex: number;
}>;
export type UtxoIssuedAddress = Readonly<{
  address: string;
  branch: 0 | 1;
  index: number;
  path: string;
  script: string;
}>;
export type UtxoAddressSelection = Readonly<{
  issued: UtxoIssuedAddress;
  state: UtxoDiscoveryState;
}>;
export type UtxoDiscoveryMetadata = Readonly<{
  owner: string;
  paths: readonly UtxoIssuedAddress[];
  state: UtxoDiscoveryState;
}>;
const child = (value: unknown): value is number =>
  Number.isSafeInteger(value) &&
  Number(value) >= 0 &&
  Number(value) < 0x80000000;

export function validUtxoDiscoveryState(
  value: unknown
): value is UtxoDiscoveryState {
  const state = value as UtxoDiscoveryState | null;
  return Boolean(
    state &&
      Object.keys(state).length === 2 &&
      child(state.receivingIndex) &&
      child(state.changeIndex)
  );
}

export function validUtxoIssuedAddress(
  value: unknown
): value is UtxoIssuedAddress {
  const issued = value as UtxoIssuedAddress | null;
  return Boolean(
    issued &&
      Object.keys(issued).length === 5 &&
      (issued.branch === 0 || issued.branch === 1) &&
      child(issued.index) &&
      typeof issued.address === 'string' &&
      issued.address.length > 0 &&
      issued.address.length <= 256 &&
      typeof issued.path === 'string' &&
      /^m\/84'\/(0|[1-9][0-9]*)'\/(0|[1-9][0-9]*)'\/[01]\/(0|[1-9][0-9]*)$/.test(
        issued.path
      ) &&
      issued.path.length <= 128 &&
      issued.path.endsWith(`/${issued.branch}/${issued.index}`) &&
      typeof issued.script === 'string' &&
      /^0014[0-9a-f]{40}$/.test(issued.script)
  );
}

export function validUtxoDiscoveryMetadata(
  value: unknown,
  limit: number
): value is readonly UtxoDiscoveryMetadata[] {
  if (!Array.isArray(value) || value.length > limit) return false;
  const owners = new Set<string>();
  return value.every((item) => {
    if (
      !item ||
      Object.keys(item).length !== 3 ||
      typeof item.owner !== 'string' ||
      !/^[0-9a-f]{64}$/.test(item.owner) ||
      owners.has(item.owner) ||
      !validUtxoDiscoveryState(item.state) ||
      !Array.isArray(item.paths) ||
      item.paths.length > 2 ||
      !item.paths.every(validUtxoIssuedAddress) ||
      new Set(item.paths.map((path: UtxoIssuedAddress) => path.branch)).size !==
        item.paths.length ||
      item.paths.some(
        (path: UtxoIssuedAddress) =>
          path.index >
          (path.branch === 1
            ? item.state.changeIndex
            : item.state.receivingIndex)
      )
    )
      return false;
    owners.add(item.owner);
    return true;
  });
}
