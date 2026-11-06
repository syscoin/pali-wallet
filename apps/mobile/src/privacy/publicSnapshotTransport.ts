import type { PrivacyAnchorRead } from '../../../../source/utils/privacy/publicSyncProtocol.ts';
import type { PrivacyPoolId } from '../../../../source/utils/privacy/types.ts';
import type { OwnedPrivacyPullTransport } from './nativePrivacyPoolSync.ts';

type SnapshotInfo = Readonly<{ status: number; byteCount: number }>;
export type PublicSnapshotModule = Readonly<{
  preparePublicSnapshot(pool: PrivacyPoolId, serviceOrigin: string): string;
  preparePublicSnapshotAnchor(
    endpoint: string,
    address: string,
    blockNumber: number,
    root: string,
    read: PrivacyAnchorRead,
    id: number
  ): string;
  startPublicSnapshot(token: string): Promise<SnapshotInfo>;
  pullPublicSnapshot(token: string): Promise<Uint8Array | ArrayBuffer | null>;
  releasePublicSnapshot(token: string): Promise<void>;
}>;

const cancelled = () => new Error('privacy_cancelled');

/** Admit one native handle and retain its slot until the exact release drains. */
export function createPublicSnapshotTransport(module: PublicSnapshotModule): OwnedPrivacyPullTransport {
  const reserveSnapshot = module.preparePublicSnapshot.bind(module);
  const reserveAnchor = module.preparePublicSnapshotAnchor.bind(module);
  const start = module.startPublicSnapshot.bind(module);
  const pull = module.pullPublicSnapshot.bind(module);
  const release = module.releasePublicSnapshot.bind(module);
  let active: object | undefined;

  function prepare(reserve: () => string, signal: AbortSignal) {
    const owner = {};
    let token: string | undefined;
    let ready = false;
    let pulling = false;
    let pendingStart: Promise<SnapshotInfo> | undefined;
    let pendingPull: ReturnType<typeof pull> | undefined;
    let retirement: Promise<void> | undefined;

    function check(assertCurrent: () => void) {
      if (signal.aborted || retirement) throw cancelled();
      const result: unknown = assertCurrent();
      if (result !== undefined) {
        void Promise.resolve(result).catch(() => undefined);
        throw cancelled();
      }
      if (signal.aborted || retirement) throw cancelled();
    }

    return {
      async start(assertCurrent: () => void) {
        check(assertCurrent);
        if (active) throw cancelled();
        active = owner;
        token = reserve();
        check(assertCurrent);
        pendingStart = start(token);
        const result = await pendingStart;
        check(assertCurrent);
        ready = true;
        return result;
      },
      async pull(assertCurrent: () => void) {
        check(assertCurrent);
        if (active !== owner || !ready || token === undefined || pulling) throw cancelled();
        pulling = true;
        try {
          pendingPull = pull(token);
          const chunk = await pendingPull;
          check(assertCurrent);
          return chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : chunk;
        } finally {
          pendingPull = undefined;
          pulling = false;
        }
      },
      release() {
        // Defer the release in case the bridge retired the owner reentrantly
        // during its synchronous reservation call.
        return retirement ??= Promise.resolve().then(async () => {
          if (token !== undefined) await release(token);
          await Promise.allSettled([pendingStart, pendingPull]);
          if (active === owner) active = undefined;
        });
      },
    };
  }

  return {
    prepareSnapshot(pool, origin, signal) {
      return prepare(() => reserveSnapshot(pool, origin), signal);
    },
    prepareAnchor({ rpcUrl, poolAddress, blockNumber, root }, read, id, signal) {
      return prepare(() => reserveAnchor(rpcUrl, poolAddress, blockNumber, root, read, id), signal);
    },
  };
}
