import { assertJsonWorkBudget } from '../utils/requestPayloadBudget.ts';

export type DappEncryptionMethod = 'eth_getEncryptionPublicKey' | 'eth_decrypt';
export type DappEncryptionRequest = Readonly<
  | { address: string; method: 'eth_getEncryptionPublicKey' }
  | { address: string; ciphertext: string; method: 'eth_decrypt' }
>;

export function isDappEncryptionMethod(
  method: unknown
): method is DappEncryptionMethod {
  return method === 'eth_getEncryptionPublicKey' || method === 'eth_decrypt';
}

/** Public order is canonical even though the SDK accepts both decrypt orders. */
export function readDappEncryptionRequest(
  method: unknown,
  params: unknown,
  address: string
): DappEncryptionRequest | undefined {
  try {
    assertJsonWorkBudget(params);
    if (
      !isDappEncryptionMethod(method) ||
      !Array.isArray(params) ||
      !/^0x[\da-f]{40}$/i.test(address)
    )
      return;
    const receiver = params[method === 'eth_decrypt' ? 1 : 0];
    if (
      typeof receiver !== 'string' ||
      receiver.toLowerCase() !== address.toLowerCase()
    )
      return;
    if (method === 'eth_getEncryptionPublicKey') {
      if (params.length === 1) return Object.freeze({ method, address });
    } else if (
      params.length === 2 &&
      typeof params[0] === 'string' &&
      /^0x(?:[\da-f]{2})+$/i.test(params[0])
    ) {
      return Object.freeze({ method, address, ciphertext: params[0] });
    }
  } catch {
    /* Malformed and over-budget inputs never become capabilities. */
  }
  return;
}

export type DappEncryptionAccount = Readonly<{
  isLedgerWallet?: boolean;
  isSmartAccount?: boolean;
  isTrezorWallet?: boolean;
  type: unknown;
}>;

/** The installed primitive requires this account's own software private key. */
export function supportsDappEncryptionAccount(
  account: DappEncryptionAccount
): boolean {
  return (
    (account.type === 'HDAccount' || account.type === 'Imported') &&
    !account.isSmartAccount &&
    !account.isLedgerWallet &&
    !account.isTrezorWallet
  );
}
