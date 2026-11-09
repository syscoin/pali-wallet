import { getAddress } from 'ethers/address';

import {
  readDappMessageRequest,
  type DappMessageRequest,
} from '../../shared/dappMessageRequest.ts';

import {
  assertPaliErc7739TypedDataV4Method,
  buildPaliErc7739TypedDataRequest,
  encodePaliErc7739TypedDataSignature,
  buildPaliErc7739PersonalSigningIntent,
  type PaliErc7739TypedData,
  type PaliErc7739TypedDataRequest,
} from './erc7739.ts';
import type { SmartAccountOwnerSigningIntent } from './ownerSigningIntent.ts';
import {
  encodeSmartAccountAuthenticatorSignature,
  type SmartAccountAuthenticatorSignature,
} from './signature.ts';

export type PreparedSmartAccountMessage = Readonly<
  | {
      actionHash: string;
      method: 'personal_sign';
      ownerSigningIntent: SmartAccountOwnerSigningIntent;
    }
  | {
      actionHash: string;
      method: 'eth_signTypedData_v4';
      ownerSigningIntent: SmartAccountOwnerSigningIntent;
      proof: Readonly<PaliErc7739TypedDataRequest>;
    }
>;

/** Derive the digest and proof from the same bounded, captured dapp request. */
export function prepareSmartAccountMessage(
  input: Readonly<{
    accountAddress: string;
    chainId: number;
    request: DappMessageRequest;
  }>
): PreparedSmartAccountMessage {
  const accountAddress = getAddress(input.accountAddress);
  const chainId = input.chainId;
  const original = input.request;
  const method = original.method;
  const address = original.address;
  const payload =
    method === 'personal_sign' ? original.message : original.typedData;
  const version = method === 'personal_sign' ? undefined : original.version;
  const request = readDappMessageRequest(
    method,
    method === 'personal_sign' ? [payload, address] : [address, payload],
    accountAddress
  );
  if (!request || !Number.isSafeInteger(chainId) || chainId < 1)
    throw new Error('Invalid Smart-account message request');
  if (request.method === 'personal_sign') {
    const ownerSigningIntent = buildPaliErc7739PersonalSigningIntent({
      accountAddress,
      chainId,
      message: request.message,
    });
    return Object.freeze({
      method: request.method,
      actionHash: ownerSigningIntent.actionHash,
      ownerSigningIntent,
    });
  }
  assertPaliErc7739TypedDataV4Method(request.method);
  if (method === 'personal_sign' || version !== request.version)
    throw new Error('Smart-account typed-data version changed');
  const proof = Object.freeze(
    buildPaliErc7739TypedDataRequest({
      accountAddress,
      chainId,
      typedData: request.typedData as PaliErc7739TypedData,
    })
  );
  return Object.freeze({
    method: 'eth_signTypedData_v4',
    actionHash: proof.actionHash,
    proof,
    ownerSigningIntent: proof.ownerSigningIntent,
  });
}

/** Complete the module envelope and, for V4, the existing ERC-7739 proof trailer. */
export function encodeSmartAccountMessageSignature(
  message: PreparedSmartAccountMessage,
  signature: SmartAccountAuthenticatorSignature | string
): string {
  const moduleSignature = encodeSmartAccountAuthenticatorSignature(signature);
  return message.method === 'personal_sign'
    ? moduleSignature
    : encodePaliErc7739TypedDataSignature(moduleSignature, message.proof);
}
