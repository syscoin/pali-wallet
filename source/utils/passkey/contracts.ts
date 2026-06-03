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
    '0x71361b752122C8A8d5b3fb9Eef3Eb71642e32099',
};

export const PASSKEY_FACTORY_ABI = [
  'event AccountCreated(address indexed account, bytes32 indexed recoveryId, bytes32 indexed credentialIdHash, bytes32 salt)',
  'function createAccount((bytes32 recoveryId,bytes32 passkeyX,bytes32 passkeyY,bytes32 credentialIdHash,bytes32 rpIdHash,bytes32 originHash,uint256 originLength,bytes32 salt) params) payable returns (address account)',
  'function createAccountAndExecute((bytes32 recoveryId,bytes32 passkeyX,bytes32 passkeyY,bytes32 credentialIdHash,bytes32 rpIdHash,bytes32 originHash,uint256 originLength,bytes32 salt) params,(address target,uint256 value,bytes data,uint256 nonce,uint256 deadline)[] executions,(bytes authenticatorData,bytes clientDataJSON,uint256 typeOffset,uint256 challengeOffset,uint256 originOffset,bytes32 r,bytes32 s) proof,(uint8 v,bytes32 r,bytes32 s) sponsorProof) payable returns (address account, bytes[] returndata)',
  'function getAccountActionHash((bytes32 recoveryId,bytes32 passkeyX,bytes32 passkeyY,bytes32 credentialIdHash,bytes32 rpIdHash,bytes32 originHash,uint256 originLength,bytes32 salt) params,(address target,uint256 value,bytes data,uint256 nonce,uint256 deadline)[] executions) view returns (bytes32)',
  'function getAccountAddress((bytes32 recoveryId,bytes32 passkeyX,bytes32 passkeyY,bytes32 credentialIdHash,bytes32 rpIdHash,bytes32 originHash,uint256 originLength,bytes32 salt) params) view returns (address)',
  'function getAccountCountByCredential(bytes32 recoveryId, bytes32 credentialIdHash) view returns (uint256)',
  'function getAccountCountByRecoveryId(bytes32 recoveryId) view returns (uint256)',
  'function getAccountsByCredential(bytes32 recoveryId, bytes32 credentialIdHash, uint256 offset, uint256 limit) view returns (address[] accounts)',
  'function getAccountsByRecoveryId(bytes32 recoveryId, uint256 offset, uint256 limit) view returns (address[] accounts)',
  'function implementation() view returns (address)',
] as const;

export const PASSKEY_SMART_ACCOUNT_ABI = [
  'function execute((address target,uint256 value,bytes data,uint256 nonce,uint256 deadline)[] executions,(bytes authenticatorData,bytes clientDataJSON,uint256 typeOffset,uint256 challengeOffset,uint256 originOffset,bytes32 r,bytes32 s) proof,(uint8 v,bytes32 r,bytes32 s) sponsorProof) payable returns (bytes[] returndata)',
  'function getActionHash((address target,uint256 value,bytes data,uint256 nonce,uint256 deadline)[] executions) view returns (bytes32)',
  'function getRecoveryMetadata() view returns ((bytes32 passkeyX,bytes32 passkeyY,bytes32 credentialIdHash,bytes32 rpIdHash,bytes32 originHash,uint256 originLength,uint8 sponsorMode,address sponsorSigner,string sponsorUrl))',
  'function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)',
  'function nonce() view returns (uint256)',
  'function setSponsor(uint8 mode, address signer, string url)',
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
