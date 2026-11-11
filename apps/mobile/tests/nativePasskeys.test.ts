import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import test from 'node:test';
import { id as textHash } from 'ethers/hash';
import { createNativePasskeyClient, type NativePasskeyPort } from '../src/smartAccount/passkeys.ts';

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const hash = (value: Uint8Array | string) => new Uint8Array(createHash('sha256').update(value).digest());
const concat = (...items: Uint8Array[]) => new Uint8Array(Buffer.concat(items));
function cbor(value: number | string | Uint8Array | Map<unknown, unknown>): Uint8Array {
  const head = (major: number, length: number) => length < 24 ? Uint8Array.of(major * 32 + length)
    : length < 256 ? Uint8Array.of(major * 32 + 24, length) : Uint8Array.of(major * 32 + 25, length >> 8, length & 255);
  if (typeof value === 'number') return head(value < 0 ? 1 : 0, value < 0 ? -value - 1 : value);
  if (typeof value === 'string') { const data = new TextEncoder().encode(value); return concat(head(3, data.length), data); }
  if (value instanceof Uint8Array) return concat(head(2, value.length), value);
  return concat(head(5, value.size), ...[...value].flatMap(([key, item]) => [cbor(key as number), cbor(item as number)]));
}
function der(raw: Uint8Array) {
  const integer = (value: Uint8Array) => {
    let first = 0;
    while (first < value.length - 1 && value[first] === 0) first++;
    const data = value.slice(first), sign = data[0]! & 0x80 ? Uint8Array.of(0) : new Uint8Array();
    return concat(Uint8Array.of(2, data.length + sign.length), sign, data);
  };
  const body = concat(integer(raw.slice(0, 32)), integer(raw.slice(32)));
  return concat(Uint8Array.of(0x30, body.length), body);
}
async function fixture() {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const point = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey));
  const id = Uint8Array.from({ length: 16 }, (_, i) => i + 1), user = Uint8Array.of(7);
  let sequence = 0;
  const cancelled: string[] = [], options: Record<string, unknown>[] = [];
  let origin = 'https://paliwallet.com', replyOrigin: string | undefined, replyChallenge: string | undefined;
  let wait: Promise<void> | undefined;
  let entered = () => {};
  const clientData = (type: string, challenge: string) => new TextEncoder().encode(JSON.stringify({ type,
    challenge: replyChallenge ?? challenge, origin: replyOrigin ?? origin, crossOrigin: false }));
  const port: NativePasskeyPort = {
    getContext: () => ({ rpId: 'paliwallet.com', origin }),
    prepare: () => `request-${++sequence}`,
    cancel: request => { cancelled.push(request); return true; },
    async create(_request, raw) {
      const value = JSON.parse(raw); options.push(value);
      const authData = concat(hash('paliwallet.com'), Uint8Array.of(0x45, 0, 0, 0, 0), new Uint8Array(16),
        Uint8Array.of(0, id.length), id, cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, point.slice(1, 33)], [-3, point.slice(33)]])));
      return JSON.stringify({ id: b64(id), rawId: b64(id), type: 'public-key', response: {
        clientDataJSON: b64(clientData('webauthn.create', value.challenge)),
        attestationObject: b64(cbor(new Map<unknown, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]))),
      } });
    },
    async get(_request, raw) {
      const value = JSON.parse(raw); options.push(value); entered(); await wait;
      const data = clientData('webauthn.get', value.challenge);
      const authData = concat(hash('paliwallet.com'), Uint8Array.of(5, 0, 0, 0, 0));
      const signature = new Uint8Array(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, concat(authData, hash(data))));
      return JSON.stringify({ id: b64(id), rawId: b64(id), type: 'public-key', response: {
        clientDataJSON: b64(data), authenticatorData: b64(authData), signature: b64(der(signature)), userHandle: b64(user),
      } });
    },
  };
  const client = createNativePasskeyClient({ port, randomBytes: length => webcrypto.getRandomValues(new Uint8Array(length)), present: (_signal, work) => work() });
  let live = true;
  const controller = new AbortController();
  const guard = { signal: controller.signal, assertCurrent() { if (!live) throw Error('STALE'); } };
  const key = { x: `0x${Buffer.from(point.slice(1, 33)).toString('hex')}`, y: `0x${Buffer.from(point.slice(33)).toString('hex')}`,
    rpIdHash: `0x${Buffer.from(hash('paliwallet.com')).toString('hex')}`, originHash: textHash(origin), originLength: origin.length };
  return { client, guard: { ...guard, expectedPublicKey: key }, controller, cancelled, options, stale() { live = false; },
    origin(value: string) { origin = value; }, replyOrigin(value: string) { replyOrigin = value; }, replyChallenge(value: string) { replyChallenge = value; },
    hold() { const held = Promise.withResolvers<void>(), started = Promise.withResolvers<void>(); wait = held.promise; entered = () => started.resolve(); return { ...held, started: started.promise }; },
  };
}

