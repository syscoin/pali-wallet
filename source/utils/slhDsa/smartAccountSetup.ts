import { v4 as uuidv4 } from 'uuid';

import { chromeStorage } from 'utils/storageAPI';

import { SLH_DSA_PARAMETER_SET } from './constants';
import {
  assertSLHDSASessionGeneration,
  getSLHDSASessionGeneration,
  provisionRuntimeSLHDSAStateFromSetupSecret,
} from './signer';

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
  setupJobId?: string;
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

const setupJobs = new Map<
  number,
  {
    assertCurrent: () => void;
    promise: Promise<SLHDSASmartAccountSetupStatus>;
    sessionGeneration: number;
    setupJobId: string;
  }
>();
const setupStorageQueues = new Map<number, Promise<void>>();

// A dispatched storage write cannot be cancelled. Retain its ordering barrier
// across wallet sessions so the new owner always writes after it settles.
const withSetupStorage = <T>(
  accountId: number,
  action: () => Promise<T>
): Promise<T> => {
  const previous = setupStorageQueues.get(accountId) ?? Promise.resolve();
  const result = previous.then(action);
  const settled = result.then(
    () => undefined,
    () => undefined
  );
  setupStorageQueues.set(accountId, settled);
  void settled.then(() => {
    if (setupStorageQueues.get(accountId) === settled)
      setupStorageQueues.delete(accountId);
  });
  return result;
};

const getSLHDSASetupStorageKey = (accountId: number) =>
  `pali-slh-dsa-smart-account-setup:${accountId}`;

const getSLHDSAPreparedSignerStorageKey = (accountId: number) =>
  `pali-slh-dsa-prepared-smart-account-signer:v1:${accountId}`;

export const persistSLHDSASmartAccountSetupProgress = async (message: {
  accountId?: unknown;
  progress?: unknown;
  setupJobId?: unknown;
}): Promise<boolean> => {
  const { accountId, setupJobId } = message;
  const progress = message.progress as Partial<{
    completed: number;
    level: number;
    phase: string;
    total: number;
  }> | null;
  if (
    typeof accountId !== 'number' ||
    !Number.isSafeInteger(accountId) ||
    accountId < 0 ||
    typeof setupJobId !== 'string' ||
    !setupJobId ||
    !progress ||
    progress.phase !== 'xmss-cache' ||
    !Number.isSafeInteger(progress.completed) ||
    Number(progress.completed) < 0 ||
    !Number.isSafeInteger(progress.total) ||
    Number(progress.total) <= 0 ||
    Number(progress.completed) > Number(progress.total) ||
    !Number.isSafeInteger(progress.level) ||
    Number(progress.level) < 0
  )
    return false;

  const owner = setupJobs.get(accountId);
  const isCurrent = () => {
    if (
      !owner ||
      setupJobs.get(accountId) !== owner ||
      owner.setupJobId !== setupJobId
    )
      return false;
    try {
      owner.assertCurrent();
      return true;
    } catch {
      return false;
    }
  };
  if (!isCurrent()) return false;
  return withSetupStorage(accountId, async () => {
    if (!isCurrent()) return false;
    const key = getSLHDSASetupStorageKey(accountId);
    const existing = (await chromeStorage.getItem(
      key
    )) as SLHDSASmartAccountSetupStatus | null;
    if (
      !isCurrent() ||
      existing?.status !== 'running' ||
      existing.setupJobId !== setupJobId
    )
      return false;
    if (
      existing.progress &&
      (existing.progress.total !== progress.total ||
        existing.progress.completed > Number(progress.completed))
    )
      return false;
    await chromeStorage.setItem(key, {
      ...existing,
      phase: 'xmss-cache',
      progress: {
        completed: progress.completed,
        level: progress.level,
        total: progress.total,
      },
      updatedAt: Date.now(),
    });
    // The queue keeps a dispatched old write ahead of the replacement owner's
    // writes even if its session is invalidated while storage is pending.
    return isCurrent();
  });
};

export const saveSLHDSAPreparedSmartAccountSigner = async ({
  accountId,
  assertCurrent,
  config,
}: {
  accountId: number;
  assertCurrent?: () => void;
  config: NonNullable<SLHDSASmartAccountSetupStatus['config']>;
}) => {
  const generation = getSLHDSASessionGeneration();
  const assertOwner = () => {
    assertSLHDSASessionGeneration(generation);
    assertCurrent?.();
  };
  const record: SLHDSAPreparedSmartAccountSigner = {
    accountId,
    config,
    updatedAt: Date.now(),
    version: 1,
  };
  await withSetupStorage(accountId, async () => {
    assertOwner();
    await chromeStorage.setItem(
      getSLHDSAPreparedSignerStorageKey(accountId),
      record
    );
    assertOwner();
  });
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
  const generation = getSLHDSASessionGeneration();
  return withSetupStorage(accountId, async () => {
    assertSLHDSASessionGeneration(generation);
    const status = (await chromeStorage.getItem(
      getSLHDSASetupStorageKey(accountId)
    )) as SLHDSASmartAccountSetupStatus | null;
    assertSLHDSASessionGeneration(generation);
    if (
      status?.status === 'running' &&
      setupJobs.get(accountId)?.sessionGeneration !== generation
    ) {
      await chromeStorage.removeItem(getSLHDSASetupStorageKey(accountId));
      assertSLHDSASessionGeneration(generation);
      return null;
    }
    return status;
  });
};

