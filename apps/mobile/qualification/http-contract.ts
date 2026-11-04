/** Public, fixed-loopback qualification only; never a wallet network registration. */
export const HTTP_CASES = Object.freeze([
  'exact-get-url', 'redirect-refused', 'seeded-cookie-omitted',
  'abort-before-headers', 'abort-stream', 'limit-stream', 'healthy-after-cancel',
] as const);
export type HttpCase = typeof HTTP_CASES[number];
export type HttpFailureCase = HttpCase | 'host-verification' | 'unavailable';
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
  if (!exact(value, ['version', 'kind', 'status', 'diagnosticOnly', 'failedCase', 'sourceRevision', 'lockfileSha256', 'token', 'phase', 'scenario', 'platform', 'sessionId']) ||
      value.version !== 1 || value.kind !== 'native-http-diagnostic' || value.status !== 'failed' || value.diagnosticOnly !== true ||
      Object.entries(expected).some(([key, entry]) => value[key] !== entry) ||
      typeof value.sessionId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.sessionId) ||
      !HTTP_CASES.includes(value.failedCase as HttpCase)) return undefined;
  return value.failedCase as HttpCase;
}
