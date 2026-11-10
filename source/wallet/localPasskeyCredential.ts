import { hexToBytes } from '../utils/passkey/base64url';
import { normalizePasskeyRegistration } from '../utils/passkey/webauthn';

import type { DeviceUnlockCredentialScope } from './deviceUnlockEnrollment';
import {
  captureLocalPasskeyResponse,
  checkLocalPasskeyOwner,
  localPasskeyBase64,
  localPasskeyBytes,
  localPasskeyError,
  localPasskeyField,
  localPasskeyFields,
  localPasskeyOrigin,
  type LocalPasskeyCeremonyPort,
} from './localPasskeyTypes';
import {
  admitQuickUnlockWebAuthnResponse,
  verifyQuickUnlockEs256Assertion,
} from './quickUnlockWebauthn';
import {
  unwrapQuickUnlockKey,
  wrapQuickUnlockKey,
  type QuickUnlockEnvelope,
  type QuickUnlockScope,
} from './quickUnlockWrapping';

export type LocalPasskeyRecord = Readonly<{
  credentialId: string;
  envelope: QuickUnlockEnvelope;
  origin: string;
  prfSalt: string;
  publicKey: string;
  scope: DeviceUnlockCredentialScope;
  version: 1;
}>;
export type LocalPasskeyStorage = Readonly<{
  read(scope: DeviceUnlockCredentialScope): Promise<unknown>;
  remove(
    scope: DeviceUnlockCredentialScope,
    assertCurrent: () => void
  ): Promise<void>;
  /** The host must durably save and read back this exact inactive enrollment. */
  stage(
    scope: DeviceUnlockCredentialScope,
    record: LocalPasskeyRecord,
    assertCurrent: () => void
  ): Promise<void>;
}>;
const scopeKeys = [
  'installationId',
  'walletBindingId',
  'pairFingerprint',
  'enrollmentId',
] as const;
export function captureLocalPasskeyScope(
  value: DeviceUnlockCredentialScope
): DeviceUnlockCredentialScope {
  localPasskeyFields(value, scopeKeys);
  const result: Record<string, string> = {};
  for (const key of scopeKeys) {
    const field = localPasskeyField(value, key);
    if (
      typeof field !== 'string' ||
      field.length > 128 ||
      !/^[A-Za-z0-9._:-]+$/.test(field) ||
      (key === 'pairFingerprint' && !/^[0-9a-f]{64}$/.test(field))
    )
      throw localPasskeyError();
    result[key] = field;
  }
  return Object.freeze(result) as DeviceUnlockCredentialScope;
}
function wrappingScope(
  scope: DeviceUnlockCredentialScope,
  origin: string,
  credentialId: Uint8Array<ArrayBuffer>,
  prfSalt: Uint8Array<ArrayBuffer>
): QuickUnlockScope {
  return {
    ...scope,
    profileId: scope.walletBindingId,
    rpId: origin,
    credentialId,
    prfSalt,
  };
}
export function captureLocalPasskeyRecord(
  value: unknown,
  scope: DeviceUnlockCredentialScope,
  origin: string
): LocalPasskeyRecord {
  localPasskeyFields(value, [
    'version',
    'scope',
    'origin',
    'credentialId',
    'prfSalt',
    'publicKey',
    'envelope',
  ]);
  const savedScope = captureLocalPasskeyScope(
    localPasskeyField(value, 'scope') as DeviceUnlockCredentialScope
  );
  if (
    localPasskeyField(value, 'version') !== 1 ||
    localPasskeyField(value, 'origin') !== origin ||
    scopeKeys.some((key) => savedScope[key] !== scope[key])
  )
    throw localPasskeyError();
  const result: Record<string, unknown> = {
    version: 1,
    scope: savedScope,
    origin,
  };
  for (const [key, min, max] of [
    ['credentialId', 1, 1023],
    ['prfSalt', 32, 32],
    ['publicKey', 91, 91],
  ] as const) {
    const encoded = localPasskeyField(value, key),
      bytes = localPasskeyBytes(encoded, min, max);
    bytes.fill(0);
    result[key] = encoded;
  }
  const envelope = localPasskeyField(value, 'envelope');
  if (
    typeof envelope !== 'string' ||
    !/^v1:[0-9a-f]{24}:[0-9a-f]{96}$/.test(envelope)
  )
    throw localPasskeyError();
  result.envelope = envelope;
  return Object.freeze(result) as LocalPasskeyRecord;
}