test('native registration and signing use genuine P256 responses and the shared proof encoder', async () => {
  const f = await fixture(), profile = await f.client.create({ ...f.guard, accountName: 'Primary' });
  const signed = await f.client.sign({ ...f.guard, actionHash: `0x${'42'.repeat(32)}`, credentialId: profile.credentialId,
    expectedCredentialIdHash: profile.credentialIdHash, expectedPublicKey: profile });
  assert.match(signed.signature, /^0x[0-9a-f]+$/i);
  assert.equal(f.options.length, 2);
  assert.equal((f.options[0]!.authenticatorSelection as { userVerification: string }).userVerification, 'required');
  assert.equal(f.options[1]!.userVerification, 'required');
  assert.deepEqual(f.cancelled, ['request-1', 'request-2']);
});
test('native recovery reuses the shared one-known-key or two-assertion recovery flow', async () => {
  const f = await fixture(), profile = await f.client.create({ ...f.guard, accountName: 'Primary' });
  const known = await f.client.recover({ ...f.guard, expectedPublicKey: profile, expectedCredentialIdHash: profile.credentialIdHash });
  assert.equal(known.publicKey.x, profile.x); assert.equal(f.options.length, 2);
  const discovered = await f.client.recover({ signal: f.guard.signal, assertCurrent: f.guard.assertCurrent });
  assert.equal(discovered.publicKey.y, profile.y); assert.equal(f.options.length, 4);
});
for (const mismatch of ['origin', 'challenge', 'credential'] as const) test(`native signing refuses a mismatched ${mismatch}`, async () => {
  const f = await fixture();
  if (mismatch === 'origin') f.replyOrigin('https://evil.example');
  if (mismatch === 'challenge') f.replyChallenge(b64(new Uint8Array(32)));
  await assert.rejects(f.client.sign({ ...f.guard, actionHash: `0x${'42'.repeat(32)}`,
    ...(mismatch === 'credential' ? { credentialId: b64(Uint8Array.of(99)) } : {}) }));
});
test('native request cancellation revokes its ticket and discards a late OS response', async () => {
  const f = await fixture(), hold = f.hold();
  const signing = f.client.sign({ ...f.guard, actionHash: `0x${'42'.repeat(32)}` });
  await hold.started;
  await assert.rejects(f.client.sign({ ...f.guard, actionHash: `0x${'42'.repeat(32)}` }), /already active/);
  f.controller.abort(); await assert.rejects(signing); hold.resolve();
  assert(f.cancelled.includes('request-1'));
});
test('an owner change while the OS response waits cannot publish a signature', async () => {
  const f = await fixture(), hold = f.hold();
  const signing = f.client.sign({ ...f.guard, actionHash: `0x${'42'.repeat(32)}` });
  await hold.started; f.stale(); hold.resolve(); await assert.rejects(signing, /STALE/);
});
test('bad host identity cannot wedge the next valid ceremony', async () => {
  const f = await fixture(); f.origin('https://evil.example');
  await assert.rejects(f.client.create({ ...f.guard, accountName: 'Primary' }), /identity/);
  f.origin('https://paliwallet.com');
  assert(await f.client.create({ ...f.guard, accountName: 'Primary' }));
});
test('native signing cannot omit the configured public key', async () => {
  const f = await fixture();
  const request = { signal: f.guard.signal, assertCurrent: f.guard.assertCurrent, actionHash: `0x${'42'.repeat(32)}` };
  await assert.rejects(f.client.sign(request as Parameters<typeof f.client.sign>[0]), /identity is required/);
  assert.equal(f.options.length, 0);
});
