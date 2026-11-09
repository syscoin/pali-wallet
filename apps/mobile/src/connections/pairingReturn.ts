import type { WalletConnectVerification } from './walletConnect.ts';

export type NativeDappReturnTarget = Readonly<{
  origin: string;
  url: string;
  verification: WalletConnectVerification;
}>;
/** A displayed, explicit web return only. Peer redirect schemes/paths are never launch authority. */
export function createDappReturnTarget(
  origin: string,
  verification: WalletConnectVerification
): NativeDappReturnTarget | null {
  try {
    const url = new URL(origin);
    if (
      url.protocol !== 'https:' ||
      url.origin !== origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      verification.validation === 'INVALID' ||
      verification.isScam
    )
      return null;
    return Object.freeze({
      origin,
      url: `${origin}/`,
      verification: Object.freeze({ ...verification }),
    });
  } catch {
    return null;
  }
}
