export type PrivacyPoolId = 'eth-0.1' | 'eth-1' | 'eth-10' | 'eth-100';

export interface PrivacyPool {
  address: string;
  amount: string;
  deploymentBlock: number;
  id: PrivacyPoolId;
}

// Only public, pool-wide data crosses the index-service boundary.
export interface PrivacySnapshot {
  asOfBlockHash: string;
  asOfBlockNumber: number;
  chainId: number;
  leafCount: number;
  leaves: string[];
  poolAddress: string;
  root: string;
  version: 1;
  // Public withdrawal events at the same block anchor. The deposit root does
  // not authenticate this list's completeness; the index service supplies it.
  withdrawnNullifiers: string[];
}

export interface PrivacyIndexProgress {
  phase: 'syncing';
  scannedBlock: number;
  startBlock: number;
  targetBlock: number;
}

export interface PrivacySyncStatus {
  blockNumber?: number;
  completed?: number;
  errorCode?: string;
  leafCount?: number;
  phase: 'idle' | 'syncing' | 'verifying' | 'ready' | 'paused' | 'error';
  poolId: PrivacyPoolId;
  total?: number;
  verifiedAt?: number;
}

export interface PrivacyController {
  clear: (poolId: PrivacyPoolId) => Promise<PrivacySyncStatus>;
  getStatus: (poolId: PrivacyPoolId) => Promise<PrivacySyncStatus>;
  pause: (poolId: PrivacyPoolId) => Promise<PrivacySyncStatus>;
  resumePending: (poolId: PrivacyPoolId) => Promise<void>;
  start: (poolId: PrivacyPoolId) => Promise<PrivacySyncStatus>;
}
