import { assertSynchronousEvmFeeGuard } from '../shared/evmFeeGuard.ts';

import type { SentryRequestScope } from './sentryApprovalTypes.ts';
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

type FeeAuthorization = {
  busy?: boolean;
  context: SentryManagementContext;
  expiresAt: number;
  origin: string;
  parentId: string;
  published?: boolean;
  request: SentryOperationRequest | SentryManagementRequest;
  scope: SentryRequestScope;
  serviceUrl: string;
};

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
        entry.scope.identity !== scopeIdentity
      )
        this.entries.delete(id);
  }

  public remember(
    entry: Omit<FeeAuthorization, 'expiresAt' | 'published' | 'busy'>
  ) {
    assertSynchronousEvmFeeGuard(entry.scope.assertRequestCurrent);
    this.prune(entry.scope.identity);
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
      published: false,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
  }

  public cancelUnpublished(parentId: string) {
    for (const [id, entry] of this.entries)
      if (entry.parentId === parentId && !entry.published)
        this.entries.delete(id);
  }

  public publish(parentId: string) {
    for (const entry of this.entries.values()) {
      if (entry.parentId !== parentId) continue;
      assertSynchronousEvmFeeGuard(entry.scope.assertRequestCurrent);
      if (entry.expiresAt <= Date.now())
        throw new Error('Sentry fee authorization expired');
      entry.published = true;
    }
  }

  public revalidate() {
    for (const [id, entry] of this.entries) {
      try {
        assertSynchronousEvmFeeGuard(entry.scope.assertRequestCurrent);
        if (entry.expiresAt <= Date.now()) this.entries.delete(id);
      } catch {
        this.entries.delete(id);
      }
    }
  }

  public find(transactionHex: string, origin: string, scopeIdentity: string) {
    this.prune(scopeIdentity);
    for (const [id, entry] of this.entries)
      if (
        entry.published === true &&
        entry.request.transactionHex === transactionHex &&
        entry.origin === origin &&
        entry.scope.identity === scopeIdentity
      ) {
        this.get(id, transactionHex, scopeIdentity);
        return id;
      }
    throw new Error(
      'SENTRY_FEE_AUTHORIZATION_REQUIRED: Authorize this exact Sentry operation in Pali before signing its network fee.'
    );
  }

  public get(id: string, transactionHex: string, scopeIdentity: string) {
    this.prune(scopeIdentity);
    const entry = this.entries.get(id);
    if (
      !entry ||
      !entry.published ||
      entry.request.transactionHex !== transactionHex
    )
      throw new Error(
        'SENTRY_FEE_AUTHORIZATION_REQUIRED: The Sentry fee authorization expired or the transaction changed. Authorize the operation again.'
      );
    try {
      assertSynchronousEvmFeeGuard(entry.scope.assertRequestCurrent);
      return entry;
    } catch (error) {
      this.entries.delete(id);
      throw error;
    }
  }

  public acquire(id: string, transactionHex: string, scopeIdentity: string) {
    const entry = this.get(id, transactionHex, scopeIdentity);
    if (entry.busy)
      throw new Error('This Sentry fee authorization is already being signed.');
    entry.busy = true;
    return (disclosed = false) => {
      if (disclosed) {
        if (this.get(id, transactionHex, scopeIdentity) !== entry)
          throw new Error('The Sentry fee authorization changed');
        this.entries.delete(id);
      } else entry.busy = false;
    };
  }
}
