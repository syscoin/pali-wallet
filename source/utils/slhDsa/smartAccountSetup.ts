import { chromeStorage } from 'utils/storageAPI';

import { SLH_DSA_PARAMETER_SET } from './constants';
import { provisionRuntimeSLHDSAStateFromSetupSecret } from './signer';

export type SLHDSASmartAccountSetupStatus = {
  accountId: number;
  canFinalize?: boolean;
  config?: {
    keyId: string;
    parameterSet: typeof SLH_DSA_PARAMETER_SET;
    pkRoot: string;
    pkSeed: string;
    signatureLimit: number;
  };
  error?: string;
  phase?: 'key-derivation' | 'xmss-cache';
  progress?: {
    completed: number;
    level: number;
    total: number;
  };
  startedAt: number;
  status: 'failed' | 'ready' | 'running';
  updatedAt: number;
};

export type SLHDSAPreparedSmartAccountSigner = {
  accountId: number;
  config: NonNullable<SLHDSASmartAccountSetupStatus['config']>;
  updatedAt: number;
  version: 1;
};

const setupJobs = new Map<number, Promise<SLHDSASmartAccountSetupStatus>>();

const getSLHDSASetupStorageKey = (accountId: number) =>
  `pali-slh-dsa-smart-account-setup:${accountId}`;

const getSLHDSAPreparedSignerStorageKey = (accountId: number) =>
  `pali-slh-dsa-prepared-smart-account-signer:v1:${accountId}`;

export const saveSLHDSAPreparedSmartAccountSigner = async ({
  accountId,
  config,
}: {
  accountId: number;
  config: NonNullable<SLHDSASmartAccountSetupStatus['config']>;
}) => {
  const record: SLHDSAPreparedSmartAccountSigner = {
    accountId,
    config,
    updatedAt: Date.now(),
    version: 1,
  };
  await chromeStorage.setItem(
    getSLHDSAPreparedSignerStorageKey(accountId),
    record
  );
  return record;
};

export const getSLHDSAPreparedSmartAccountSigner = async ({
  accountId,
}: {
  accountId: number;
}): Promise<SLHDSAPreparedSmartAccountSigner | null> => {
  const record = (await chromeStorage.getItem(
    getSLHDSAPreparedSignerStorageKey(accountId)
  )) as SLHDSAPreparedSmartAccountSigner | null;
  if (record?.config?.keyId) {
    return record;
  }

  return null;
};

export const getSLHDSASmartAccountSetupStatus = async ({
  accountId,
}: {
  accountId: number;
}): Promise<SLHDSASmartAccountSetupStatus | null> => {
  const status = (await chromeStorage.getItem(
    getSLHDSASetupStorageKey(accountId)
  )) as SLHDSASmartAccountSetupStatus | null;
  if (status?.status === 'running' && !setupJobs.has(accountId)) {
    await chromeStorage.removeItem(getSLHDSASetupStorageKey(accountId));
    return null;
  }
  return status;
};

export const clearSLHDSASmartAccountSetupStatus = async ({
  accountId,
}: {
  accountId: number;
}) => {
  await chromeStorage.removeItem(getSLHDSASetupStorageKey(accountId));
};

export const startSLHDSASmartAccountValidatorSetup = async ({
  accountId,
  accountIndex,
  force = false,
  getSetupSecret,
}: {
  accountId: number;
  accountIndex: number;
  force?: boolean;
  getSetupSecret: () => Promise<{
    derivationLabel: string;
    setupSecretHex: string;
  }>;
}): Promise<SLHDSASmartAccountSetupStatus> => {
  const existingJob = setupJobs.get(accountId);
  if (existingJob) {
    return (
      (await getSLHDSASmartAccountSetupStatus({ accountId })) || {
        accountId,
        startedAt: Date.now(),
        status: 'running',
        updatedAt: Date.now(),
      }
    );
  }

  const existingStatus = await getSLHDSASmartAccountSetupStatus({ accountId });
  if (existingStatus?.status === 'running') {
    return existingStatus;
  }
  if (!force && existingStatus?.status === 'ready' && existingStatus.config) {
    return existingStatus;
  }

  const startedAt = Date.now();
  const storageKey = getSLHDSASetupStorageKey(accountId);
  const runningStatus: SLHDSASmartAccountSetupStatus = {
    accountId,
    phase: 'key-derivation',
    startedAt,
    status: 'running',
    updatedAt: startedAt,
  };
  await chromeStorage.setItem(storageKey, runningStatus);

  const job = (async (): Promise<SLHDSASmartAccountSetupStatus> => {
    try {
      const { derivationLabel, setupSecretHex } = await getSetupSecret();
      const state = await provisionRuntimeSLHDSAStateFromSetupSecret({
        accountId,
        accountIndex,
        derivationLabel,
        setupSecretHex,
      });
      const status: SLHDSASmartAccountSetupStatus = {
        accountId,
        canFinalize: true,
        config: {
          keyId: state.keyId,
          parameterSet: SLH_DSA_PARAMETER_SET,
          pkRoot: state.pkRoot,
          pkSeed: state.pkSeed,
          signatureLimit: state.signatureLimit,
        },
        startedAt,
        status: 'ready',
        updatedAt: Date.now(),
      };
      await saveSLHDSAPreparedSmartAccountSigner({
        accountId,
        config: status.config,
      });
      await chromeStorage.setItem(storageKey, status);
      return status;
    } catch (error: any) {
      const status: SLHDSASmartAccountSetupStatus = {
        accountId,
        error: error?.message || String(error),
        startedAt,
        status: 'failed',
        updatedAt: Date.now(),
      };
      await chromeStorage.setItem(storageKey, status);
      throw error;
    } finally {
      setupJobs.delete(accountId);
    }
  })();

  setupJobs.set(accountId, job);
  void job.catch(() => undefined);
  return runningStatus;
};

export const provisionSLHDSASmartAccountValidator = async ({
  accountId,
  accountIndex,
  getSetupSecret,
}: {
  accountId: number;
  accountIndex: number;
  getSetupSecret: () => Promise<{
    derivationLabel: string;
    setupSecretHex: string;
  }>;
}): Promise<SLHDSASmartAccountSetupStatus['config']> => {
  const status = await startSLHDSASmartAccountValidatorSetup({
    accountId,
    accountIndex,
    getSetupSecret,
  });
  if (status.status === 'ready' && status.config) {
    return status.config;
  }
  const job = setupJobs.get(accountId);
  if (!job) {
    throw new Error('SLH-DSA setup is already running for this account');
  }
  return (await job).config;
};
