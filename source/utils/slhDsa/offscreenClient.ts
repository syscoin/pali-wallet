import type { SLHDSASignActionHashParams } from './types';

export type SLHDSAOffscreenResponse =
  | {
      result: {
        pkRoot?: string;
        pkSeed?: string;
        secretKeyHex?: string;
        signature?: string;
      };
      success: true;
    }
  | { error: string; success: false };

let offscreenCreationPromise: Promise<void> | null = null;

const canEnumerateOffscreenContexts = () =>
  typeof chrome !== 'undefined' &&
  Boolean(chrome.runtime) &&
  'getContexts' in chrome.runtime &&
  typeof chrome.runtime.getContexts === 'function';

const getExistingOffscreenContexts = async () => {
  if (!canEnumerateOffscreenContexts()) {
    return [];
  }

  try {
    return await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT' as any],
    });
  } catch {
    return [];
  }
};

const isOffscreenAlreadyExistsError = (error: unknown) => {
  const message = String(
    error instanceof Error ? error.message : error
  ).toLowerCase();

  return (
    message.includes('already exists') ||
    message.includes('only a single offscreen document')
  );
};

const ensureOffscreenDocument = async () => {
  const contexts = await getExistingOffscreenContexts();
  if (contexts.length > 0) {
    return;
  }

  if (!offscreenCreationPromise) {
    offscreenCreationPromise = chrome.offscreen
      .createDocument({
        justification:
          'Run local SLH-DSA signing without blocking the wallet UI',
        reasons: ['DOM_SCRAPING' as any],
        url: 'offscreen.html',
      })
      .catch((error) => {
        if (!isOffscreenAlreadyExistsError(error)) {
          throw error;
        }
      })
      .finally(() => {
        offscreenCreationPromise = null;
      });
  }

  await offscreenCreationPromise;
};

const sendBestEffortOffscreenCleanupMessage = async (type: string) => {
  if (canEnumerateOffscreenContexts()) {
    const contexts = await getExistingOffscreenContexts();
    if (contexts.length === 0) {
      return;
    }
  }

  try {
    await chrome.runtime.sendMessage({ type });
  } catch {
    // Cleanup must not block wallet reset/forget flows in browsers without
    // Chrome offscreen document support.
  }
};

export const signSLHDSAInOffscreen = async (
  params: SLHDSASignActionHashParams & {
    secretKeyHex?: string;
  }
): Promise<string> => {
  await ensureOffscreenDocument();

  const response = (await chrome.runtime.sendMessage({
    payload: params,
    type: 'PALI_SLH_DSA_SIGN',
  })) as SLHDSAOffscreenResponse | undefined;

  if (!response) {
    throw new Error('SLH-DSA signer returned no response');
  }
  if (response.success === false) {
    throw new Error(response.error);
  }

  if (!response.result.signature) {
    throw new Error('SLH-DSA signer did not return a signature');
  }
  return response.result.signature;
};

export const prepareSLHDSAKeypairInOffscreen = async ({
  accountId,
  setupSecretHex,
}: {
  accountId?: number;
  setupSecretHex: string;
}): Promise<{
  pkRoot: string;
  pkSeed: string;
  secretKeyHex: string;
}> => {
  await ensureOffscreenDocument();

  const response = (await chrome.runtime.sendMessage({
    payload: { accountId, setupSecretHex },
    type: 'PALI_SLH_DSA_PREPARE_KEYPAIR',
  })) as SLHDSAOffscreenResponse | undefined;

  if (!response) {
    throw new Error('SLH-DSA key preparation returned no response');
  }
  if (response.success === false) {
    throw new Error(response.error);
  }
  const { pkRoot, pkSeed, secretKeyHex } = response.result;
  if (!pkRoot || !pkSeed || !secretKeyHex) {
    throw new Error('SLH-DSA key preparation returned incomplete key material');
  }

  return { pkRoot, pkSeed, secretKeyHex };
};

export const clearSLHDSAXmssCacheInOffscreen = async (): Promise<void> => {
  await sendBestEffortOffscreenCleanupMessage('PALI_SLH_DSA_CLEAR_XMSS_CACHE');
};

export const cancelSLHDSAWorkerInOffscreen = async (): Promise<void> => {
  await sendBestEffortOffscreenCleanupMessage('PALI_SLH_DSA_CANCEL_WORKER');
};
