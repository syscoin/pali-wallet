/** Native signing identities. Public navigation hints never grant these capabilities. */
export type NativeAccountType = 'HDAccount' | 'Imported' | 'SmartAccount' | 'Ledger' | 'Trezor';
export function nativeAccountId(type: NativeAccountType, index: number, slip44 = 60): string {
  if (!['HDAccount', 'Imported', 'SmartAccount', 'Ledger', 'Trezor'].includes(type) || !Number.isSafeInteger(index) || index < 0 ||
      (type === 'SmartAccount' && slip44 !== 60) ||
      !Number.isSafeInteger(slip44) || slip44 < 0)
    throw new Error('INVALID_ACCOUNT_ID');
  return `${type === 'HDAccount' ? 'hd' : type === 'Imported' ? 'imported' : type === 'Ledger' ? 'ledger' : type === 'Trezor' ? 'trezor' : 'smart'}:${slip44}:${index}`;
}
export function parseNativeAccountId(value: unknown): Readonly<{ id: string; type: NativeAccountType; index: number; slip44: number }> {
  if (typeof value !== 'string') throw new Error('INVALID_ACCOUNT_ID');
  const match = /^(hd|imported|smart|ledger|trezor):(0|[1-9][0-9]{0,15}):(0|[1-9][0-9]{0,15})$/.exec(value);
  if (!match) throw new Error('INVALID_ACCOUNT_ID');
  const type = match[1] === 'hd' ? 'HDAccount' : match[1] === 'imported' ? 'Imported' : match[1] === 'ledger' ? 'Ledger' : match[1] === 'trezor' ? 'Trezor' : 'SmartAccount';
  const slip44 = Number(match[2]);
  const index = Number(match[3]);
  if (nativeAccountId(type, index, slip44) !== value) throw new Error('INVALID_ACCOUNT_ID');
  return Object.freeze({ id: value, type, index, slip44 });
}

export function isNativeAccountId(value: unknown): value is string {
  try { parseNativeAccountId(value); return true; } catch { return false; }
}
