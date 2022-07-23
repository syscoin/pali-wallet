import { browser } from 'webextension-polyfill-ts';

import { EthProvider } from 'scripts/Provider/EthProvider';
import { SysProvider } from 'scripts/Provider/SysProvider';

import { Message } from './types';

/**
 * Handles methods request.
 *
 * Methods have a prefix and a name. Prefixes are the destination of the
 * request. Supported: sys, eth, wallet
 *
 * @return The method return
 */
export const methodRequest = async (
  message: Message,
  origin: string,
  setPendingWindow: (isPending: boolean) => void,
  isPendingWindow: () => boolean
) => {
  const { dapp } = window.controller;

  const [prefix, methodName] = message.data.method.split('_');

  //* Wallet methods
  if (prefix === 'wallet') {
    switch (methodName) {
      case 'isConnected':
        return dapp.isConnected(origin);
      case 'changeAccount':
        return changeAccount(
          message.data.network,
          origin,
          isPendingWindow,
          setPendingWindow
        );
      default:
        throw new Error('Unknown method');
    }
  }

  //* Providers methods
  const provider = prefix === 'sys' ? SysProvider(origin) : EthProvider(origin);
  const method = provider[methodName];

  if (!method) throw new Error('Unknown method');

  return await method(message.data.args);
};

/**
 * Opens a popup to select another account to connect
 *
 * @return `true` if the selected account was changed
 */
const changeAccount = async (
  network: string,
  origin: string,
  isPendingWindow: () => boolean,
  setPendingWindow: (isPending: boolean) => void
) => {
  const { dapp, createPopup } = window.controller;

  const isConnected = dapp.isConnected(origin);

  if (isPendingWindow() || !isConnected) return;

  const popup = await createPopup('change-account', { network, origin });

  setPendingWindow(true);

  return new Promise<boolean>((resolve) => {
    window.addEventListener(
      'accountChange',
      (event: CustomEvent) => {
        if (event.detail.origin === origin) {
          setPendingWindow(false);
          resolve(true);
        }
      },
      { once: true, passive: true }
    );

    browser.windows.onRemoved.addListener((id) => {
      if (id === popup.id) {
        setPendingWindow(false);
        resolve(false);
      }
    });
  });
};
