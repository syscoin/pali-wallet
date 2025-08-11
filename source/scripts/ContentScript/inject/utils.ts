export interface IEIP6963ProviderInfo {
  icon: string;
  name: string;
  rdns: string;
  uuid: string;
}
// resolve response.result or response, reject errors
export const getRpcPromiseCallback =
  (resolve: (value?: any) => void, reject: (error?: Error) => void) =>
  (error: Error, response: any, unwrapResult = true): void => {
    if (response === undefined && (error === undefined || error === null)) {
      resolve(undefined);
      return;
    } else if (response === null && (error === undefined || error === null)) {
      resolve(null);
      return;
    }
    if (error || response.error) {
      reject(error || response.error);
    } else {
      !unwrapResult || Array.isArray(response)
        ? resolve(response)
        : resolve(response.result);
    }
  };

/**
 * Checks whether the given chain ID is valid, meaning if it is non-empty,
 * '0x'-prefixed string.
 *
 * @param chainId - The chain ID to validate.
 * @returns Whether the given chain ID is valid.
 */
export const isValidChainId = (chainId: unknown): chainId is string => {
  if (typeof chainId !== 'string') return false;
  // Require at least one hex digit after 0x
  return /^0x[0-9a-fA-F]+$/.test(chainId);
};

/**
 * Checks whether the given network version is valid, meaning if it is non-empty
 * string.
 *
 * @param networkVersion - The network version to validate.
 * @returns Whether the given network version is valid.
 */
export const isValidNetworkVersion = (
  networkVersion: unknown
): networkVersion is number | string => {
  // Accept non-negative numbers (including 0) for UTXO networks
  if (typeof networkVersion === 'number') {
    return Number.isInteger(networkVersion) && networkVersion >= 0;
  }
  // Accept non-empty strings (including '0') for EVM-style net_version
  return typeof networkVersion === 'string' && networkVersion.length > 0;
};

export const NOOP = () => undefined;
export const EMITTED_NOTIFICATIONS = Object.freeze([
  'eth_subscription', // per eth-json-rpc-filters/subscriptionManager
]);

export const announceProvider = (provider: any, uuid: string) => {
  const localIconUrl = (() => {
    try {
      // Try extension API first (available in content script contexts)
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const maybeChromeUrl = chrome?.runtime?.getURL?.(
        'assets/all_assets/favicon-48.png'
      );
      if (maybeChromeUrl) return maybeChromeUrl;
    } catch (_) {
      return undefined;
    }
    // Fallback: derive extension origin from the inpage script tag URL
    try {
      // Find the script element whose src points to our inpage bundle
      const scripts = Array.from(
        document.getElementsByTagName('script')
      ) as HTMLScriptElement[];
      const inpageScript = scripts.find(
        (s) =>
          s.src &&
          (s.src.includes('/js/inpage.bundle.js') ||
            s.src.startsWith('chrome-extension://'))
      );
      if (inpageScript && inpageScript.src) {
        const origin = new URL(inpageScript.src).origin;
        return `${origin}/assets/all_assets/favicon-48.png`;
      }
    } catch (_) {
      // ignore
    }
    return undefined;
  })();

  // Prefer HTTPS icon to bypass site CSP that blocks chrome-extension:// images
  const httpsIcon =
    'https://raw.githubusercontent.com/syscoin/pali-wallet/master/source/assets/all_assets/favicon-128.png';

  const providerInfo: IEIP6963ProviderInfo = {
    icon: localIconUrl || httpsIcon || '',
    name: 'Pali Wallet',
    rdns: 'com.paliwallet',
    uuid,
  };

  const detail = { info: providerInfo, provider };

  window.dispatchEvent(
    new CustomEvent('eip6963:announceProvider', {
      detail: detail,
    })
  );
};
