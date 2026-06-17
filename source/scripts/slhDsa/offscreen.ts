import type {
  SLHDSASignActionHashParams,
  SLHDSAWorkerRequest,
  SLHDSAWorkerResponse,
} from 'utils/slhDsa';

let worker: Worker | null = null;
const lastPersistedSetupProgress = new Map<
  number,
  { percent: number; updatedAt: number }
>();

const getSLHDSASetupStorageKey = (accountId: number) =>
  `pali-slh-dsa-smart-account-setup:${accountId}`;

const updateSetupProgress = async (
  accountId: number | undefined,
  progress: Extract<SLHDSAWorkerResponse, { type: 'progress' }>['result']
) => {
  if (typeof accountId !== 'number') {
    return;
  }
  const key = getSLHDSASetupStorageKey(accountId);
  const current = await chrome.storage.local.get(key);
  const existing = current[key];
  if (!existing || existing.status !== 'running') {
    return;
  }
  const percent = Math.floor((progress.completed / progress.total) * 100);
  const now = Date.now();
  const lastPersisted = lastPersistedSetupProgress.get(accountId);
  const shouldPersist =
    !lastPersisted ||
    percent >= lastPersisted.percent + 5 ||
    percent >= 99 ||
    now - lastPersisted.updatedAt >= 5000;
  if (!shouldPersist) {
    return;
  }
  lastPersistedSetupProgress.set(accountId, {
    percent,
    updatedAt: now,
  });
  await chrome.storage.local.set({
    [key]: {
      ...existing,
      phase: progress.phase,
      progress: {
        completed: progress.completed,
        level: progress.level,
        total: progress.total,
      },
      updatedAt: now,
    },
  });
};

const getWorker = () => {
  if (!worker) {
    worker = new Worker(new URL('./slhDsaWorker.ts', import.meta.url));
  }
  return worker;
};

const resetWorker = (activeWorker: Worker) => {
  activeWorker.terminate();
  if (worker === activeWorker) {
    worker = null;
  }
};

const postWorkerRequest = (
  request: SLHDSAWorkerRequest
): Promise<SLHDSAWorkerResponse> =>
  new Promise((resolve, reject) => {
    const activeWorker = getWorker();
    const onMessage = (event: MessageEvent<SLHDSAWorkerResponse>) => {
      if (event.data.id !== request.id) {
        return;
      }
      if (event.data.type === 'progress') {
        void updateSetupProgress(
          request.type === 'prepare_keypair'
            ? request.payload.accountId
            : undefined,
          event.data.result
        );
        return;
      }
      activeWorker.removeEventListener('message', onMessage);
      resolve(event.data);
      resetWorker(activeWorker);
    };
    activeWorker.addEventListener('message', onMessage);
    activeWorker.onerror = (event) => {
      activeWorker.removeEventListener('message', onMessage);
      resetWorker(activeWorker);
      reject(new Error(event.message));
    };
    activeWorker.postMessage(request);
  });

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (
    message?.type !== 'PALI_SLH_DSA_SIGN' &&
    message?.type !== 'PALI_SLH_DSA_PREPARE_KEYPAIR' &&
    message?.type !== 'PALI_SLH_DSA_CLEAR_XMSS_CACHE'
  ) {
    return false;
  }

  Promise.resolve()
    .then(async () => {
      const response =
        message.type === 'PALI_SLH_DSA_PREPARE_KEYPAIR'
          ? await postWorkerRequest({
              id: crypto.randomUUID(),
              payload: message.payload,
              type: 'prepare_keypair',
            })
          : message.type === 'PALI_SLH_DSA_CLEAR_XMSS_CACHE'
          ? await postWorkerRequest({
              id: crypto.randomUUID(),
              type: 'clear_xmss_cache',
            })
          : await postWorkerRequest({
              id: crypto.randomUUID(),
              payload: message.payload as SLHDSASignActionHashParams & {
                secretKeyHex?: string;
              },
              type: 'sign_action_hash',
            });
      if (response.type === 'error') {
        return { error: response.error, success: false };
      }
      return {
        result: response.result,
        success: true,
      };
    })
    .then(sendResponse)
    .catch((error) =>
      sendResponse({
        error: error?.message || String(error),
        success: false,
      })
    );

  return true;
});
