jest.unmock('@ethersproject/bytes');
jest.unmock('@ethersproject/hash');
jest.unmock('@ethersproject/strings');
jest.unmock('@ethersproject/transactions');
jest.unmock('@ethersproject/wallet');

import { arrayify } from '@ethersproject/bytes';
import { Wallet } from '@ethersproject/wallet';

import {
  IPasskeySmartAccountMetadata,
  KeyringAccountType,
  PasskeySponsorMode,
} from 'types/network';

import {
  assertPasskeyRelayPayloadMatches,
  getPasskeyGasPayerCandidates,
  normalizePasskeySponsorProof,
  PasskeyRelayedTransactionNotFoundError,
  selectPasskeyDeploymentGasPayer,
  selectFundedPasskeyGasPayerCandidate,
  selectPasskeyGasPayerCandidate,
  validatePasskeyClientDataJSON,
  verifyPasskeyRelayedSponsorProof,
  verifyPasskeySponsorProof,
} from './validation';

const baseMetadata = (
  sponsor: IPasskeySmartAccountMetadata['sponsor']
): IPasskeySmartAccountMetadata => ({
  chainId: 57057,
  contractVersion: '1',
  credentialId: 'credential',
  credentialIdHash:
    '0x0000000000000000000000000000000000000000000000000000000000000001',
  deploymentSalt:
    '0x0000000000000000000000000000000000000000000000000000000000000002',
  isDeployed: false,
  passkeyName: 'Test passkey',
  publicKey: {
    originHash:
      '0x0000000000000000000000000000000000000000000000000000000000000006',
    originLength: 23,
    rpIdHash:
      '0x0000000000000000000000000000000000000000000000000000000000000003',
    x: '0x0000000000000000000000000000000000000000000000000000000000000004',
    y: '0x0000000000000000000000000000000000000000000000000000000000000005',
  },
  sponsor,
});

