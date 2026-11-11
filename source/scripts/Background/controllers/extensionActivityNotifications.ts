import {
  activityNotificationScopeKey,
  detectActivityNotifications,
  type ActivityNotificationBaseline,
  type ActivityNotificationFact,
  type ActivityNotificationScope,
} from '../../../shared/activityNotifications';

import type { GuardianRecoveryObservation } from '../../../utils/smartAccount/guardianStatus';

/** Host memory only: this owns neither a polling timer nor a signing authority. */
export class ExtensionActivityNotifications {
  private namespace: number | undefined;
  private baselines = new Map<string, ActivityNotificationBaseline>();
  private pendingGuardians = new Map<string, object>();

  private key(namespace: number, scope: ActivityNotificationScope): string {
    if (namespace !== this.namespace) {
      this.namespace = namespace;
      this.baselines.clear();
      this.pendingGuardians.clear();
    }
    return activityNotificationScopeKey(scope);
  }

  public history(input: {
    deliver: (fact: ActivityNotificationFact) => void;
    isCurrent: () => boolean;
    namespace: number;
    previousTransactions: readonly unknown[];
    scope: ActivityNotificationScope;
    transactions: readonly unknown[];
  }): readonly ActivityNotificationFact[] {
    if (!input.isCurrent()) return [];
    const key = this.key(input.namespace, input.scope);
    let previous = this.baselines.get(key) ?? null;
    if (!previous && input.previousTransactions.length) {
      previous = detectActivityNotifications({
        scope: input.scope,
        previous: null,
        transactions: input.previousTransactions,
      }).baseline;
    }
    const result = detectActivityNotifications({
      scope: input.scope,
      previous,
      transactions: input.transactions,
    });
    if (!input.isCurrent()) return [];
    this.remember(key, result.baseline);
    result.facts.forEach((fact) => input.deliver(fact));
    return result.facts;
  }

  public async guardian(input: {
    deliver: (fact: ActivityNotificationFact) => void;
    isCurrent: () => boolean;
    namespace: number;
    read: (knownOperationId?: string) => Promise<GuardianRecoveryObservation>;
    scope: ActivityNotificationScope;
  }): Promise<void> {
    if (!input.isCurrent()) return;
    const key = this.key(input.namespace, input.scope);
    if (this.pendingGuardians.has(key)) return;
    const token = {};
    this.pendingGuardians.set(key, token);
    try {
      const observation = await input.read(
        this.baselines.get(key)?.guardian?.trackedOperationId
      );
      if (
        !input.isCurrent() ||
        this.namespace !== input.namespace ||
        this.pendingGuardians.get(key) !== token
      )
        return;
      const result = detectActivityNotifications({
        scope: input.scope,
        previous: this.baselines.get(key) ?? null,
        transactions: [],
        historyReadSucceeded: false,
        guardianObservation: observation,
      });
      if (!input.isCurrent()) return;
      this.remember(key, result.baseline);
      result.facts.forEach((fact) => input.deliver(fact));
    } finally {
      if (this.pendingGuardians.get(key) === token)
        this.pendingGuardians.delete(key);
    }
  }

  private remember(key: string, baseline: ActivityNotificationBaseline) {
    this.baselines.delete(key);
    this.baselines.set(key, baseline);
    if (this.baselines.size > 512)
      this.baselines.delete(this.baselines.keys().next().value!);
  }
}
