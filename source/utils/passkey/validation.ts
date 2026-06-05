import { defaultAbiCoder } from '@ethersproject/abi';
import {
  arrayify,
  hexConcat,
  isHexString,
  splitSignature,
} from '@ethersproject/bytes';
import { AddressZero } from '@ethersproject/constants';
import { hashMessage, id as hashText } from '@ethersproject/hash';
import { keccak256 } from '@ethersproject/keccak256';
import { recoverAddress } from '@ethersproject/transactions';

import {
  IPasskeySmartAccountMetadata,
  KeyringAccountType,
  PasskeySponsorMode,
} from 'types/network';

export type PasskeySponsorProof = { r: string; s: string; v: number };

export type PasskeyExecution = {
  data: string;
  deadline: number;
  nonce: string;
  target: string;
  value: string;
};

export type PasskeyWebAuthnProof = {
  authenticatorData: string;
  challengeOffset: number;
  clientDataJSON: string;
  originOffset: number;
  r: string;
  s: string;
  typeOffset: number;
};

const PASSKEY_EXECUTE_TYPEHASH = hashText(
  'PALI_PASSKEY_SMART_ACCOUNT_EXECUTE_V1'
);
const PASSKEY_CREATE_TYPEHASH = hashText(
  'PALI_PASSKEY_SMART_ACCOUNT_CREATE_V1'
);

export const getPasskeyCreateHash = ({
  account,
  chainId,
  credentialIdHash,
  deploymentSalt,
  publicKey,
}: {
  account: string;
  chainId: number;
  credentialIdHash: string;
  deploymentSalt: string;
  publicKey: IPasskeySmartAccountMetadata['publicKey'];
}) =>
  keccak256(
    defaultAbiCoder.encode(
      [
        'bytes32',
        'uint256',
        'address',
        'bytes32',
        'bytes32',
        'bytes32',
        'bytes32',
        'bytes32',
        'uint256',
        'bytes32',
      ],
      [
        PASSKEY_CREATE_TYPEHASH,
        chainId,
        account,
        credentialIdHash,
        publicKey.x,
        publicKey.y,
        publicKey.rpIdHash,
        publicKey.originHash,
        publicKey.originLength,
        deploymentSalt,
      ]
    )
  );

export const getPasskeyActionHash = ({
  account,
  chainId,
  executions,
  sponsorMode,
  sponsorSigner = AddressZero,
}: {
  account: string;
  chainId: number;
  executions: PasskeyExecution[];
  sponsorMode: number;
  sponsorSigner?: string;
}) => {
  const executionHashes = executions.map((execution) =>
    keccak256(
      defaultAbiCoder.encode(
        ['address', 'uint256', 'bytes32', 'uint256', 'uint256'],
        [
          execution.target,
          execution.value,
          keccak256(execution.data),
          execution.nonce,
          execution.deadline,
        ]
      )
    )
  );

  return keccak256(
    defaultAbiCoder.encode(
      ['bytes32', 'uint256', 'address', 'bytes32', 'uint8', 'address'],
      [
        PASSKEY_EXECUTE_TYPEHASH,
        chainId,
        account,
        keccak256(hexConcat(executionHashes)),
        sponsorMode,
        sponsorSigner || AddressZero,
      ]
    )
  );
};

export class PasskeyRelayedTransactionNotFoundError extends Error {
  constructor() {
    super('Sponsor relayed transaction was not found on-chain');
    this.name = 'PasskeyRelayedTransactionNotFoundError';
  }
}

export const normalizePasskeySponsorProof = (
  proofOrSignature?:
    | string
    | {
        r?: string;
        s?: string;
        signature?: string;
        v?: number | string;
      }
    | null
): PasskeySponsorProof | null => {
  if (!proofOrSignature) {
    return null;
  }

  if (typeof proofOrSignature === 'string') {
    const signature = splitSignature(proofOrSignature);
    return { v: signature.v, r: signature.r, s: signature.s };
  }

  if (proofOrSignature.signature) {
    const signature = splitSignature(proofOrSignature.signature);
    return { v: signature.v, r: signature.r, s: signature.s };
  }

  if (
    proofOrSignature.v === undefined ||
    !proofOrSignature.r ||
    !proofOrSignature.s
  ) {
    return null;
  }

  const v =
    typeof proofOrSignature.v === 'string'
      ? Number(proofOrSignature.v)
      : proofOrSignature.v;
  if (!Number.isInteger(v) || (v !== 27 && v !== 28)) {
    throw new Error('Invalid passkey sponsor signature recovery id');
  }

  return { v, r: proofOrSignature.r, s: proofOrSignature.s };
};

