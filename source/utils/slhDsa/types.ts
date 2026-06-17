import type { SLH_DSA_PARAMETER_SET } from './constants';

export type SLHDSAParameterSet = typeof SLH_DSA_PARAMETER_SET;

export type SLHDSASignActionHashParams = {
  accountId?: number;
  actionHash: string;
  allowReservedSignature?: boolean;
  keyId: string;
  parameterSet: SLHDSAParameterSet;
  pkRoot: string;
  pkSeed: string;
};

export type SLHDSAProvisionedState = {
  accountIndex: number;
  createdAt: number;
  derivationLabel: string;
  keyId: string;
  parameterSet: SLHDSAParameterSet;
  pkRoot: string;
  pkSeed: string;
  secretKeyHex?: string;
  signatureCount: number;
  signatureLimit: number;
  updatedAt: number;
  version: number;
};

export type SLHDSAPublicPrecomputeRecord = {
  checksum?: string;
  completedAt?: number;
  createdAt: number;
  keyId: string;
  parameterSet: SLHDSAParameterSet;
  pkRoot: string;
  pkSeed: string;
  progress?: {
    computedLeaves?: number;
    totalLeaves?: number;
  };
  updatedAt: number;
  version: number;
};

export type SLHDSAWorkerRequest =
  | {
      id: string;
      payload: {
        actionHash: string;
        keyId: string;
        pkRoot: string;
        pkSeed: string;
        secretKeyHex?: string;
      };
      type: 'sign_action_hash';
    }
  | {
      id: string;
      payload: {
        accountId?: number;
        setupSecretHex: string;
      };
      type: 'prepare_keypair';
    }
  | {
      id: string;
      type: 'clear_xmss_cache';
    };

export type SLHDSAWorkerResponse =
  | {
      id: string;
      result: {
        completed: number;
        level: number;
        phase: 'xmss-cache';
        total: number;
      };
      type: 'progress';
    }
  | {
      id: string;
      result:
        | {
            pkRoot: string;
            pkSeed: string;
            secretKeyHex?: string;
            signature?: string;
          }
        | Record<string, never>;
      type: 'success';
    }
  | {
      error: string;
      id: string;
      type: 'error';
    };
