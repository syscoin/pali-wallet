import type {
  SLHDSASignActionHashParams,
  SLHDSAWorkerRequest,
  SLHDSAWorkerResponse,
} from 'utils/slhDsa';

let worker: Worker | null = null;
let workerRequestQueue: Promise<SLHDSAWorkerResponse | void> =
  Promise.resolve();
let workerRequestGeneration = 0;
let rejectActiveWorkerRequest: ((error: Error) => void) | null = null;
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

const cancelWorkerRequests = () => {
  workerRequestGeneration += 1;
  const activeWorker = worker;
  const rejectActive = rejectActiveWorkerRequest;

  workerRequestQueue = Promise.resolve();
  rejectActiveWorkerRequest = null;
  if (rejectActive) {
    rejectActive(new Error('SLH-DSA worker request cancelled'));
  } else if (activeWorker) {
    resetWorker(activeWorker);
  }
};

const runWorkerRequest = (
  request: SLHDSAWorkerRequest
): Promise<SLHDSAWorkerResponse> =>
  new Promise((resolve, reject) => {
    const activeWorker = getWorker();
    let settled = false;
    const settle = (
      result:
        | { response: SLHDSAWorkerResponse; type: 'resolve' }
        | { error: Error; type: 'reject' }
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      activeWorker.removeEventListener('message', onMessage);
      if (rejectActiveWorkerRequest === rejectActive) {
        rejectActiveWorkerRequest = null;
      }
      resetWorker(activeWorker);
      if (result.type === 'resolve') {
        resolve(result.response);
      } else {
        reject(result.error);
      }
    };
    const rejectActive = (error: Error) => settle({ error, type: 'reject' });
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
      settle({ response: event.data, type: 'resolve' });
    };
    rejectActiveWorkerRequest = rejectActive;
    activeWorker.addEventListener('message', onMessage);
    activeWorker.onerror = (event) => {
      settle({ error: new Error(event.message), type: 'reject' });
    };
    activeWorker.postMessage(request);
  });

const postWorkerRequest = (request: SLHDSAWorkerRequest) => {
  const requestGeneration = workerRequestGeneration;
  const queuedRequest = workerRequestQueue.then(() => {
    if (requestGeneration !== workerRequestGeneration) {
      throw new Error('SLH-DSA worker request cancelled');
    }
    return runWorkerRequest(request);
  });
  workerRequestQueue = queuedRequest.catch(() => undefined);
  return queuedRequest;
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'PALI_SLH_DSA_CANCEL_WORKER') {
    cancelWorkerRequests();
    sendResponse({ result: {}, success: true });
    return false;
  }

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
