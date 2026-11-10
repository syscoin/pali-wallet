import { normalizePublicAddress } from './addresses.ts';
/** Raw EVM addresses only: a QR cannot change the amount or network. */
export function parseEvmRecipientQr(value: string): string | null {
  try { return normalizePublicAddress(value, 'ethereum'); }
  catch { return null; }
}
