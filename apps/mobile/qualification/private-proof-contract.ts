import { PRIVACY_PROVING_KEY_SHA256 } from '../../../source/utils/privacy/proverArtifacts.ts';

export const PRIVATE_PROOF_REPORT_BYTES = 8192;
export const PRIVATE_PROOF_REPORT_TIMEOUT = 400000;
export const PRIVATE_PROOF_CASES = Object.freeze([
  'proof-before-cancel',
  'cancel-while-proving',
  'proof-after-cancel',
] as const);
export type PrivateProofCase = (typeof PRIVATE_PROOF_CASES)[number];
export type PrivateProofResult = Readonly<{
  version: 1;
  provingKeySha256: string;
  cases: readonly Readonly<{
    name: PrivateProofCase;
    outcome: 'verified' | 'cancelled';
    durationMs: number;
    stages: readonly string[];
    rejectedPublicSignalMutations: number;
  }>[];
}>;
export type PrivateProofExpectation = Readonly<{
  sourceRevision: string;
  lockfileSha256: string;
  sdkVersion: string;
  sdkPackageVersion: string;
  platform: 'ios' | 'android';
  token: string;
}>;
const exact = (
  value: unknown,
  keys: readonly string[]
): value is Record<string, unknown> =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const invalid = () => new Error('PRIVATE_PROOF_REPORT_INVALID');

export function privateProofReportName(token: string): string {
  if (!/^[0-9a-f]{32}$/.test(token)) throw invalid();
  return `pali-native-private-proof-${token}.json`;
}

export function parsePrivateProofReport(
  text: string,
  expected: PrivateProofExpectation
) {
  if (
    typeof text !== 'string' ||
    new TextEncoder().encode(text).length > PRIVATE_PROOF_REPORT_BYTES
  )
    throw invalid();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw invalid();
  }
  if (
    !exact(value, [
      'version',
      'sourceRevision',
      'lockfileSha256',
      'sdkVersion',
      'sdkPackageVersion',
      'platform',
      'token',
      'kind',
      'status',
      'sessionId',
      'jsNetworkCalls',
      'nativeNetworkObservation',
      'result',
    ]) ||
    value.version !== 1 ||
    value.kind !== 'native-private-proof' ||
    value.status !== 'passed' ||
    value.jsNetworkCalls !== 0 ||
    value.nativeNetworkObservation !== 'unmeasured' ||
    Object.entries(expected).some(([key, entry]) => value[key] !== entry) ||
    !/^[0-9a-f]{40}$/.test(expected.sourceRevision) ||
    !/^[0-9a-f]{64}$/.test(expected.lockfileSha256) ||
    !/^[0-9a-f]{32}$/.test(expected.token) ||
    !['ios', 'android'].includes(expected.platform) ||
    typeof value.sdkVersion !== 'string' ||
    value.sdkVersion.length > 512 ||
    typeof value.sdkPackageVersion !== 'string' ||
    value.sdkPackageVersion.length > 100 ||
    typeof value.sessionId !== 'string' ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.sessionId)
  )
    throw invalid();
  const result = value.result;
  if (
    !exact(result, ['version', 'provingKeySha256', 'cases']) ||
    result.version !== 1 ||
    result.provingKeySha256 !== PRIVACY_PROVING_KEY_SHA256 ||
    !Array.isArray(result.cases) ||
    result.cases.length !== 3
  )
    throw invalid();
  for (let index = 0; index < 3; index++) {
    const entry = result.cases[index];
    const cancelled = index === 1;
    const stages = cancelled
      ? ['artifacts', 'witness', 'proving']
      : ['artifacts', 'witness', 'proving', 'verifying'];
    if (
      !exact(entry, [
        'name',
        'outcome',
        'durationMs',
        'stages',
        'rejectedPublicSignalMutations',
      ]) ||
      entry.name !== PRIVATE_PROOF_CASES[index] ||
      entry.outcome !== (cancelled ? 'cancelled' : 'verified') ||
      entry.rejectedPublicSignalMutations !== (cancelled ? 0 : 6) ||
      typeof entry.durationMs !== 'number' ||
      !Number.isFinite(entry.durationMs) ||
      entry.durationMs < 0 ||
      entry.durationMs > 125000 ||
      !Array.isArray(entry.stages) ||
      entry.stages.length !== stages.length ||
      entry.stages.some((stage, position) => stage !== stages[position])
    )
      throw invalid();
  }
  return value;
}