export const verifyPasskeySponsorProof = (
  actionHash: string,
  sponsorProof: PasskeySponsorProof,
  metadata: IPasskeySmartAccountMetadata
) => {
  if (metadata.sponsor?.mode !== PasskeySponsorMode.Required) {
    return;
  }
  if (!metadata.sponsor.signer) {
    throw new Error('Passkey sponsor signer is not configured');
  }

  const sponsorDigest = hashMessage(arrayify(actionHash));
  const recovered = recoverAddress(sponsorDigest, sponsorProof);
  if (recovered.toLowerCase() !== metadata.sponsor.signer.toLowerCase()) {
    throw new Error(
      'Passkey sponsor signature does not match configured signer'
    );
  }
};

export const verifyPasskeyRelayedSponsorProof = (
  actionHash: string,
  sponsorProof: unknown,
  metadata: IPasskeySmartAccountMetadata
) => {
  if (metadata.sponsor?.mode !== PasskeySponsorMode.Required) {
    return;
  }

  const normalizedSponsorProof = normalizePasskeySponsorProof(
    sponsorProof as Parameters<typeof normalizePasskeySponsorProof>[0]
  );
  if (!normalizedSponsorProof) {
    throw new Error(
      'Sponsor relayed a passkey transaction without sponsor proof'
    );
  }

  verifyPasskeySponsorProof(actionHash, normalizedSponsorProof, metadata);
};

export const selectPasskeyDeploymentGasPayer = (
  accounts: Record<string, Record<number, any>>,
  metadata: IPasskeySmartAccountMetadata,
  getDefaultPasskeyGasPayer: () => {
    account: any;
    accountType: KeyringAccountType;
  }
) => {
  const gasPayer = metadata.deploymentGasPayer;
  if (gasPayer) {
    const account = accounts[gasPayer.type]?.[gasPayer.id] as any;
    if (
      account?.address &&
      account.address.toLowerCase() === gasPayer.address.toLowerCase()
    ) {
      return { account, accountType: gasPayer.type };
    }
    throw new Error(
      'Passkey deployment gas payer is no longer available in this wallet'
    );
  }

  return getDefaultPasskeyGasPayer();
};

export const getPasskeyGasPayerCandidates = (
  accounts: Record<string, Record<number, any>>,
  activeAccount?: { id: number; type: KeyringAccountType }
) => {
  const accountTypes = [
    KeyringAccountType.HDAccount,
    KeyringAccountType.Imported,
  ];
  const candidates: Array<{
    account: any;
    accountType: KeyringAccountType;
  }> = [];
  const isSoftwareAccount = (accountType?: KeyringAccountType) =>
    accountType === KeyringAccountType.HDAccount ||
    accountType === KeyringAccountType.Imported;
  const hasEvmAddress = (account: any) => isHexString(account?.address, 20);

  if (activeAccount && isSoftwareAccount(activeAccount.type)) {
    const activeGasPayer =
      accounts[activeAccount.type]?.[activeAccount.id] || null;
    if (hasEvmAddress(activeGasPayer)) {
      candidates.push({
        account: activeGasPayer,
        accountType: activeAccount.type,
      });
    }
  }

  for (const accountType of accountTypes) {
    for (const account of Object.values(accounts[accountType] || {}) as any[]) {
      if (
        hasEvmAddress(account) &&
        !candidates.some(
          (candidate) =>
            candidate.accountType === accountType &&
            candidate.account.id === account.id
        )
      ) {
        candidates.push({ account, accountType });
      }
    }
  }

  return candidates;
};

export const selectPasskeyGasPayerCandidate = (
  accounts: Record<string, Record<number, any>>,
  activeAccount?: { id: number; type: KeyringAccountType }
) => {
  const [candidate] = getPasskeyGasPayerCandidates(accounts, activeAccount);
  if (!candidate) {
    throw new Error(
      'No software account is available to anchor passkey account deployment'
    );
  }
  return candidate;
};

