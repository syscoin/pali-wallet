import { defaultAbiCoder } from '@ethersproject/abi';

export type PasskeyWebAuthnProof = {
  authenticatorData: string;
  challengeOffset: number;
  clientDataJSON: string;
  originOffset: number;
  r: string;
  s: string;
  typeOffset: number;
};

export const encodePasskeyWebAuthnProof = (proof: PasskeyWebAuthnProof) =>
  defaultAbiCoder.encode(
    [
      'tuple(bytes authenticatorData,bytes clientDataJSON,uint256 typeOffset,uint256 challengeOffset,uint256 originOffset,bytes32 r,bytes32 s)',
    ],
    [proof]
  );

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

  return {
    challengeOffset: findStringValueOffset('challenge', expectedChallenge),
    clientDataText,
    originOffset: findStringValueOffset(
      'origin',
      expectedOrigin || clientData.origin
    ),
    typeOffset: findStringValueOffset('type', 'webauthn.get'),
  };
};
