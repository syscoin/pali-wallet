import { abortable } from '../../../../source/shared/boundedHttp.ts';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import { base64UrlToBytes, bytesToBase64Url, hexToBytes } from '../../../../source/utils/passkey/base64url.ts';
import { admitPasskeyActionSignature } from '../../../../source/utils/passkey/execution.ts';
import { recoverPasskeyProfile, normalizePasskeyAssertion, normalizePasskeyRegistration,
  type PasskeyRegistrationResult, type RecoveredPasskeyProfile } from '../../../../source/utils/passkey/webauthn.ts';
import type { SmartAccountAuthenticatorPorts, SmartAccountAuthenticatorSignature } from '../../../../source/utils/smartAccount/authenticatorDispatch.ts';

export const NATIVE_PASSKEY_RP_ID = 'paliwallet.com';
type Guard = Readonly<{ assertCurrent(): void; signal: AbortSignal }>;
type SigningRequest = Parameters<NonNullable<SmartAccountAuthenticatorPorts['p256WebAuthn']>['signActionHash']>[0];
export type NativePasskeyCapability = Readonly<{
  create(request: Guard & { accountName: string }): Promise<PasskeyRegistrationResult>;
  recover(request: Guard & { expectedCredentialIdHash?: string; expectedPublicKey?: { x: string; y: string } }): Promise<RecoveredPasskeyProfile>;
  sign(request: Guard & SigningRequest): Promise<SmartAccountAuthenticatorSignature>;
}>;
export type NativePasskeyPort = Readonly<{
  getContext(): { rpId: string; origin: string };
  prepare(): string;
  create(id: string, options: string): Promise<string>;
  get(id: string, options: string): Promise<string>;
  cancel(id: string): boolean;
}>;

function bytes(value: unknown, min: number, max: number): Uint8Array {
  if (typeof value !== 'string' || value.length > Math.ceil(max * 4 / 3) || !/^[A-Za-z0-9_-]*$/.test(value))
    throw Error('Invalid passkey response');
  const decoded = base64UrlToBytes(value);
  if (decoded.length < min || decoded.length > max || bytesToBase64Url(decoded) !== value)
    throw Error('Invalid passkey response');
  return decoded;
}
function response(raw: string) {
  if (typeof raw !== 'string' || raw.length > 65_536) throw Error('Invalid passkey response');
  const result = JSON.parse(raw);
  if (!result || result.type !== 'public-key' || !result.response || result.id !== result.rawId)
    throw Error('Invalid passkey response');
  return { result: result.response, rawId: bytes(result.rawId, 1, 1023) };
}

/** Native owns credential acquisition; all proof validation remains shared with the extension. */
export function createNativePasskeyClient(host: Readonly<{
  port: NativePasskeyPort;
  randomBytes(length: number): Uint8Array;
  present(signal: AbortSignal, request: () => Promise<string>): Promise<string>;
}>): NativePasskeyCapability {
  let busy = false;
  const random = () => {
    const value = host.randomBytes(32);
    if (!(value instanceof Uint8Array) || value.length !== 32) throw Error('Passkey randomness unavailable');
    return new Uint8Array(value);
  };
  const context = () => {
    const value = host.port.getContext();
    if (value?.rpId !== NATIVE_PASSKEY_RP_ID || (value.origin !== `https://${NATIVE_PASSKEY_RP_ID}` &&
      !/^android:apk-key-hash:[A-Za-z0-9_-]{43}$/.test(value.origin))) throw Error('Passkey identity unavailable');
    return Object.freeze({ rpId: value.rpId, origin: value.origin });
  };
  async function ceremony<T>(request: Guard, work: (execute: (kind: 'create' | 'get', options: object) => Promise<ReturnType<typeof response>>,
    expected: ReturnType<typeof context>) => Promise<T>): Promise<T> {
    const check = () => { if (request.signal.aborted) throw Error('CANCELLED'); assertSynchronousEvmFeeGuard(request.assertCurrent); };
    check();
    if (busy) throw Error('Passkey request already active');
    const identity = context();
    busy = true;
    try {
      const execute = async (kind: 'create' | 'get', options: object) => {
        check();
        if (JSON.stringify(context()) !== JSON.stringify(identity)) throw Error('Passkey identity changed');
        const id = host.port.prepare();
        if (typeof id !== 'string' || !id || id.length > 128) throw Error('Passkey request unavailable');
        const lifetime = new AbortController();
        const cancel = () => { lifetime.abort(); host.port.cancel(id); };
        request.signal.addEventListener('abort', cancel, { once: true });
        const timer = setTimeout(cancel, 90_000);
        try {
          check();
          const raw = await host.present(request.signal, () => abortable(host.port[kind](id, JSON.stringify(options)), lifetime.signal));
          check();
          if (lifetime.signal.aborted || JSON.stringify(context()) !== JSON.stringify(identity)) throw Error('CANCELLED');
          return response(raw);
        } finally {
          clearTimeout(timer); request.signal.removeEventListener('abort', cancel); host.port.cancel(id);
        }
      };
      const result = await work(execute, identity);
      check();
      return result;
    } finally { busy = false; }
  }
  const assert = async (execute: Parameters<Parameters<typeof ceremony>[1]>[0], identity: ReturnType<typeof context>,
    request: Guard, challenge: Uint8Array, credentialId?: string) => {
    const expectedId = credentialId === undefined ? undefined : bytes(credentialId, 1, 1023);
    const { result, rawId } = await execute('get', { challenge: bytesToBase64Url(challenge), rpId: identity.rpId,
      timeout: 90_000, userVerification: 'required', ...(expectedId ? { allowCredentials: [{ type: 'public-key', id: credentialId }] } : {}) });
    return normalizePasskeyAssertion({ rawId, authenticatorData: bytes(result.authenticatorData, 37, 16_384),
      clientDataJSON: bytes(result.clientDataJSON, 1, 16_384), signature: bytes(result.signature, 8, 72),
      ...(result.userHandle === undefined || result.userHandle === null ? {} : { userHandle: bytes(result.userHandle, 0, 64) }) },
    { ...identity, challenge, assertCurrent: request.assertCurrent }, expectedId);
  };
  return Object.freeze({
    create(request) {
      return ceremony(request, async (execute, identity) => {
        if (typeof request.accountName !== 'string' || !request.accountName.trim() || request.accountName.length > 80)
          throw Error('Invalid passkey name');
        const challenge = random(), userId = random();
        const { result, rawId } = await execute('create', { challenge: bytesToBase64Url(challenge),
          rp: { id: identity.rpId, name: 'Pali Wallet' }, user: { id: bytesToBase64Url(userId), name: request.accountName, displayName: request.accountName },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }], attestation: 'none', timeout: 90_000,
          authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' } });
        return normalizePasskeyRegistration({ rawId, attestationObject: bytes(result.attestationObject, 1, 16_384),
          clientDataJSON: bytes(result.clientDataJSON, 1, 16_384) }, userId, { ...identity, challenge, assertCurrent: request.assertCurrent });
      });
    },
    sign(request) {
      return ceremony(request, async (execute, identity) => {
        if (!request.expectedPublicKey) throw Error('Configured passkey identity is required');
        const challenge = hexToBytes(request.actionHash);
        if (challenge.length !== 32) throw Error('Invalid passkey action');
        return admitPasskeyActionSignature(await assert(execute, identity, request, challenge, request.credentialId), request);
      });
    },
    recover(request) {
      return ceremony(request, (execute, identity) => recoverPasskeyProfile({ ...request,
        acquireAssertion: credentialId => assert(execute, identity, request, random(), credentialId) }));
    },
  });
}
