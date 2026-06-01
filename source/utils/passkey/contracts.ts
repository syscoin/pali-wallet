import { Interface } from '@ethersproject/abi';
import { Contract } from '@ethersproject/contracts';

import { CHAIN_IDS } from 'utils/constants';

import type { Provider } from '@ethersproject/providers';

/* eslint-disable no-shadow */
export enum PasskeyContractSponsorMode {
  None = 0,
  GasOnly = 1,
  Required = 2,
}
/* eslint-enable no-shadow */

export const PASSKEY_SMART_ACCOUNT_VERSION = 'PALI_PASSKEY_SMART_ACCOUNT_V1';

export const PASSKEY_FACTORY_ADDRESSES: Partial<Record<number, string>> = {
  [CHAIN_IDS.ZKSYS_TANENBAUM_TESTNET]:
    '0xaea37aab5d9806F893E519DBD5C79B79bBc76355',
};

export const PASSKEY_FACTORY_ABI = [
  'event AccountCreated(address indexed account, bytes32 indexed recoveryId, bytes32 indexed credentialIdHash, bytes32 salt)',
  'function createAccount(bytes32 recoveryId, bytes32 passkeyX, bytes32 passkeyY, bytes32 credentialIdHash, bytes32 rpIdHash, bytes32 originHash, uint256 originLength, uint8 sponsorMode, address sponsorSigner, bytes32 sponsorUrlHash, bytes32 salt) payable returns (address account)',
  'function getAccountAddress(bytes32 recoveryId, bytes32 passkeyX, bytes32 passkeyY, bytes32 credentialIdHash, bytes32 rpIdHash, bytes32 originHash, uint256 originLength, uint8 sponsorMode, address sponsorSigner, bytes32 sponsorUrlHash, bytes32 salt) view returns (address)',
] as const;

export const PASSKEY_SMART_ACCOUNT_ABI = [
  'function credentialIdHash() view returns (bytes32)',
  'function execute((address target,uint256 value,bytes data,uint256 nonce,uint256 deadline) execution,(bytes authenticatorData,bytes clientDataJSON,uint256 typeOffset,uint256 challengeOffset,uint256 originOffset,bytes32 r,bytes32 s) proof,(uint8 v,bytes32 r,bytes32 s) sponsorProof) payable returns (bytes returndata)',
  'function getActionHash((address target,uint256 value,bytes data,uint256 nonce,uint256 deadline) execution) view returns (bytes32)',
  'function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)',
  'function nonce() view returns (uint256)',
  'function originHash() view returns (bytes32)',
  'function originLength() view returns (uint256)',
  'function passkeyX() view returns (bytes32)',
  'function passkeyY() view returns (bytes32)',
  'function rpIdHash() view returns (bytes32)',
  'function sponsorMode() view returns (uint8)',
  'function sponsorSigner() view returns (address)',
  'function sponsorUrlHash() view returns (bytes32)',
] as const;

export const getPasskeyFactoryAddress = (chainId: number): string => {
  const address = PASSKEY_FACTORY_ADDRESSES[chainId];
  if (!address) {
    throw new Error(
      'Passkey account factory is not configured for this network'
    );
  }

  return address;
};

export const getPasskeyFactory = (
  chainId: number,
  provider: Provider
): Contract =>
  new Contract(
    getPasskeyFactoryAddress(chainId),
    PASSKEY_FACTORY_ABI,
    provider
  );

export const passkeyFactoryInterface = new Interface(PASSKEY_FACTORY_ABI);
export const passkeySmartAccountInterface = new Interface(
  PASSKEY_SMART_ACCOUNT_ABI
);
