import type { PrivacyPoolId, PrivacySnapshot } from './types';

export interface IPrivacySnapshotAccess {
  /** A deposit already in the public view may still await the proof checkpoint. */
  assertNoteInCheckpoint?: (commitment: string) => void;
  /** Synchronous local lease check; no disk/RPC. Pass this exact snapshot object. */
  assertSnapshotCurrent: (snapshot: PrivacySnapshot) => void;
  /** Uses locally verified subtree roots; never fetches note-specific data. */
  getPath: (
    leafIndex: number
  ) => Promise<{ pathElements: string[]; pathIndices: number[] }>;
  /** Frozen, owned by the verifying background controller. Never accepted from UI flags. */
  snapshot: PrivacySnapshot;
  /** Wait only for the one controller-identified refresh that revoked this lease. */
  waitForScheduledRefresh?: () => Promise<boolean>;
}
export type IPrivacySnapshotReader = (
  poolId: PrivacyPoolId
) => Promise<IPrivacySnapshotAccess>;
