const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Match the complete accessible identity, allowing only the truthful selected-state suffix. */
export function watchAccountName(action: 'Select' | 'Rename' | 'Remove', name: string, network: string, address: string): RegExp {
  return new RegExp(`^${escape(`${action} ${name} (watch-only), ${network}, ${address}`)}${action === 'Select' ? '(?:, selected)?' : ''}$`);
}

export function nativeAccountName(name: string, kind: string, address: string): RegExp {
  return new RegExp(`^${escape(`Select ${name} (wallet), ${kind}, ${address}`)}(?:, selected)?$`);
}