export const clearSLHDSASmartAccountSetupStatus = async ({
  accountId,
}: {
  accountId: number;
}) => {
  const generation = getSLHDSASessionGeneration();
  await withSetupStorage(accountId, async () => {
    assertSLHDSASessionGeneration(generation);
    await chromeStorage.removeItem(getSLHDSASetupStorageKey(accountId));
    assertSLHDSASessionGeneration(generation);
  });
};

export const startSLHDSASmartAccountValidatorSetup = async ({
  accountId,
  accountIndex,
  assertCurrent,
  force = false,
  getSetupSecret,
}: {
  accountId: number;
  accountIndex: number;
  assertCurrent?: () => void;
  force?: boolean;
  getSetupSecret: () => Promise<{
    derivationLabel: string;
    setupSecretHex: string;
  }>;
}): Promise<SLHDSASmartAccountSetupStatus> => {
  const sessionGeneration = getSLHDSASessionGeneration();
  const assertSetupCurrent = () => {
    assertSLHDSASessionGeneration(sessionGeneration);
    assertCurrent?.();
  };
  assertSetupCurrent();
  return withSetupStorage(accountId, async () => {
    assertSetupCurrent();
    const existingJob = setupJobs.get(accountId);
    const existingStatus = (await chromeStorage.getItem(
      getSLHDSASetupStorageKey(accountId)
    )) as SLHDSASmartAccountSetupStatus | null;
    assertSetupCurrent();
    if (existingJob?.sessionGeneration === sessionGeneration) {
      return (
        existingStatus || {
          accountId,
          startedAt: Date.now(),
          status: 'running',
          updatedAt: Date.now(),
        }
      );
    }
    if (!force && existingStatus?.status === 'ready' && existingStatus.config) {
      return existingStatus;
    }

    const startedAt = Date.now();
    const setupJobId = uuidv4();
    const storageKey = getSLHDSASetupStorageKey(accountId);
    const runningStatus: SLHDSASmartAccountSetupStatus = {
      accountId,
      setupJobId,
      phase: 'key-derivation',
      startedAt,
      status: 'running',
      updatedAt: startedAt,
    };
    await chromeStorage.setItem(storageKey, runningStatus);
    assertSetupCurrent();

    // Defer execution until the exact owner entry has been registered, including
    // when an assertion or getSetupSecret throws synchronously.
    const job: Promise<SLHDSASmartAccountSetupStatus> = Promise.resolve().then(
      async (): Promise<SLHDSASmartAccountSetupStatus> => {
        try {
          assertSetupCurrent();
          const { derivationLabel, setupSecretHex } = await getSetupSecret();
          assertSetupCurrent();
          const state = await provisionRuntimeSLHDSAStateFromSetupSecret(
            {
              accountId,
              accountIndex,
              derivationLabel,
              setupJobId,
              setupSecretHex,
            },
            sessionGeneration
          );
          assertSetupCurrent();
          const status: SLHDSASmartAccountSetupStatus = {
            accountId,
            setupJobId,
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
            assertCurrent: assertSetupCurrent,
            config: status.config,
          });
          assertSetupCurrent();
          await withSetupStorage(accountId, async () => {
            assertSetupCurrent();
            await chromeStorage.setItem(storageKey, status);
            assertSetupCurrent();
          });
          return status;
        } catch (error: any) {
          // A cancelled session/approval no longer owns this account-id namespace.
          // Do not overwrite the replacement session with its late failure status.
          assertSetupCurrent();
          const status: SLHDSASmartAccountSetupStatus = {
            accountId,
            setupJobId,
            error: error?.message || String(error),
            startedAt,
            status: 'failed',
            updatedAt: Date.now(),
          };
          await withSetupStorage(accountId, async () => {
            assertSetupCurrent();
            await chromeStorage.setItem(storageKey, status);
            assertSetupCurrent();
          });
          throw error;
        } finally {
          if (setupJobs.get(accountId)?.promise === job)
            setupJobs.delete(accountId);
        }
      }
    );

    setupJobs.set(accountId, {
      assertCurrent: assertSetupCurrent,
      promise: job,
      sessionGeneration,
      setupJobId,
    });
    void job.catch(() => undefined);
    return runningStatus;
  });
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
  const generation = getSLHDSASessionGeneration();
  const status = await startSLHDSASmartAccountValidatorSetup({
    accountId,
    accountIndex,
    getSetupSecret,
  });
  assertSLHDSASessionGeneration(generation);
  if (status.status === 'ready' && status.config) {
    return status.config;
  }
  const job = setupJobs.get(accountId);
  if (!job) {
    const completed = await getSLHDSASmartAccountSetupStatus({ accountId });
    assertSLHDSASessionGeneration(generation);
    if (completed?.status === 'ready' && completed.config)
      return completed.config;
    throw new Error('SLH-DSA setup is already running for this account');
  }
  assertSLHDSASessionGeneration(job.sessionGeneration);
  const config = (await job.promise).config;
  assertSLHDSASessionGeneration(generation);
  return config;
};
