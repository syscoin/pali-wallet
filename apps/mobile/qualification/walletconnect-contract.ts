import type { HttpBuild, HttpReport } from './http-contract.ts';
export type WalletConnectAudit = Readonly<{
  opened: number;
  closed: number;
  pending: number;
  pendingClosed: number;
  frames: number;
  invalid: number;
}>;
export type WalletConnectReport = Readonly<
  HttpBuild & {
    kind: 'native-walletconnect';
    status: 'passed';
    candidateIdentity: string;
    token: string;
    phase: HttpReport['phase'];
    scenario: HttpReport['scenario'];
    platform: HttpReport['platform'];
    sessionId: string;
  }
>;
export function assertWalletConnectAudit(
  value: unknown
): asserts value is WalletConnectAudit {
  const audit = value as WalletConnectAudit;
  if (
    !audit ||
    Object.keys(audit).sort().join(',') !==
      'closed,frames,invalid,opened,pending,pendingClosed' ||
    audit.opened !== 1 ||
    audit.closed !== 1 ||
    audit.pending !== 1 ||
    audit.pendingClosed !== 1 ||
    audit.invalid !== 0 ||
    !Number.isSafeInteger(audit.frames) ||
    audit.frames < 1 ||
    audit.frames > 12
  )
    throw Error('WALLETCONNECT_NATIVE_AUDIT_FAILED');
}
export function assertWalletConnectReport(
  value: unknown,
  expected: Omit<WalletConnectReport, 'version' | 'kind' | 'status'>
): asserts value is WalletConnectReport {
  const report = value as WalletConnectReport;
  if (
    !report ||
    Object.keys(report).sort().join(',') !==
      'candidateIdentity,kind,lockfileSha256,phase,platform,scenario,sessionId,sourceRevision,status,token,version' ||
    report.version !== 1 ||
    report.kind !== 'native-walletconnect' ||
    report.status !== 'passed' ||
    Object.entries(expected).some(
      ([key, entry]) => report[key as keyof WalletConnectReport] !== entry
    )
  )
    throw Error('WALLETCONNECT_NATIVE_REPORT_INVALID');
}
