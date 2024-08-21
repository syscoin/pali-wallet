import { IMasterController } from '.';

type Methods<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any
    ? [K]
    : T[K] extends object
    ? [K, ...Methods<T[K]>]
    : never;
}[keyof T];

export function controllerEmitter<
  T extends IMasterController,
  P extends Methods<T>
>(methods: P, params?: any[], importMethod = false) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: 'CONTROLLER_ACTION',
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
