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
    '0x66222a39F28D75D1a45BB2E4E2e144A449E29D40',
};

export const PASSKEY_GUARDIAN_RECOVERY_VALIDATOR_ADDRESSES: Partial<
  Record<number, string>
> = {
  [CHAIN_IDS.ZKSYS_TANENBAUM_TESTNET]:
    '0x891C61b235b3001a230ee8a6e85194baE53D518B',
};

export const PASSKEY_GUARDIAN_DEFAULT_RECOVERY_DELAY_SECONDS = 24 * 60 * 60;
export const PASSKEY_GUARDIAN_DEFAULT_RECOVERY_THRESHOLD = 1;

export const PASSKEY_FACTORY_ABI = [
  'event AccountCreated(address indexed account, bytes32 indexed lookupKey, bytes32 salt)',
  'function createAccount((bytes32 passkeyX,bytes32 passkeyY,bytes32 credentialIdHash,bytes32 rpIdHash,bytes32 originHash,uint256 originLength,address recoveryValidator,bytes32 salt) params,(bytes authenticatorData,bytes clientDataJSON,uint256 typeOffset,uint256 challengeOffset,uint256 originOffset,bytes32 r,bytes32 s) proof) payable returns (address account)',
  'function createAccountAndExecute((bytes32 passkeyX,bytes32 passkeyY,bytes32 credentialIdHash,bytes32 rpIdHash,bytes32 originHash,uint256 originLength,address recoveryValidator,bytes32 salt) params,(address target,uint256 value,bytes data,uint256 nonce,uint256 deadline)[] executions,(bytes authenticatorData,bytes clientDataJSON,uint256 typeOffset,uint256 challengeOffset,uint256 originOffset,bytes32 r,bytes32 s) proof,(uint8 v,bytes32 r,bytes32 s) sponsorProof) payable returns (address account, bytes[] returndata)',
  'function getAccountAddress((bytes32 passkeyX,bytes32 passkeyY,bytes32 credentialIdHash,bytes32 rpIdHash,bytes32 originHash,uint256 originLength,address recoveryValidator,bytes32 salt) params) view returns (address)',
  'function getAccountCreateHash((bytes32 passkeyX,bytes32 passkeyY,bytes32 credentialIdHash,bytes32 rpIdHash,bytes32 originHash,uint256 originLength,address recoveryValidator,bytes32 salt) params) view returns (bytes32)',
  'function getAccountCountByPasskeyLookup(bytes32 lookupKey) view returns (uint256)',
  'function getAccountsByPasskeyLookup(bytes32 lookupKey, uint256 offset, uint256 limit) view returns (address[] accounts)',
  'function implementation() view returns (address)',
] as const;

export const PASSKEY_SMART_ACCOUNT_ABI = [
  'function execute((address target,uint256 value,bytes data,uint256 nonce,uint256 deadline)[] executions,(bytes authenticatorData,bytes clientDataJSON,uint256 typeOffset,uint256 challengeOffset,uint256 originOffset,bytes32 r,bytes32 s) proof,(uint8 v,bytes32 r,bytes32 s) sponsorProof) payable returns (bytes[] returndata)',
  'function getActionHash((address target,uint256 value,bytes data,uint256 nonce,uint256 deadline)[] executions) view returns (bytes32)',
  'function getRecoveryMetadata() view returns ((bytes32 passkeyX,bytes32 passkeyY,bytes32 credentialIdHash,bytes32 rpIdHash,bytes32 originHash,uint256 originLength,uint8 sponsorMode,address sponsorSigner,string sponsorUrl))',
  'function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)',
  'function nonce() view returns (uint256)',
  'function recoveryNonce() view returns (uint256)',
  'function recoveryValidator() view returns (address)',
  'function setSponsor(uint8 mode, address signer, string url)',
] as const;

export const PASSKEY_GUARDIAN_RECOVERY_VALIDATOR_ABI = [
  'event GuardianAdded(address indexed account, address indexed guardian)',
  'event GuardianRemoved(address indexed account, address indexed guardian)',
  'event GuardianPolicyUpdated(address indexed account, uint256 delay, uint256 threshold, uint256 guardianCount)',
  'event RecoveryStarted(address indexed account, bytes32 indexed credentialIdHash, uint256 recoveryNonce, uint256 readyAt)',
  'event RecoveryCancelled(address indexed account, uint256 recoveryNonce)',
  'event RecoveryFinalized(address indexed account, uint256 recoveryNonce)',
  'function addGuardian(address account, address guardian, uint256 recoveryDelay, uint256 threshold)',
  'function updateRecoveryPolicy(address account, uint256 recoveryDelay, uint256 threshold)',
  'function removeGuardian(address account, address guardian, uint256 threshold)',
  'function clearGuardians(address account)',
  'function getRecoveryHash((address account,(bytes32 passkeyX,bytes32 passkeyY,bytes32 credentialIdHash,bytes32 rpIdHash,bytes32 originHash,uint256 originLength) newIdentity,uint256 expectedRecoveryNonce,uint256 expiresAt,(address guardian,uint8 v,bytes32 r,bytes32 s)[] signatures) data) view returns (bytes32)',
  'function startRecovery((address account,(bytes32 passkeyX,bytes32 passkeyY,bytes32 credentialIdHash,bytes32 rpIdHash,bytes32 originHash,uint256 originLength) newIdentity,uint256 expectedRecoveryNonce,uint256 expiresAt,(address guardian,uint8 v,bytes32 r,bytes32 s)[] signatures) data)',
  'function cancelRecovery(address account)',
  'function finalizeRecovery(address account)',
  'function delay() view returns (uint256)',
  'function recoveryPolicies(address account) view returns (uint256 delay, uint256 threshold, uint256 guardianCount)',
  'function guardians(address account, address guardian) view returns (bool)',
  'function guardianCount(address account) view returns (uint256)',
  'function guardianAt(address account, uint256 index) view returns (address)',
  'function pendingRecoveries(address account) view returns ((bytes32 passkeyX,bytes32 passkeyY,bytes32 credentialIdHash,bytes32 rpIdHash,bytes32 originHash,uint256 originLength) newIdentity,uint256 recoveryNonce,uint256 readyAt)',
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

export const getPasskeyGuardianRecoveryValidatorAddress = (
  chainId: number
): string => {
  const address = PASSKEY_GUARDIAN_RECOVERY_VALIDATOR_ADDRESSES[chainId];
  if (!address) {
    throw new Error(
      'Passkey guardian recovery validator is not configured for this network'
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
export const passkeyGuardianRecoveryValidatorInterface = new Interface(
  PASSKEY_GUARDIAN_RECOVERY_VALIDATOR_ABI
);
