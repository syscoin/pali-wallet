import type {
  SentryManagementContext,
  SentryManagementRequest,
  SentryManagementReview,
  SentryOperationRequest,
  SentryOperationReview,
} from '@sidhujag/sysweb3-sentry';

export type SentryFeeReview = SentryOperationReview | SentryManagementReview;

export const isSentryTransactionVersion = (version: number) =>
  [80, 81, 82, 83, 86].includes(version);

interface FeeAuthorization {
  busy?: boolean;
  context: SentryManagementContext;
  expiresAt: number;
  origin: string;
  request: SentryOperationRequest | SentryManagementRequest;
  scopeIdentity: string;
  serviceUrl: string;
}

/** Public transaction bytes only. No secrets; never persisted or returned to a site. */
export class SentryFeeAuthorizations {
  private readonly entries = new Map<string, FeeAuthorization>();

  public clear() {
    this.entries.clear();
  }

  private prune(scopeIdentity: string) {
    for (const [id, entry] of this.entries)
      if (
        entry.expiresAt <= Date.now() ||
        entry.scopeIdentity !== scopeIdentity
      )
        this.entries.delete(id);
  }

  public remember(entry: Omit<FeeAuthorization, 'expiresAt'>) {
    this.prune(entry.scopeIdentity);
    for (const [id, previous] of this.entries)
      if (
        previous.origin === entry.origin &&
        previous.request.transactionHex === entry.request.transactionHex
      )
        this.entries.delete(id);
    while (this.entries.size >= 8)
      this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(crypto.randomUUID(), {
      ...entry,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
  }

  public find(transactionHex: string, origin: string, scopeIdentity: string) {
    this.prune(scopeIdentity);
    for (const [id, entry] of this.entries)
      if (
        entry.request.transactionHex === transactionHex &&
        entry.origin === origin &&
        entry.scopeIdentity === scopeIdentity
      )
        return id;
    throw new Error(
      'SENTRY_FEE_AUTHORIZATION_REQUIRED: Authorize this exact Sentry operation in Pali before signing its network fee.'
    );
  }

  public get(id: string, transactionHex: string, scopeIdentity: string) {
    this.prune(scopeIdentity);
    const entry = this.entries.get(id);
    if (!entry || entry.request.transactionHex !== transactionHex)
      throw new Error(
        'SENTRY_FEE_AUTHORIZATION_REQUIRED: The Sentry fee authorization expired or the transaction changed. Authorize the operation again.'
      );
    return entry;
  }

  public acquire(id: string, transactionHex: string, scopeIdentity: string) {
    const entry = this.get(id, transactionHex, scopeIdentity);
    if (entry.busy)
      throw new Error('This Sentry fee authorization is already being signed.');
    entry.busy = true;
    return (disclosed = false) => {
      if (disclosed) this.entries.delete(id);
      else entry.busy = false;
    };
  }
}
