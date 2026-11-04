import { parseNativeAccountId } from '../custody/accountIdentity.ts';
import type { NativeWalletCatalogueSnapshot } from '../custody/walletCatalogue.ts';
import type { PublicAccount } from './types.ts';

/** A navigation hint only. It is never an authorization or a keyring account. */
export type AccountSelection = Readonly<{ kind: 'hd' | 'imported'; id: string } | { kind: 'watch'; id: string }>;
type PublicIdentity = Readonly<{ identity: string; name: string; address: string }>;
export type AccountEntry = PublicIdentity & (
  | Readonly<{ kind: 'hd' | 'imported'; selection: Readonly<{ kind: 'hd' | 'imported'; id: string }>; capabilities: Readonly<{ receive: true; signing: 'native-unlock-required'; recovery: 'native-unlock-required' }> }>
  | Readonly<{ kind: 'watch'; selection: Readonly<{ kind: 'watch'; id: string }>; capabilities: Readonly<{ receive: true; signing: 'unavailable'; recovery: 'unavailable' }> }>
);
export function accountIdentity(selection: AccountSelection): string {
  return `${selection.kind}/${selection.id}`;
}
export function projectAccounts(catalogue: NativeWalletCatalogueSnapshot | null, accounts: readonly PublicAccount[]): readonly AccountEntry[] {
  return Object.freeze([
    ...(catalogue?.accounts ?? []).map((account): AccountEntry => Object.freeze({
      kind: nativeAccountSelection(account.id).kind, identity: accountIdentity(nativeAccountSelection(account.id)), selection: nativeAccountSelection(account.id),
      name: account.label, address: account.address,
      capabilities: Object.freeze({ receive: true, signing: 'native-unlock-required', recovery: 'native-unlock-required' }),
    })),
    ...accounts.map((account): AccountEntry => Object.freeze({
      kind: 'watch', identity: accountIdentity({ kind: 'watch', id: account.id }), selection: Object.freeze({ kind: 'watch', id: account.id }),
      name: account.name, address: account.addresses.ethereum ?? Object.values(account.addresses)[0]!,
      capabilities: Object.freeze({ receive: true, signing: 'unavailable', recovery: 'unavailable' }),
    })),
  ]);
}
export function parseAccountSelection(value: unknown): AccountSelection | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid account selection');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || typeof record.kind !== 'string' || !['hd', 'imported', 'watch'].includes(record.kind) || typeof record.id !== 'string')
    throw new Error('Invalid account selection');
  if (record.kind === 'watch') {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(record.id)) throw new Error('Invalid account selection');
  } else if (nativeAccountSelection(record.id).kind !== record.kind) throw new Error('Invalid account selection');
  return Object.freeze({ kind: record.kind as 'hd' | 'imported' | 'watch', id: record.id });
}

export function nativeAccountSelection(id: string): Readonly<{ kind: 'hd' | 'imported'; id: string }> {
  const account = parseNativeAccountId(id);
  return Object.freeze({ kind: account.type === 'HDAccount' ? 'hd' : 'imported', id: account.id });
}