export const selectFundedPasskeyGasPayerCandidate = async (
  accounts: Record<string, Record<number, any>>,
  activeAccount: { id: number; type: KeyringAccountType } | undefined,
  hasRequiredBalance: (address: string) => Promise<boolean>
) => {
  for (const candidate of getPasskeyGasPayerCandidates(
    accounts,
    activeAccount
  )) {
    if (await hasRequiredBalance(candidate.account.address)) {
      return candidate;
    }
  }

  throw new Error(
    'No funded software account is available to pay passkey account gas'
  );
};

export const assertPasskeyRelayPayloadMatches = (
  execution: any,
  proof: any,
  expectedExecution: PasskeyExecution,
  expectedProof: PasskeyWebAuthnProof
) => {
  const sameHex = (left: string, right: string) =>
    String(left || '').toLowerCase() === String(right || '').toLowerCase();
  if (
    String(execution.target).toLowerCase() !==
      expectedExecution.target.toLowerCase() ||
    execution.value.toString() !== expectedExecution.value.toString() ||
    !sameHex(execution.data, expectedExecution.data) ||
    execution.nonce.toString() !== expectedExecution.nonce.toString() ||
    execution.deadline.toString() !== expectedExecution.deadline.toString() ||
    !sameHex(proof.authenticatorData, expectedProof.authenticatorData) ||
    !sameHex(proof.clientDataJSON, expectedProof.clientDataJSON) ||
    proof.challengeOffset.toString() !==
      expectedProof.challengeOffset.toString() ||
    proof.originOffset.toString() !== expectedProof.originOffset.toString() ||
    proof.typeOffset.toString() !== expectedProof.typeOffset.toString() ||
    !sameHex(proof.r, expectedProof.r) ||
    !sameHex(proof.s, expectedProof.s)
  ) {
    throw new Error('Sponsor relayed a different passkey execution');
  }
};

export const validatePasskeyClientDataJSON = (
  clientDataJSON: Uint8Array,
  expectedChallenge: string,
  expectedOrigin?: string
) => {
  const clientDataText = new TextDecoder().decode(clientDataJSON);
  const clientData = JSON.parse(clientDataText);
  if (clientData.type !== 'webauthn.get') {
    throw new Error('WebAuthn client data has an unexpected type');
  }
  if (clientData.challenge !== expectedChallenge) {
    throw new Error('WebAuthn client data has an unexpected challenge');
  }
  if (clientData.crossOrigin === true) {
    throw new Error('Cross-origin WebAuthn assertions are not supported');
  }
  if (expectedOrigin && clientData.origin !== expectedOrigin) {
    throw new Error('WebAuthn client data has an unexpected origin');
  }

  const getByteOffset = (textOffset: number) =>
    new TextEncoder().encode(clientDataText.slice(0, textOffset)).length;

  const findStringValueOffset = (fieldName: string, expectedValue: string) => {
    const fieldText = `${JSON.stringify(fieldName)}:${JSON.stringify(
      expectedValue
    )}`;
    const matchIndex = clientDataText.indexOf(fieldText);
    if (matchIndex < 0) {
      throw new Error(`WebAuthn client data is missing ${fieldName}`);
    }

    const valueOffset = matchIndex + fieldText.lastIndexOf(expectedValue);
    return getByteOffset(valueOffset);
  };

  const challengeOffset = findStringValueOffset('challenge', expectedChallenge);
  const typeOffset = findStringValueOffset('type', 'webauthn.get');
  const originOffset = expectedOrigin
    ? findStringValueOffset('origin', expectedOrigin)
    : (() => {
        const encodedOrigin = JSON.stringify(clientData.origin);
        const fieldText = `${JSON.stringify('origin')}:${encodedOrigin}`;
        const matchIndex = clientDataText.indexOf(fieldText);
        if (matchIndex < 0) {
          throw new Error('WebAuthn client data is missing origin');
        }

        const originValueOffset =
          matchIndex + fieldText.lastIndexOf(String(clientData.origin));
        return getByteOffset(originValueOffset);
      })();
  if (challengeOffset < 0) {
    throw new Error(
      'WebAuthn client data does not contain the expected challenge'
    );
  }

  return { challengeOffset, clientDataText, originOffset, typeOffset };
};
