import type { PrivacyPoolId, PrivacySnapshot } from './types';

export interface IPrivacySnapshotAccess {
  /** Synchronous local lease check; no disk/RPC. Pass this exact snapshot object. */
  assertSnapshotCurrent: (snapshot: PrivacySnapshot) => void;
  /** Uses locally verified subtree roots; never fetches note-specific data. */
  getPath: (
    leafIndex: number
  ) => Promise<{ pathElements: string[]; pathIndices: number[] }>;
  /** Frozen, owned by the verifying background controller. Never accepted from UI flags. */
  snapshot: PrivacySnapshot;
}
export type IPrivacySnapshotReader = (
  poolId: PrivacyPoolId
) => Promise<IPrivacySnapshotAccess>;
