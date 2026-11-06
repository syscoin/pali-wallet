import { httpBuild, httpLaunch } from './http-contract.ts';

export const PUBLIC_POOL_ID = 'eth-1';
export const PUBLIC_POOL_ADDRESS = '0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936';
export const PUBLIC_POOL_PATH = '/api/privacy/v1/pools/eth-1/snapshot';
export const PUBLIC_POOL_BLOCK = 20_000_000;
export const PUBLIC_POOL_BLOCK_HASH = '0x' + '37'.repeat(32);
export const PUBLIC_POOL_LEAVES = 1025;
export const PUBLIC_POOL_BATCHES = 9;
// Fixed synthetic depth-20 tree for leaves 1..1025, with the Classic empty
// leaf. Generated offline by a separate bottom-up MiMC sponge reference,
// checked against the existing independently generated 17-leaf vector.
export const PUBLIC_POOL_ROOT = '0x12144900eac27f8d1e0ec41898fe435ec18afb4e435a476fd53b3bf2bc7293ac';
export const PUBLIC_POOL_PATH_DIGESTS = Object.freeze([
  '0x0d11b7a72636fdb715eda36e664882dab8ce4942fa14e116cc22199a94c1057e',
  '0x7273698ce2e9f495d1b302ea540727c86fa9747e616a19282c02ce65b5bc6a65',
]);
export const PUBLIC_POOL_ANCHOR_READS = Object.freeze([
  'chainId', 'block', 'nextIndex', 'getLastRoot', 'levels', 'denomination', 'block', 'isKnownRoot',
] as const);

export function publicPoolLaunch(snapshotPort: unknown, anchorPort: unknown, token: unknown) {
  const snapshot = httpLaunch(snapshotPort, token);
  const anchor = httpLaunch(anchorPort, token);
  if (snapshot.port === anchor.port) throw Error('PUBLIC_POOL_QUALIFICATION_PORT_COLLISION');
  return Object.freeze({ snapshotPort: snapshot.port, anchorPort: anchor.port, token: snapshot.token });
}

export type PublicPoolLaunch = ReturnType<typeof publicPoolLaunch>;
export const publicPoolAnchorPath = (token: string) => `/${token}/public-pool-anchor`;

export function publicPoolBuild(value: unknown) {
  if (!value || typeof value !== 'object' || !('build' in value) || !('caSha256' in value) ||
      Object.keys(value).length !== 2 || typeof value.caSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.caSha256))
    throw Error('PUBLIC_POOL_QUALIFICATION_BUILD_INVALID');
  return Object.freeze({ build: httpBuild(value.build), caSha256: value.caSha256 });
}
