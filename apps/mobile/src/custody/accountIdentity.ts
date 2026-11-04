/** Native signing identities. Public navigation hints never grant these capabilities. */
export type NativeAccountType = 'HDAccount' | 'Imported';
export function nativeAccountId(type: NativeAccountType, index: number): string {
  if (!['HDAccount', 'Imported'].includes(type) || !Number.isSafeInteger(index) || index < 0)
    throw new Error('INVALID_ACCOUNT_ID');
  return `${type === 'HDAccount' ? 'hd' : 'imported'}:60:${index}`;
}
export function parseNativeAccountId(value: unknown): Readonly<{ id: string; type: NativeAccountType; index: number }> {
  if (typeof value !== 'string') throw new Error('INVALID_ACCOUNT_ID');
  const match = /^(hd|imported):60:(0|[1-9][0-9]{0,15})$/.exec(value);
  if (!match) throw new Error('INVALID_ACCOUNT_ID');
  const type = match[1] === 'hd' ? 'HDAccount' : 'Imported';
  const index = Number(match[2]);
  if (nativeAccountId(type, index) !== value) throw new Error('INVALID_ACCOUNT_ID');
  return Object.freeze({ id: value, type, index });
}

export function isNativeAccountId(value: unknown): value is string {
  try { parseNativeAccountId(value); return true; } catch { return false; }
}
