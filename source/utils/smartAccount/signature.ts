import { getAddress, hexConcat } from '../ethersV6Compat.ts';

export type SmartAccountAuthenticatorSignature = {
  proof?: unknown;
  signature: string;
  validator?: string;
};

/** Encode the existing validator-prefixed ERC-1271 signature envelope. */
export const encodeSmartAccountAuthenticatorSignature = (
  signature: SmartAccountAuthenticatorSignature | string
) => {
  if (typeof signature === 'string') return signature;
  return signature.validator
    ? hexConcat([getAddress(signature.validator), signature.signature])
    : signature.signature;
};