describe('passkey validation utilities', () => {
  it('verifies required sponsor proofs against the configured signer', async () => {
    const sponsor = Wallet.createRandom();
    const actionHash =
      '0x1111111111111111111111111111111111111111111111111111111111111111';
    const signature = await sponsor.signMessage(arrayify(actionHash));
    const proof = normalizePasskeySponsorProof(signature);

    expect(proof).not.toBeNull();
    expect(() =>
      verifyPasskeySponsorProof(
        actionHash,
        proof!,
        baseMetadata({
          mode: PasskeySponsorMode.Required,
          signer: sponsor.address,
        })
      )
    ).not.toThrow();
  });

  it('rejects required sponsor proofs from a different signer', async () => {
    const sponsor = Wallet.createRandom();
    const attacker = Wallet.createRandom();
    const actionHash =
      '0x2222222222222222222222222222222222222222222222222222222222222222';
    const signature = await attacker.signMessage(arrayify(actionHash));
    const proof = normalizePasskeySponsorProof(signature);

    expect(() =>
      verifyPasskeySponsorProof(
        actionHash,
        proof!,
        baseMetadata({
          mode: PasskeySponsorMode.Required,
          signer: sponsor.address,
        })
      )
    ).toThrow('Passkey sponsor signature does not match configured signer');
  });

  it('verifies relayed required sponsor proofs before accepting sponsor tx hashes', async () => {
    const sponsor = Wallet.createRandom();
    const actionHash =
      '0x7777777777777777777777777777777777777777777777777777777777777777';
    const signature = await sponsor.signMessage(arrayify(actionHash));
    const sponsorProof = normalizePasskeySponsorProof(signature);

    expect(() =>
      verifyPasskeyRelayedSponsorProof(
        actionHash,
        sponsorProof,
        baseMetadata({
          mode: PasskeySponsorMode.Required,
          signer: sponsor.address,
        })
      )
    ).not.toThrow();
  });

  it('rejects relayed required sponsor transactions without a sponsor proof', () => {
    const sponsor = Wallet.createRandom();
    const actionHash =
      '0x8888888888888888888888888888888888888888888888888888888888888888';

    expect(() =>
      verifyPasskeyRelayedSponsorProof(
        actionHash,
        null,
        baseMetadata({
          mode: PasskeySponsorMode.Required,
          signer: sponsor.address,
        })
      )
    ).toThrow('without sponsor proof');
  });

  it('rejects relayed required sponsor transactions signed by the wrong sponsor', async () => {
    const sponsor = Wallet.createRandom();
    const attacker = Wallet.createRandom();
    const actionHash =
      '0x9999999999999999999999999999999999999999999999999999999999999999';
    const sponsorProof = normalizePasskeySponsorProof(
      await attacker.signMessage(arrayify(actionHash))
    );

    expect(() =>
      verifyPasskeyRelayedSponsorProof(
        actionHash,
        sponsorProof,
        baseMetadata({
          mode: PasskeySponsorMode.Required,
          signer: sponsor.address,
        })
      )
    ).toThrow('does not match configured signer');
  });

  it('requires the stored deployment gas payer when metadata has one', () => {
    const account = {
      address: '0x1111111111111111111111111111111111111111',
      id: 0,
    };
    const metadata = {
      ...baseMetadata({ mode: PasskeySponsorMode.Disabled }),
      deploymentGasPayer: {
        address: account.address,
        id: 0,
        type: KeyringAccountType.HDAccount,
      },
    };
    const fallback = jest.fn();

    expect(
      selectPasskeyDeploymentGasPayer(
        { [KeyringAccountType.HDAccount]: { 0: account } },
        metadata,
        fallback
      )
    ).toEqual({ account, accountType: KeyringAccountType.HDAccount });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('does not silently fall back if the stored deployment gas payer is missing', () => {
    const metadata = {
      ...baseMetadata({ mode: PasskeySponsorMode.Disabled }),
      deploymentGasPayer: {
        address: '0x1111111111111111111111111111111111111111',
        id: 0,
        type: KeyringAccountType.HDAccount,
      },
    };

    expect(() =>
      selectPasskeyDeploymentGasPayer(
        { [KeyringAccountType.HDAccount]: {} },
        metadata,
        jest.fn()
      )
    ).toThrow('Passkey deployment gas payer is no longer available');
  });

  it('orders gas payer candidates by active software account, then HD, then imported', () => {
    const hd0 = {
      address: '0x1111111111111111111111111111111111111111',
      id: 0,
    };
    const hd1 = {
      address: '0x2222222222222222222222222222222222222222',
      id: 1,
    };
    const imported0 = {
      address: '0x3333333333333333333333333333333333333333',
      id: 0,
    };

    expect(
      getPasskeyGasPayerCandidates(
        {
          [KeyringAccountType.HDAccount]: { 0: hd0, 1: hd1 },
          [KeyringAccountType.Imported]: { 0: imported0 },
        },
        { id: 1, type: KeyringAccountType.HDAccount }
      )
    ).toEqual([
      { account: hd1, accountType: KeyringAccountType.HDAccount },
      { account: hd0, accountType: KeyringAccountType.HDAccount },
      { account: imported0, accountType: KeyringAccountType.Imported },
    ]);
  });

  it('ignores active passkey accounts when selecting software gas payer candidates', () => {
    const hd0 = {
      address: '0x1111111111111111111111111111111111111111',
      id: 0,
    };
    const passkey = {
      address: '0x4444444444444444444444444444444444444444',
      id: 0,
    };

    expect(
      getPasskeyGasPayerCandidates(
        {
          [KeyringAccountType.HDAccount]: { 0: hd0 },
          [KeyringAccountType.PasskeySmartAccount]: { 0: passkey },
        },
        { id: 0, type: KeyringAccountType.PasskeySmartAccount }
      )
    ).toEqual([{ account: hd0, accountType: KeyringAccountType.HDAccount }]);
  });

  it('filters non-EVM software accounts from gas payer candidates', () => {
    const hd0 = {
      address: '0x1111111111111111111111111111111111111111',
      id: 0,
    };
    const importedUtxo = {
      address: 'sys1q2d4h3j5k6l7m8n9p0q2d4h3j5k6l7m8n9p0q',
      id: 0,
    };
    const importedEvm = {
      address: '0x3333333333333333333333333333333333333333',
      id: 1,
    };

    expect(
      getPasskeyGasPayerCandidates(
        {
          [KeyringAccountType.HDAccount]: { 0: hd0 },
          [KeyringAccountType.Imported]: {
            0: importedUtxo,
            1: importedEvm,
          },
        },
        { id: 0, type: KeyringAccountType.Imported }
      )
    ).toEqual([
      { account: hd0, accountType: KeyringAccountType.HDAccount },
      { account: importedEvm, accountType: KeyringAccountType.Imported },
    ]);
  });

  it('selects an unfunded deterministic gas payer candidate for address prediction', () => {
    const hd0 = {
      address: '0x1111111111111111111111111111111111111111',
      id: 0,
    };

    expect(
      selectPasskeyGasPayerCandidate({
        [KeyringAccountType.HDAccount]: { 0: hd0 },
      })
    ).toEqual({ account: hd0, accountType: KeyringAccountType.HDAccount });
  });

  it('throws if no software gas payer candidate exists for address prediction', () => {
    expect(() =>
      selectPasskeyGasPayerCandidate({
        [KeyringAccountType.PasskeySmartAccount]: {
          0: {
            address: '0x4444444444444444444444444444444444444444',
            id: 0,
          },
        },
      })
    ).toThrow('No software account is available');
  });

  it('selects the first gas payer candidate that satisfies the required balance predicate', async () => {
    const hd0 = {
      address: '0x1111111111111111111111111111111111111111',
      id: 0,
    };
    const imported0 = {
      address: '0x3333333333333333333333333333333333333333',
      id: 0,
    };
    const hasRequiredBalance = jest
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(
      selectFundedPasskeyGasPayerCandidate(
        {
          [KeyringAccountType.HDAccount]: { 0: hd0 },
          [KeyringAccountType.Imported]: { 0: imported0 },
        },
        undefined,
        hasRequiredBalance
      )
    ).resolves.toEqual({
      account: imported0,
      accountType: KeyringAccountType.Imported,
    });
    expect(hasRequiredBalance).toHaveBeenCalledWith(hd0.address);
    expect(hasRequiredBalance).toHaveBeenCalledWith(imported0.address);
  });

  it('fails funded gas payer selection when no candidate satisfies required balance', async () => {
    await expect(
      selectFundedPasskeyGasPayerCandidate(
        {
          [KeyringAccountType.HDAccount]: {
            0: {
              address: '0x1111111111111111111111111111111111111111',
              id: 0,
            },
          },
        },
        undefined,
        jest.fn().mockResolvedValue(false)
      )
    ).rejects.toThrow('No funded software account is available');
  });

  it('uses a typed error for relayed transaction hashes that are not observed', () => {
    const error = new PasskeyRelayedTransactionNotFoundError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PasskeyRelayedTransactionNotFoundError');
    expect(error.message).toBe(
      'Sponsor relayed transaction was not found on-chain'
    );
  });

  it('rejects relayed payloads that do not match the prepared execution', () => {
    const execution = {
      data: '0x1234',
      deadline: 123,
      nonce: '7',
      target: '0x1111111111111111111111111111111111111111',
      value: '42',
    };
    const proof = {
      authenticatorData: '0xabcd',
      challengeOffset: 12,
      clientDataJSON: '0xef',
      originOffset: 48,
      r: '0x01',
      s: '0x02',
      typeOffset: 9,
    };

    expect(() =>
      assertPasskeyRelayPayloadMatches(execution, proof, execution, proof)
    ).not.toThrow();
    expect(() =>
      assertPasskeyRelayPayloadMatches(
        { ...execution, target: '0x2222222222222222222222222222222222222222' },
        proof,
        execution,
        proof
      )
    ).toThrow('Sponsor relayed a different passkey execution');
  });

  it('validates WebAuthn clientDataJSON type, challenge, origin, and crossOrigin', () => {
    const challenge = 'expectedChallenge';
    const origin = 'chrome-extension://pali';
    const encodeClientData = (overrides: Record<string, unknown> = {}) =>
      new TextEncoder().encode(
        JSON.stringify({
          challenge,
          origin,
          type: 'webauthn.get',
          ...overrides,
        })
      );

    const offsets = validatePasskeyClientDataJSON(
      encodeClientData(),
      challenge,
      origin
    );
    expect(offsets.challengeOffset).toBeGreaterThanOrEqual(0);
    expect(offsets.originOffset).toBeGreaterThanOrEqual(0);
    expect(offsets.typeOffset).toBeGreaterThanOrEqual(0);

    const spacedClientData = new TextEncoder().encode(
      `{
        "challenge" : "${challenge}",
        "origin" : "${origin}",
        "type" : "webauthn.get"
      }`
    );
    const spacedOffsets = validatePasskeyClientDataJSON(
      spacedClientData,
      challenge,
      origin
    );
    expect(
      spacedOffsets.clientDataText.slice(spacedOffsets.challengeOffset)
    ).toContain(challenge);
    expect(
      spacedOffsets.clientDataText.slice(spacedOffsets.originOffset)
    ).toContain(origin);
    expect(
      spacedOffsets.clientDataText.slice(spacedOffsets.typeOffset)
    ).toContain('webauthn.get');

    expect(() =>
      validatePasskeyClientDataJSON(
        encodeClientData({ challenge: 'bad' }),
        challenge,
        origin
      )
    ).toThrow('unexpected challenge');
    expect(() =>
      validatePasskeyClientDataJSON(
        encodeClientData({ crossOrigin: true }),
        challenge,
        origin
      )
    ).toThrow('Cross-origin WebAuthn assertions are not supported');
    expect(() =>
      validatePasskeyClientDataJSON(
        encodeClientData({ origin: 'https://evil.example' }),
        challenge,
        origin
      )
    ).toThrow('unexpected origin');
    expect(() =>
      validatePasskeyClientDataJSON(
        encodeClientData({ type: 'webauthn.create' }),
        challenge,
        origin
      )
    ).toThrow('unexpected type');
  });
});
