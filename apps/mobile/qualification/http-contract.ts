/** Public, fixed-loopback qualification only; never a wallet network registration. */
export const HTTP_CASES = Object.freeze([
  'exact-get-url', 'client-identification', 'redirect-refused', 'seeded-cookie-omitted',
  'abort-before-headers', 'abort-stream', 'limit-stream', 'quote-early-rejection', 'quote-stalled-deadline',
  'public-snapshot-bridge', 'healthy-after-cancel',
] as const);
export const PUBLIC_SNAPSHOT_FIXTURE_PATH = '/api/privacy/v1/pools/eth-1/snapshot';
export const PUBLIC_SNAPSHOT_FIXTURE_BODY = '{"fixture":"' + 'a'.repeat(64 * 1024) + '"}';
export const QUOTE_EARLY_REJECTIONS = Object.freeze([
  { route: 'quote-non-ok', status: 503, length: '64' },
  { route: 'quote-oversize', status: 200, length: '16385' },
] as const);
export const STALLED_QUOTE_ROUTE = 'quote-stalled';
export type HttpCase = typeof HTTP_CASES[number];
export type HttpFailureCase = HttpCase | 'host-verification' | 'unavailable';
export const HTTP_SNAPSHOT_STAGES = ['prepare', 'start', 'metadata', 'first-pull', 'last-pull', 'eof', 'release'] as const;
export const HTTP_SNAPSHOT_REJECTIONS = ['assertion', 'abort', 'timeout', 'other', 'ERR_UNEXPECTED', 'ERR_FUNCTION_CALL',
  'PUBLIC_SNAPSHOT_BUSY', 'PUBLIC_SNAPSHOT_CANCELLED', 'PUBLIC_SNAPSHOT_TIMEOUT',
  'PUBLIC_SNAPSHOT_INVALID', 'PUBLIC_SNAPSHOT_TOO_LARGE', 'PUBLIC_SNAPSHOT_UNAVAILABLE'] as const;
export type HttpSnapshotFailureDetail = Readonly<{
  stage: typeof HTTP_SNAPSHOT_STAGES[number];
  status: number | null; byteCount: number | null;
  chunkKind: 'unobserved' | 'null' | 'undefined' | 'uint8array' | 'arraybuffer' | 'other';
  chunkBytes: number | null; mismatchIndex: number | null;
  rejection: typeof HTTP_SNAPSHOT_REJECTIONS[number];
}>;
export type HttpLaunch = Readonly<{ port: number; token: string }>;
export type HttpBuild = Readonly<{ version: 1; sourceRevision: string; lockfileSha256: string }>;
export type HttpReport = Readonly<{
  version: 1; kind: 'native-http'; status: 'passed'; nativeHttpQualified: true;
  sourceRevision: string; lockfileSha256: string; token: string;
  phase: 'create' | 'restart'; scenario: 'import' | 'generate'; platform: 'ios' | 'android';
  sessionId: string; networkCalls: 0; cases: readonly string[];
}>;
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
export function httpLaunch(port: unknown, token: unknown): HttpLaunch {
  if (typeof port !== 'string' || !/^[1-9][0-9]{3,4}$/.test(port) || Number(port) > 65535 ||
      typeof token !== 'string' || !/^[0-9a-f]{32}$/.test(token)) throw Error('HTTP_QUALIFICATION_LAUNCH_INVALID');
  return Object.freeze({ port: Number(port), token });
}
export function httpBuild(value: unknown): HttpBuild {
  if (!exact(value, ['version', 'sourceRevision', 'lockfileSha256']) || value.version !== 1 ||
      typeof value.sourceRevision !== 'string' || !/^[0-9a-f]{40}$/.test(value.sourceRevision) ||
      typeof value.lockfileSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.lockfileSha256))
    throw Error('HTTP_QUALIFICATION_BUILD_INVALID');
  return Object.freeze({ version: 1, sourceRevision: value.sourceRevision, lockfileSha256: value.lockfileSha256 });
}
export function assertHttpReport(value: unknown, expected: Omit<HttpReport, 'version' | 'kind' | 'status' | 'nativeHttpQualified' | 'networkCalls' | 'cases' | 'sessionId'>): asserts value is HttpReport {
  if (!exact(value, ['version', 'kind', 'status', 'nativeHttpQualified', 'sourceRevision', 'lockfileSha256', 'token', 'phase', 'scenario', 'platform', 'sessionId', 'networkCalls', 'cases']) ||
      value.version !== 1 || value.kind !== 'native-http' || value.status !== 'passed' || value.nativeHttpQualified !== true || value.networkCalls !== 0 ||
      Object.entries(expected).some(([key, entry]) => value[key] !== entry) ||
      typeof value.sessionId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.sessionId) ||
      !Array.isArray(value.cases) || value.cases.length !== HTTP_CASES.length || value.cases.some((entry, index) => entry !== HTTP_CASES[index]))
    throw Error('HTTP_QUALIFICATION_REPORT_INVALID');
}

/** Diagnostics are a distinct schema and can never satisfy assertHttpReport. */
export function httpDiagnosticCase(value: unknown, expected: Record<string, unknown>): HttpCase | undefined {
  if (!exact(value, ['version', 'kind', 'status', 'diagnosticOnly', 'failedCase', 'failureDetail', 'sourceRevision', 'lockfileSha256', 'token', 'phase', 'scenario', 'platform', 'sessionId']) ||
      value.version !== 1 || value.kind !== 'native-http-diagnostic' || value.status !== 'failed' || value.diagnosticOnly !== true ||
      Object.entries(expected).some(([key, entry]) => value[key] !== entry) ||
      typeof value.sessionId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.sessionId) ||
      !HTTP_CASES.includes(value.failedCase as HttpCase) ||
      (value.failedCase === 'public-snapshot-bridge' ? !validHttpSnapshotFailureDetail(value.failureDetail) : value.failureDetail !== null)) return undefined;
  return value.failedCase as HttpCase;
}

export function validHttpSnapshotFailureDetail(value: unknown): value is HttpSnapshotFailureDetail {
  const bounded = (entry: unknown, maximum: number) => entry === null ||
    typeof entry === 'number' && Number.isInteger(entry) && entry >= 0 && entry <= maximum;
  return exact(value, ['stage', 'status', 'byteCount', 'chunkKind', 'chunkBytes', 'mismatchIndex', 'rejection']) &&
    HTTP_SNAPSHOT_STAGES.includes(value.stage as HttpSnapshotFailureDetail['stage']) &&
    HTTP_SNAPSHOT_REJECTIONS.includes(value.rejection as HttpSnapshotFailureDetail['rejection']) &&
    ['unobserved', 'null', 'undefined', 'uint8array', 'arraybuffer', 'other'].includes(value.chunkKind as string) &&
    bounded(value.status, 599) && bounded(value.byteCount, 16 * 1024 * 1024) &&
    bounded(value.chunkBytes, 16 * 1024 * 1024) && bounded(value.mismatchIndex, 16 * 1024 * 1024);
}
