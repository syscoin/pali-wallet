import { arrayify, splitSignature } from '@ethersproject/bytes';
import { hashMessage } from '@ethersproject/hash';
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

  if (activeAccount && isSoftwareAccount(activeAccount.type)) {
    const activeGasPayer =
      accounts[activeAccount.type]?.[activeAccount.id] || null;
    if (activeGasPayer?.address) {
      candidates.push({
        account: activeGasPayer,
        accountType: activeAccount.type,
      });
    }
  }

  for (const accountType of accountTypes) {
    for (const account of Object.values(accounts[accountType] || {}) as any[]) {
      if (
        account?.address &&
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

  const findStringValueOffset = (fieldName: string, expectedValue: string) => {
    const needle = `"${fieldName}":"${expectedValue}"`;
    const fieldOffset = clientDataText.indexOf(needle);
    if (fieldOffset < 0) {
      throw new Error(`WebAuthn client data is missing ${fieldName}`);
    }
    return fieldOffset + fieldName.length + 4;
  };

  const challengeOffset = findStringValueOffset('challenge', expectedChallenge);
  const typeOffset = findStringValueOffset('type', 'webauthn.get');
  const originOffset = expectedOrigin
    ? findStringValueOffset('origin', expectedOrigin)
    : (() => {
        const encodedOrigin = JSON.stringify(clientData.origin);
        const fieldOffset = clientDataText.indexOf(`"origin":${encodedOrigin}`);
        if (fieldOffset < 0) {
          throw new Error('WebAuthn client data is missing origin');
        }
        return fieldOffset + '"origin":'.length + 1;
      })();
  if (challengeOffset < 0) {
    throw new Error(
      'WebAuthn client data does not contain the expected challenge'
    );
  }

  return { challengeOffset, clientDataText, originOffset, typeOffset };
};
