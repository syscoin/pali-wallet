import { migrateWalletState } from 'state/migrateWalletState';

import { IMasterController } from '.';

type Methods<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any
    ? [K]
    : T[K] extends object
    ? [K, ...Methods<T[K]>]
    : never;
}[keyof T];

type Controller = IMasterController & {
  migrateWalletState: typeof migrateWalletState;
};

export default function controllerEmitter<
  T extends IMasterController,
  P extends Methods<T>
>(methods: P, params?: any[], importMethod = false) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: `controller_action`,
        data: {
          methods,
          params: params || [],
          importMethod,
        },
      },
      (response) => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        resolve(response);
      }
    );
  });
}

export function controllerState<T extends IMasterController>(
  action: string,
  state: T
) {
  chrome.runtime.sendMessage(
    {
      type: `controller_state`,
      data: {
        action,
        state,
      },
    },
    (response) => {
      if (chrome.runtime.lastError) {
        console.log(chrome.runtime.lastError);
      }
    }
  );
}
