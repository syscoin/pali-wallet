/** Route BIP84 imports to their fixed script. The SDK validates the actual key. */
export function hasBip84UtxoPrivateKeyPrefix(value: string): boolean {
  return value.startsWith('zprv') || value.startsWith('vprv');
}
