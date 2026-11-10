/** A host request asks for fresh local authentication; it grants no authority. */
export type HostWalletAuthentication = Readonly<{ kind: 'host-request' }>;
export type WalletAuthentication = string | HostWalletAuthentication;
export const HOST_WALLET_AUTHENTICATION: HostWalletAuthentication =
  Object.freeze({ kind: 'host-request' });
export function isHostWalletAuthentication(
  value: unknown
): value is HostWalletAuthentication {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const fields = Object.getOwnPropertyDescriptors(value);
  return (
    Reflect.ownKeys(fields).length === 1 &&
    fields.kind?.value === 'host-request'
  );
}
