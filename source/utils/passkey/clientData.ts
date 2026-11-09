export type PasskeyClientDataType = 'webauthn.create' | 'webauthn.get';

const criticalFields = new Set([
  'type',
  'challenge',
  'origin',
  'crossOrigin',
  'topOrigin',
]);

/** Shared ceremony checks. Callers supply trusted expectations and input limits. */
export const readPasskeyClientData = (
  clientDataText: string,
  expectedType: PasskeyClientDataType,
  expectedChallenge: string,
  expectedOrigin: string
) => {
  if (typeof expectedOrigin !== 'string' || !expectedOrigin) {
    throw new Error('WebAuthn requires a trusted origin');
  }
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
  if (clientData.origin !== expectedOrigin) {
    throw new Error('WebAuthn client data has an unexpected origin');
  }
  if (
    !['type', 'challenge', 'origin'].every((field) =>
      Object.prototype.hasOwnProperty.call(clientData, field)
    ) ||
    'topOrigin' in clientData ||
    (clientData.crossOrigin !== undefined && clientData.crossOrigin !== false)
  ) {
    throw new Error('Invalid WebAuthn client data');
  }
  // JSON.parse collapses duplicate keys; signed ceremony fields must be unique.
  const seen = new Set<string>();
  let depth = 0;
  for (const [token, literal, colon] of clientDataText.matchAll(
    /("(?:[^"\\]|\\.)*")\s*(:)?|[[\]{}]/g
  )) {
    if (token === '{' || token === '[') depth++;
    if (token === '}' || token === ']') depth--;
    if (depth !== 1 || !colon) continue;
    const field: string = JSON.parse(literal!);
    if (!criticalFields.has(field)) continue;
    if (seen.has(field))
      throw new Error('Duplicate WebAuthn client data field');
    seen.add(field);
  }
  return clientData;
};

/** Decode the original signed bytes strictly; do not reserialize client data. */
export const readPasskeyClientDataJSON = (
  clientDataJSON: Uint8Array,
  expectedType: PasskeyClientDataType,
  expectedChallenge: string,
  expectedOrigin: string
) => {
  const clientDataText = new TextDecoder('utf-8', {
    fatal: true,
    ignoreBOM: true,
  }).decode(clientDataJSON);
  return {
    clientData: readPasskeyClientData(
      clientDataText,
      expectedType,
      expectedChallenge,
      expectedOrigin
    ),
    clientDataText,
  };
};
