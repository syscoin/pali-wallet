import type { HttpBuild, HttpReport } from './http-contract.ts';
import { POST_ROUTES } from './post-fixtures.ts';

export const POST_CASES = Object.freeze(['rpc-post-roundtrip', 'rpc-post-invalid-response', 'rpc-post-body-limit',
  'rpc-post-abort', 'post-lost-response-exact-retry'] as const);
export type PostCase = typeof POST_CASES[number];
export type PostReport = Readonly<HttpBuild & {
  kind: 'native-post'; status: 'passed'; nativePostQualified: true; token: string;
  phase: HttpReport['phase']; scenario: HttpReport['scenario']; platform: HttpReport['platform'];
  sessionId: string; networkCalls: 0; cases: readonly string[];
}>;
export type PostExpected = Pick<PostReport, 'sourceRevision' | 'lockfileSha256' | 'token' | 'phase' | 'scenario' | 'platform'>;
export type PostFailureDetail = Readonly<{ route: string; attempt: number; rejection: 'none' | 'size-limit' | 'abort' | 'other' }>;
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export function assertPostReport(value: unknown, expected: PostExpected): asserts value is PostReport {
  if (!exact(value, ['version', 'kind', 'status', 'nativePostQualified', 'sourceRevision', 'lockfileSha256', 'token', 'phase', 'scenario', 'platform', 'sessionId', 'networkCalls', 'cases']) ||
      value.version !== 1 || value.kind !== 'native-post' || value.status !== 'passed' || value.nativePostQualified !== true || value.networkCalls !== 0 ||
      Object.entries(expected).some(([key, entry]) => value[key] !== entry) ||
      typeof value.sessionId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.sessionId) ||
      !Array.isArray(value.cases) || value.cases.length !== POST_CASES.length || value.cases.some((entry, i) => entry !== POST_CASES[i]))
    throw Error('POST_QUALIFICATION_REPORT_INVALID');
}
export function postDiagnosticCase(value: unknown, expected: PostExpected): PostCase | undefined {
  if (!exact(value, ['version', 'kind', 'status', 'diagnosticOnly', 'failedCase', 'failureDetail', 'sourceRevision', 'lockfileSha256', 'token', 'phase', 'scenario', 'platform', 'sessionId']) ||
      value.version !== 1 || value.kind !== 'native-post-diagnostic' || value.status !== 'failed' || value.diagnosticOnly !== true ||
      Object.entries(expected).some(([key, entry]) => value[key] !== entry) ||
      typeof value.sessionId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.sessionId) ||
      !POST_CASES.includes(value.failedCase as PostCase) || !validPostFailureDetail(value.failureDetail)) return undefined;
  return value.failedCase as PostCase;
}
export function validPostFailureDetail(value: unknown): value is PostFailureDetail {
  return exact(value, ['route', 'attempt', 'rejection']) && typeof value.route === 'string' && POST_ROUTES.includes(value.route) &&
    Number.isInteger(value.attempt) && (value.attempt as number) >= 0 && (value.attempt as number) <= 2 &&
    ['none', 'size-limit', 'abort', 'other'].includes(value.rejection as string);
}
