import type { WatchOnlyAuthority } from '../core/watchOnlyAuthority.ts';
import {
  NativeActivity,
  type ActivityReceiptPort,
  type NativeActivityRuntime,
} from './nativeActivity.ts';
import {
  ACTIVITY_CACHE_LIMIT,
  ACTIVITY_VIEW_LIMIT,
  validateActivityCandidate,
  validateActivityView,
} from './cacheValidation.ts';
import {
  ActivityError,
  DEFAULT_ACTIVITY_VIEW,
  type ActivityCandidate,
  type EvmActivityReadScope,
  type ActivityViewState,
} from './types.ts';

/** Public-session adapter only. Discovery, validation, filtering and rendering stay
 * in the same Activity pipeline used by custody accounts. No signed records or
 * private storage is opened, and this advisory cache ends with its authority. */
export function createWatchEvmActivity(
  authority: WatchOnlyAuthority
): NativeActivity {
  let current: EvmActivityReadScope | null = null;
  let cached: { sourceId: string; candidates: readonly ActivityCandidate[] }[] =
    [];
  let views: { sourceId: string; view: ActivityViewState }[] = [];
  let truncated = false;
  const checkedScope = async (
    scope: EvmActivityReadScope,
    guard: () => void
  ) => {
    const selected = await authority.loadEvmActivity(guard);
    guard();
    if (
      selected.key !== scope.key ||
      selected.sourceId !== scope.sourceId ||
      selected.network.registrationHash !== scope.network.registrationHash
    )
      throw new ActivityError('CHANGED');
  };
  const runtime: NativeActivityRuntime = {
    async load(guard, signal) {
      const scope = await authority.loadEvmActivity(guard, signal);
      guard();
      current = scope;
      return {
        scope,
        locals: [],
        saved: {
          archived: [],
          candidates:
            cached.find((row) => row.sourceId === scope.sourceId)?.candidates ??
            [],
          view:
            views.find((row) => row.sourceId === scope.sourceId)?.view ??
            DEFAULT_ACTIVITY_VIEW,
          truncated,
        },
      };
    },
    async saveCache(scope, candidates, guard) {
      const admitted = Object.freeze(
        candidates
          .slice(0, ACTIVITY_CACHE_LIMIT)
          .map((row) => validateActivityCandidate({ ...row }))
      );
      await checkedScope(scope, guard);
      guard();
      cached = [
        { sourceId: scope.sourceId, candidates: admitted },
        ...cached.filter((row) => row.sourceId !== scope.sourceId),
      ];
      truncated ||= candidates.length > ACTIVITY_CACHE_LIMIT;
      while (
        cached.length > ACTIVITY_CACHE_LIMIT ||
        cached.reduce((sum, row) => sum + row.candidates.length, 0) >
          ACTIVITY_CACHE_LIMIT
      ) {
        cached.pop();
        truncated = true;
      }
    },
    async saveView(scope, input, guard) {
      const view = validateActivityView({ ...input });
      await checkedScope(scope, guard);
      guard();
      views = [
        { sourceId: scope.sourceId, view },
        ...views.filter((row) => row.sourceId !== scope.sourceId),
      ].slice(0, ACTIVITY_VIEW_LIMIT);
    },
  };
  const receipts: ActivityReceiptPort = {
    read(hash, owner, signal, guard, registration) {
      const scope = current;
      guard();
      if (
        !scope ||
        owner !== scope.address ||
        registration?.registrationHash !== scope.network.registrationHash
      )
        return Promise.reject(new ActivityError('CHANGED'));
      return authority.readEvmActivityTransaction(scope, hash, signal, guard);
    },
  };
  return new NativeActivity(
    {
      getSnapshot() {
        const state = authority.getSnapshot();
        return {
          phase: state.status === 'ready' ? 'ready' : 'locked',
          revision: state.generation,
        };
      },
      subscribe(listener) {
        return authority.subscribe(listener);
      },
    },
    () => runtime,
    {
      page: (scope, feed, page, signal, guard) =>
        authority.readEvmActivityPage(scope, feed, page, signal, guard),
    },
    receipts
  );
}
