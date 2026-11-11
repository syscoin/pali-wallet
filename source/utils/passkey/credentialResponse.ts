/** Trusted ceremony inputs from the host, never inferred from returned data. */
export type PasskeyCeremonyExpectation = Readonly<{
  assertCurrent: () => void;
  challenge: Uint8Array;
  origin: string;
  /** Explicit effective RP ID; native hosts must supply their authorized RP. */
  rpId: string;
}>;

export type RawPasskeyRegistration = Readonly<{
  attestationObject: Uint8Array;
  clientDataJSON: Uint8Array;
  rawId: Uint8Array;
}>;

export type RawPasskeyAssertion = Readonly<{
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  rawId: Uint8Array;
  signature: Uint8Array;
  userHandle?: Uint8Array;
}>;

export const MAX_PASSKEY_RESPONSE_BYTES = 16_384;
export const MAX_PASSKEY_CREDENTIAL_BYTES = 1023;

export const copyPasskeyBytes = (
  value: Uint8Array,
  name: string,
  min: number,
  max: number
): Uint8Array => {
  if (
    !(value instanceof Uint8Array) ||
    !(value.buffer instanceof ArrayBuffer) ||
    value.byteLength < min ||
    value.byteLength > max
  ) {
    throw new Error(`Invalid WebAuthn ${name}`);
  }
  return new Uint8Array(value);
};

export const equalPasskeyBytes = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

/** A guard must complete synchronously, including after each async hash. */
export const checkPasskeyCurrent = (assertCurrent: () => void): void => {
  const result: unknown = assertCurrent();
  if (result === undefined) return;
  if (result && (typeof result === 'object' || typeof result === 'function')) {
    void Promise.resolve(result).catch(() => undefined);
  }
  throw new Error('WebAuthn current-owner guard must be synchronous');
};

export const capturePasskeyExpectation = (
  expected: PasskeyCeremonyExpectation
): PasskeyCeremonyExpectation => {
  if (
    !expected ||
    typeof expected.origin !== 'string' ||
    !expected.origin ||
    expected.origin.length > 512 ||
    typeof expected.rpId !== 'string' ||
    !expected.rpId ||
    expected.rpId.length > 253 ||
    typeof expected.assertCurrent !== 'function'
  ) {
    throw new Error('WebAuthn requires a trusted origin and RP ID');
  }
  const captured = {
    assertCurrent: expected.assertCurrent,
    challenge: copyPasskeyBytes(expected.challenge, 'challenge', 1, 1024),
    origin: expected.origin,
    rpId: expected.rpId,
  };
  checkPasskeyCurrent(captured.assertCurrent);
  return captured;
};

export const admitPasskeyAuthenticatorData = (
  bytes: Uint8Array,
  registration: boolean
): void => {
  const flags = bytes[32]!;
  if (
    bytes.length < 37 ||
    (flags & 0x05) !== 0x05 || // User presence and verification were requested.
    !!(flags & 0x40) !== registration ||
    ((flags & 0x10) !== 0 && (flags & 0x08) === 0) ||
    (!registration && !!(flags & 0x80) !== bytes.length > 37)
  ) {
    throw new Error('Invalid WebAuthn authenticator data');
  }
};
