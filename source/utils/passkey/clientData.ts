export type PasskeyClientDataType = 'webauthn.create' | 'webauthn.get';

/** Shared field checks. Callers own their input limits and ceremony policy. */
export const readPasskeyClientData = (
  clientDataText: string,
  expectedType: PasskeyClientDataType,
  expectedChallenge: string,
  expectedOrigin?: string
) => {
  const clientData = JSON.parse(clientDataText);
  if (clientData.type !== expectedType) {
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
  return clientData;
};
