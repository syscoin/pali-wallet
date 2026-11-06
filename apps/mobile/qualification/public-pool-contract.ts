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

export const PUBLIC_POOL_FAILURE_FILE = 'pali-native-public-pool-failure.json';
export const PUBLIC_POOL_FAILURE_BYTES = 256;
const FAILURE_STAGES = Object.freeze({
  parameters: 'launch',
  'Hermes text and string capabilities': 'hermes',
  'native crypto bridge and full vectors': 'native-crypto',
  'native factory handles reject direct construction': 'native-handles',
  'native public Merkle and HMAC vectors': 'native-merkle-hmac',
  'native SLH leaf setup vector': 'native-slh',
  'public pool configuration': 'pool-config',
  'public pool snapshot, Merkle and anchors': 'snapshot-anchors',
  'public pool report': 'report',
});
const PRIVACY_FAILURE_CODES = [
  'privacy_anchor_changed', 'privacy_cancelled', 'privacy_data_invalid', 'privacy_data_too_large',
  'privacy_rpc_unavailable', 'privacy_service_unavailable', 'privacy_snapshot_stale',
  'privacy_verification_failed', 'privacy_verification_pending', 'privacy_wrong_chain',
];
const FAILURE_CODES = new Set([
  'QUALIFICATION_ASSERTION_FAILED', 'QUALIFICATION_BUILD_IDENTIFIER_REQUIRED',
  'QUALIFICATION_LINK_INVALID', 'QUALIFICATION_LINK_MISSING', 'QUALIFICATION_NETWORK_FORBIDDEN',
  'PUBLIC_POOL_QUALIFICATION_FAILED',
  'PUBLIC_POOL_QUALIFICATION_BUILD_INVALID', 'PUBLIC_POOL_QUALIFICATION_INACTIVE',
  'PUBLIC_POOL_QUALIFICATION_PORT_COLLISION', 'unknown', ...PRIVACY_FAILURE_CODES,
]);

export function makePublicPoolFailure(check: string, error: unknown) {
  const stage = Object.hasOwn(FAILURE_STAGES, check) ? FAILURE_STAGES[check as keyof typeof FAILURE_STAGES] : 'unknown';
  const message = error instanceof Error ? error.message : '';
  const syncFailure = message.length <= 100
    ? /^PUBLIC_POOL_QUALIFICATION_FAILED:error:(privacy_[a-z_]+)$/.exec(message)?.[1] : undefined;
  const candidate = syncFailure ?? message;
  return { version: 1, stage, code: FAILURE_CODES.has(candidate) ? candidate : 'unknown' };
}

export function parsePublicPoolFailure(text: string) {
  const invalid = () => Error('PUBLIC_POOL_FAILURE_REPORT_INVALID');
  if (typeof text !== 'string' || !text || text.length > PUBLIC_POOL_FAILURE_BYTES) throw invalid();
  let value;
  try { value = JSON.parse(text); } catch { throw invalid(); }
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'code,stage,version' ||
      value.version !== 1 || !['unknown', ...Object.values(FAILURE_STAGES)].includes(value.stage) || !FAILURE_CODES.has(value.code))
    throw invalid();
  return { version: 1, stage: value.stage, code: value.code };
}

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