/** Background-only credential adapter. It never verifies or stores a wallet password. */
export function createLocalPasskeyCredentialPort(
  ports: Readonly<{
    ceremonies: LocalPasskeyCeremonyPort;
    crypto: Pick<Crypto, 'subtle' | 'getRandomValues'>;
    origin: string;
    storage: LocalPasskeyStorage;
  }>
) {
  const origin = localPasskeyOrigin(ports.origin);
  const random = () => ports.crypto.getRandomValues(new Uint8Array(32));
  const assertRecord = async (
    scope: DeviceUnlockCredentialScope,
    check: () => void
  ) => {
    const record = await ports.storage.read(scope);
    checkLocalPasskeyOwner(check);
    return captureLocalPasskeyRecord(record, scope, origin);
  };
  const assertSameRecord = async (
    record: LocalPasskeyRecord,
    check: () => void
  ) => {
    const current = await assertRecord(record.scope, check);
    if (JSON.stringify(current) !== JSON.stringify(record))
      throw localPasskeyError();
  };
  const assert = async (
    record: Omit<LocalPasskeyRecord, 'envelope'>,
    check: () => void
  ) => {
    const challenge = random(),
      credential = localPasskeyBytes(record.credentialId, 1, 1023),
      salt = localPasskeyBytes(record.prfSalt, 32);
    let output: Uint8Array<ArrayBuffer> | undefined;
    try {
      checkLocalPasskeyOwner(check);
      const response = captureLocalPasskeyResponse(
        await ports.ceremonies.request(
          {
            kind: 'get',
            challenge: localPasskeyBase64(challenge),
            origin,
            credentialId: record.credentialId,
            prfSalt: record.prfSalt,
          },
          check
        )
      );
      checkLocalPasskeyOwner(check);
      if (response.kind !== 'get') throw localPasskeyError();
      output = localPasskeyBytes(response.prfOutput, 32);
      const expected = {
        type: 'webauthn.get',
        challenge,
        origin,
        rpId: origin,
        credentialId: credential,
      } as const;
      const raw = {
        type: 'public-key',
        rawId: localPasskeyBytes(response.rawId, 1, 1023),
        clientDataJSON: localPasskeyBytes(response.clientDataJSON, 1, 4096),
        authenticatorData: localPasskeyBytes(
          response.authenticatorData,
          37,
          4096
        ),
        signature: localPasskeyBytes(response.signature, 1, 1024),
        prfOutput: output,
      } as const;
      const admitted = await admitQuickUnlockWebAuthnResponse(
        expected,
        raw,
        check,
        ports.crypto.subtle
      );
      try {
        if (admitted.kind !== 'assertion-needs-signature-verification')
          throw localPasskeyError();
        await verifyQuickUnlockEs256Assertion(
          expected,
          raw,
          localPasskeyBytes(record.publicKey, 91),
          check,
          ports.crypto.subtle
        );
        checkLocalPasskeyOwner(check);
        return {
          output: admitted.prfOutput,
          wrapping: wrappingScope(record.scope, origin, credential, salt),
        };
      } catch (error) {
        if (admitted.kind === 'assertion-needs-signature-verification')
          admitted.prfOutput.fill(0);
        throw error;
      }
    } finally {
      challenge.fill(0);
      output?.fill(0);
    }
  };
  return Object.freeze({
    async available() {
      return true;
    },
    async stage(
      input: DeviceUnlockCredentialScope,
      key: Uint8Array,
      check: () => void
    ) {
      const scope = captureLocalPasskeyScope(input),
        challenge = random(),
        userHandle = random(),
        salt = random();
      let capturedKey: Uint8Array<ArrayBuffer> | undefined;
      try {
        checkLocalPasskeyOwner(check);
        if (!(key instanceof Uint8Array) || key.length !== 32)
          throw localPasskeyError();
        capturedKey = new Uint8Array(key);
        const response = captureLocalPasskeyResponse(
          await ports.ceremonies.request(
            {
              kind: 'create',
              origin,
              challenge: localPasskeyBase64(challenge),
              prfSalt: localPasskeyBase64(salt),
              userHandle: localPasskeyBase64(userHandle),
            },
            check
          )
        );
        checkLocalPasskeyOwner(check);
        if (response.kind !== 'create') throw localPasskeyError();
        const registration = await normalizePasskeyRegistration(
          {
            rawId: localPasskeyBytes(response.rawId, 1, 1023),
            clientDataJSON: localPasskeyBytes(response.clientDataJSON, 1, 4096),
            attestationObject: localPasskeyBytes(
              response.attestationObject,
              1,
              16384
            ),
          },
          userHandle,
          { challenge, origin, rpId: origin, assertCurrent: check }
        );
        checkLocalPasskeyOwner(check);
        const publicKey = await ports.crypto.subtle.importKey(
          'jwk',
          {
            kty: 'EC',
            crv: 'P-256',
            x: localPasskeyBase64(hexToBytes(registration.x)),
            y: localPasskeyBase64(hexToBytes(registration.y)),
          },
          { name: 'ECDSA', namedCurve: 'P-256' },
          true,
          ['verify']
        );
        checkLocalPasskeyOwner(check);
        const spki = new Uint8Array(
          await ports.crypto.subtle.exportKey('spki', publicKey)
        );
        checkLocalPasskeyOwner(check);
        const partial = Object.freeze({
          version: 1 as const,
          scope,
          origin,
          credentialId: registration.credentialId,
          prfSalt: localPasskeyBase64(salt),
          publicKey: localPasskeyBase64(spki),
        });
        const proved = await assert(partial, check);
        try {
          const envelope = await wrapQuickUnlockKey(
            proved.wrapping,
            proved.output,
            capturedKey,
            check,
            ports.crypto
          );
          checkLocalPasskeyOwner(check);
          const record = Object.freeze({ ...partial, envelope });
          await ports.storage.stage(scope, record, check);
          checkLocalPasskeyOwner(check);
          await assertSameRecord(record, check);
        } finally {
          proved.output.fill(0);
        }
      } finally {
        challenge.fill(0);
        userHandle.fill(0);
        salt.fill(0);
        capturedKey?.fill(0);
      }
    },
    async read(
      input: DeviceUnlockCredentialScope,
      check: () => void
    ): Promise<Uint8Array | null> {
      const scope = captureLocalPasskeyScope(input);
      checkLocalPasskeyOwner(check);
      const record = await assertRecord(scope, check),
        proved = await assert(record, check);
      let key: Uint8Array | undefined;
      try {
        key = await unwrapQuickUnlockKey(
          proved.wrapping,
          proved.output,
          record.envelope,
          check,
          ports.crypto
        );
        await assertSameRecord(record, check);
        checkLocalPasskeyOwner(check);
        const delivered = key;
        key = undefined;
        return delivered;
      } finally {
        proved.output.fill(0);
        key?.fill(0);
      }
    },
    async remove(input: DeviceUnlockCredentialScope, check: () => void) {
      const scope = captureLocalPasskeyScope(input);
      checkLocalPasskeyOwner(check);
      await ports.storage.remove(scope, check);
      checkLocalPasskeyOwner(check);
    },
  });
}
