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

const ensureOffscreenDocument = async () => {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as any],
  });
  if (contexts.length > 0) {
    return;
  }

  await chrome.offscreen.createDocument({
    justification: 'Run local SLH-DSA signing without blocking the wallet UI',
    reasons: ['DOM_SCRAPING' as any],
    url: 'offscreen.html',
  });
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
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as any],
  });
  if (contexts.length === 0) {
    return;
  }

  const response = (await chrome.runtime.sendMessage({
    type: 'PALI_SLH_DSA_CLEAR_XMSS_CACHE',
  })) as SLHDSAOffscreenResponse | undefined;

  if (response?.success === false) {
    throw new Error(response.error);
  }
};

export const cancelSLHDSAWorkerInOffscreen = async (): Promise<void> => {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as any],
  });
  if (contexts.length === 0) {
    return;
  }

  const response = (await chrome.runtime.sendMessage({
    type: 'PALI_SLH_DSA_CANCEL_WORKER',
  })) as SLHDSAOffscreenResponse | undefined;

  if (response?.success === false) {
    throw new Error(response.error);
  }
};
