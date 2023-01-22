import { PaliInpageProviderEth } from './paliProviderEthereum';

/**
 * If no existing window.web3 is found, this function injects a web3 "shim" to
 * not break dapps that rely on window.web3.currentProvider.
 *
 * @param provider - The provider to set as window.web3.currentProvider.
 * @param log - The logging API to use.
 */
export function shimWeb3(provider: PaliInpageProviderEth): void {
  let loggedCurrentProvider = false;
  let loggedMissingProperty = false;

  if (!(window as Record<string, any>).web3) {
    const SHIM_IDENTIFIER = '__isMetaMaskShim__';

    let web3Shim = { currentProvider: provider };
    Object.defineProperty(web3Shim, SHIM_IDENTIFIER, {
      value: true,
      enumerable: true,
      configurable: false,
      writable: false,
    });

    web3Shim = new Proxy(web3Shim, {
      get: (target, property, ...args) => {
        if (property === 'currentProvider' && !loggedCurrentProvider) {
          loggedCurrentProvider = true;
          console.warn(
            'You are accessing the Pali window.web3.currentProvider shim. This property is deprecated; use window.ethereum instead. For details, see metamask docs: https://docs.metamask.io/guide/provider-migration.html#replacing-window-web3'
          );
        } else if (
          property !== 'currentProvider' &&
          property !== SHIM_IDENTIFIER &&
          !loggedMissingProperty
        ) {
          loggedMissingProperty = true;
          console.error(
            `Pali no longer injects web3. For details, see metamask docs: https://docs.metamask.io/guide/provider-migration.html#replacing-window-web3`
          );
        }
        return Reflect.get(target, property, ...args);
      },
      set: (...args) => {
        console.warn(
          'You are accessing the Pali window.web3 shim. This object is deprecated; use window.ethereum instead. For details, see metamask docs: https://docs.metamask.io/guide/provider-migration.html#replacing-window-web3'
        );
        return Reflect.set(...args);
      },
    });

    Object.defineProperty(window, 'web3', {
      value: web3Shim,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
}
