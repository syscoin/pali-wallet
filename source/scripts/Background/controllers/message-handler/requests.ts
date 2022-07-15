import { v4 as uuid } from 'uuid';
import { browser, Runtime } from 'webextension-polyfill-ts';

// import { erc20DataDecoder } from 'utils/ethUtil';

import { Message } from './types';

export const handleRequest = async (
  port: Runtime.Port,
  message: Message,
  origin: string,
  setPendingWindow: (isPending: boolean) => void,
  isPendingWindow: () => boolean
) => {
  console.log('[request handler] data:', message.data);
  const { args } = message.data;
  const [prefix, methodName] = message.data.method.split('_');

  const { controller } = window;

  // const isConnected = controller.dapp.isDAppConnected(origin);
  // const walletIsLocked = !controller.wallet.isUnlocked();

  // TODO improve this
  if (prefix === 'wallet' && methodName === 'changeAccount')
    return changeAccount(message.data.network);

  const provider =
    prefix === 'sys'
      ? controller.dapp.sysProvider
      : controller.dapp.ethProvider;

  /* const windowId = `signMessage${uuid()}`;

  const isSignMessage = async () => {
    if (isPendingWindow()) {
      return Promise.resolve(null);
    }

    const popup = await controller.createPopup(windowId);
    setPendingWindow(true);

    controller.dapp.setSigRequest({
      origin: origin as string,
      address: args[1],
      message: args[0],
    });

    window.addEventListener(
      'sign',
      (ev: any) => {
        if (ev.detail.substring(1) === windowId) {
          result = controller.dapp.paliProvider.signMessage(args[0]);
          port.postMessage({ id: message.id, data: { result } });
          setPendingWindow(false);
        }
      },
      {
        once: true,
        passive: true,
      }
    );

    browser.windows.onRemoved.addListener((id) => {
      if (popup && id === popup.id) {
        port.postMessage({ id: message.id, data: { result: false } });
        setPendingWindow(false);
      }
    });

    return Promise.resolve(null);
  };

  const sendTransaction = async (data) => {
    await controller.createPopup(
      windowId,
      message.data.network,
      'sendTransaction',
      { ...data }
    );

    setPendingWindow(true);

    window.addEventListener(
      'transactionSent',
      (ev: any) => {
        if (ev.detail.windowId === windowId) {
          port.postMessage({
            id: message.id,
            data: { result: true, data: {} },
          });
          setPendingWindow(false);
        }
      },
      { once: true, passive: true }
    );
  };

  const approveSpend = async (data) => {
    await controller.createPopup(
      windowId,
      message.data.network,
      'approveSpend',
      { ...data }
    );

    setPendingWindow(true);

    window.addEventListener(
      'spendApproved',
      (ev: any) => {
        if (ev.detail.windowId === windowId) {
          port.postMessage({
            id: message.id,
            data: { result: true, data: {} },
          });
          setPendingWindow(false);
        }
      },
      { once: true, passive: true }
    );
  };

  const isSendTransaction = () => {
    const data = args[0] ? args[0][0] : {};
    const decoder = erc20DataDecoder();
    const decodedTxData = data?.data ? decoder.decodeData(data?.data) : null;

    if (decodedTxData?.method === 'approve') {
      return approveSpend(data);
    }

    return sendTransaction(data);
  }; */

  const method = provider[methodName];
  if (!method) throw new Error('Unknown method');
  const result = await method(args);

  return result;
};

const changeAccount = async (network) => {
  // TODO check isConnected
  // TODO isPendingWindow
  const windowId = uuid();
  const popup = await window.controller.createPopup(
    windowId,
    network,
    'change-account'
  );
};
