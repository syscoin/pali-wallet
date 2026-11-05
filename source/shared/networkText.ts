/** Existing network name/symbol rule: nonblank text, without changing its value. */
export function isNonBlankNetworkText(value: unknown): value is string {
  return typeof value === 'string' && /\S/.test(value);
}
