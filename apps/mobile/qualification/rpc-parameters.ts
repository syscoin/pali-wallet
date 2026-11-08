/** Compare JSON-RPC arguments without treating object key order as a value. */
export function sameJsonRpcParameters(actual: unknown[], expected: unknown[]): boolean {
  const serialize = (value: unknown) => JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]))
      : item
  );
  return serialize(actual) === serialize(expected);
}
