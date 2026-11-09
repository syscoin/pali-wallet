import { SharedSentryVoteApprovals } from '../../../wallet/sentryVoteApprovals';
import { getSentryVaultId, loadSentryKey } from 'utils/sentry/keyStore';
import { runSentryCrypto } from 'utils/sentry/workerClient';

import type {
  SentryApprovalScope,
  SentryRequestScope,
  SentrySettings,
  SentryRequestLifetime,
} from '../../../wallet/sentryApprovalTypes';

type ExtensionVoteHost = {
  captureApprovalScope(origin: string): SentryRequestScope;
  captureScope(): SentryApprovalScope;
  getSeed(password: string): Promise<string>;
  getSettings(scope: SentryApprovalScope): Promise<SentrySettings>;
  hasWalletAuthority(
    address: string,
    scope: SentryApprovalScope
  ): Promise<boolean>;
  readJson(
    url: string,
    limit: number,
    check: () => void,
    signal: AbortSignal
  ): Promise<any>;
  resolveWalletAuthority(
    params: { address: string; password: string },
    scope: SentryApprovalScope
  ): Promise<{ scheme: 'ecdsa'; secretKey: string } | undefined>;
  runExclusive<T>(operation: () => Promise<T>): Promise<T>;
};

/** Browser custody/transport adapter; approval policy lives in the shared wallet. */
export class SentryVoteController {
  private readonly approvals: SharedSentryVoteApprovals;
  constructor(private readonly host: ExtensionVoteHost) {
    if (
      typeof host.hasWalletAuthority !== 'function' ||
      typeof host.captureApprovalScope !== 'function' ||
      typeof host.resolveWalletAuthority !== 'function'
    )
      throw new Error('Sentry wallet-authority ports are required');
    this.approvals = new SharedSentryVoteApprovals({
      captureScope: host.captureScope,
      assertCurrent(scope) {
        if (host.captureScope().identity !== scope.identity)
          throw new Error('Wallet context changed. Start the vote again.');
      },
      getSeed: (password) => host.getSeed(password),
      getSettings: host.getSettings,
      hasWalletAuthority: (address, scope) =>
        host.hasWalletAuthority(address, scope),
      readJson: (url, limit, scope, check, signal) =>
        host.readJson(url, limit, check, signal),
      resolveWalletAuthority: (params, scope) =>
        host.resolveWalletAuthority(params, scope),
      async loadKey({ scope, network, id, seed, assertCurrent }) {
        const vaultId = await getSentryVaultId(scope.rootPublicIdentity);
        assertCurrent();
        return loadSentryKey({ vaultId, network, id, seed, assertCurrent });
      },
      runCrypto: runSentryCrypto,
      runExclusive: host.runExclusive,
    });
  }
  prepare(raw: unknown, origin: string, lifetime: SentryRequestLifetime) {
    return this.approvals.prepare(
      raw,
      origin,
      this.host.captureApprovalScope(origin),
      lifetime
    );
  }
  getApproval(id: string) {
    return this.approvals.getApproval(id);
  }
  sign(params: Parameters<SharedSentryVoteApprovals['sign']>[0]) {
    return this.approvals.sign(params);
  }
  cancel(id: string) {
    this.approvals.cancel(id);
  }
  clear() {
    this.approvals.clear();
  }
}
