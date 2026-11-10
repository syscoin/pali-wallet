import { createHash, webcrypto } from 'crypto';

import {
  localPasskeyBase64 as b64,
  localPasskeyBytes,
  type LocalPasskeyRequest,
  type LocalPasskeyResponse,
} from '../../source/wallet/localPasskeyTypes';

export const localPasskeyTestCrypto = webcrypto as unknown as Crypto;
const crypto = localPasskeyTestCrypto;
const sha = (value: Uint8Array) =>
  new Uint8Array(createHash('sha256').update(value).digest());
const utf8 = (value: string) => new TextEncoder().encode(value);
const append = (...values: Uint8Array[]) =>
  Uint8Array.from(values.flatMap((value) => [...value]));
const integer = (value: Uint8Array) => {
  let offset = 0;
  while (offset < value.length - 1 && value[offset] === 0) offset++;
  const data = value.slice(offset);
  return data[0] & 128 ? append(Uint8Array.of(0), data) : data;
};
const der = (raw: Uint8Array) => {
  const r = integer(raw.slice(0, 32)),
    s = integer(raw.slice(32));
  return append(
    Uint8Array.of(0x30, r.length + s.length + 4, 2, r.length),
    r,
    Uint8Array.of(2, s.length),
    s
  );
};
function cbor(
  value: number | string | Uint8Array | Map<unknown, unknown>
): Uint8Array {
  const size = (major: number, n: number) =>
    n < 24
      ? Uint8Array.of(major * 32 + n)
      : n < 256
      ? Uint8Array.of(major * 32 + 24, n)
      : Uint8Array.of(major * 32 + 25, n >> 8, n & 255);
  if (typeof value === 'number')
    return size(value < 0 ? 1 : 0, value < 0 ? -1 - value : value);
  if (typeof value === 'string')
    return append(size(3, utf8(value).length), utf8(value));
  if (value instanceof Uint8Array) return append(size(2, value.length), value);
  return append(
    size(5, value.size),
    ...[...value].flatMap(([key, item]) => [
      cbor(key as never),
      cbor(item as never),
    ])
  );
}
/** Test-only P-256 credential; signs the exact challenge and origin supplied by the ceremony. */
export async function createLocalPasskeyResponseFixture(origin: string) {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey),
    id = new Uint8Array(16).fill(7),
    prf = new Uint8Array(32).fill(8);
  let wrongPrf = false,
    wrongSignature = false,
    requests = 0;
  const respond = async (
    request: LocalPasskeyRequest
  ): Promise<LocalPasskeyResponse> => {
    requests++;
    const clientDataJSON = utf8(
      JSON.stringify({
        type: `webauthn.${request.kind}`,
        challenge: request.challenge,
        origin,
        crossOrigin: false,
      })
    );
    const header = append(
      sha(utf8(origin)),
      Uint8Array.of(request.kind === 'create' ? 0x45 : 0x05, 0, 0, 0, 0)
    );
    if (request.kind === 'create') {
      const key = new Map([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, localPasskeyBytes(jwk.x, 32)],
        [-3, localPasskeyBytes(jwk.y, 32)],
      ] as [number, number | Uint8Array][]);
      const auth = append(
        header,
        new Uint8Array(16),
        Uint8Array.of(0, id.length),
        id,
        cbor(key)
      );
      return {
        kind: 'create',
        rawId: b64(id),
        clientDataJSON: b64(clientDataJSON),
        prfEnabled: true,
        attestationObject: b64(
          cbor(
            new Map([
              ['fmt', 'none'],
              ['authData', auth],
              ['attStmt', new Map()],
            ] as [string, unknown][])
          )
        ),
      };
    }
    const raw = new Uint8Array(
      await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        pair.privateKey,
        append(header, sha(clientDataJSON))
      )
    );
    const signature = der(raw);
    if (wrongSignature) signature[signature.length - 1] ^= 1;
    return {
      kind: 'get',
      rawId: b64(id),
      clientDataJSON: b64(clientDataJSON),
      authenticatorData: b64(header),
      signature: b64(signature),
      prfOutput: b64(wrongPrf ? new Uint8Array(32).fill(9) : prf),
    };
  };
  return {
    respond,
    get requests() {
      return requests;
    },
    tamperPrf() {
      wrongPrf = true;
    },
    tamperSignature() {
      wrongSignature = true;
    },
  };
}
