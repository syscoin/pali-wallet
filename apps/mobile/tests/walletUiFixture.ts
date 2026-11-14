/** Leaf tests retain their native event ports; the real host has its own tests. */
export function walletUiFixture(name: string, ports: Record<string, any>): Record<string, unknown> | undefined {
  if (name === '../ui/WalletBackHandler' || name === './src/ui/WalletBackHandler')
    return { get WalletBackHandler() { return ports['react-native'].BackHandler; } };
  if (name === '../ui/WalletModal' || name === './src/ui/WalletModal')
    return { WalletModal: ports['react-native'].Modal ?? 'Modal', WalletModalHost: 'WalletModalHost' };
  return undefined;
}
