import { SLH_DSA_DERIVATION_VERSION, SLH_DSA_PARAMETER_SET } from './constants';
import { bytesToHex, concatBytes, hexToBytes } from './hex';

const textEncoder = new TextEncoder();

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes);
  return copy.buffer;
};

export const getSLHDSADerivationLabel = (accountIndex: number) =>
  `PALI/${SLH_DSA_PARAMETER_SET}/v${SLH_DSA_DERIVATION_VERSION}/account/${accountIndex}`;

const hmacSha512 = async (keyBytes: Uint8Array, label: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(keyBytes),
    { hash: 'SHA-512', name: 'HMAC' },
    false,
    ['sign']
  );
  return new Uint8Array(
    await crypto.subtle.sign('HMAC', key, textEncoder.encode(label))
  );
};

export const deriveSLHDSASeedMaterial = async (setupSecretHex: string) => {
  const setupSecret = hexToBytes(setupSecretHex);
  const [skSeed, skPrf, pkSeed] = await Promise.all([
    hmacSha512(setupSecret, 'PALI/SLH2128_24/SKSEED'),
    hmacSha512(setupSecret, 'PALI/SLH2128_24/SKPRF'),
    hmacSha512(setupSecret, 'PALI/SLH2128_24/PKSEED'),
  ]);

  return {
    pkSeedHex: bytesToHex(pkSeed.slice(0, 16)),
    seed48Hex: bytesToHex(
      concatBytes(skSeed.slice(0, 16), skPrf.slice(0, 16), pkSeed.slice(0, 16))
    ),
    skPrfHex: bytesToHex(skPrf.slice(0, 16)),
    skSeedHex: bytesToHex(skSeed.slice(0, 16)),
  };
};
