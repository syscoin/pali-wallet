export type LocaleStructure = 0 | { [key: string]: LocaleStructure };
export type LocaleResource = string | { [key: string]: LocaleResource };

// Fresh ordinary objects preserve the JSON resource contract and property order.
// Only the immutable key structure is shared; locale values are never shared.
export const restoreLocale = (
  shape: LocaleStructure,
  values: string[]
): LocaleResource => {
  let position = 0;
  const restore = (node: LocaleStructure): LocaleResource => {
    if (node === 0) {
      const value = values[position++];
      if (typeof value !== 'string') throw new Error('Missing locale value');
      return value;
    }
    const result: Record<string, LocaleResource> = {};
    for (const key of Object.keys(node)) {
      // defineProperty also preserves a JSON key literally named __proto__.
      Object.defineProperty(result, key, {
        value: restore(node[key]),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return result;
  };
  const resource = restore(shape);
  if (position !== values.length) throw new Error('Unexpected locale values');
  return resource;
};
