export enum GlobalMessageEvent {
  rehydrate = 'rehydrate',
}

export enum DappMessageEvent {
  accountsChanged = 'accountsChanged',
  chainChanged = 'chainChanged',
  connect = 'connect',
  disconnect = 'disconnect',
  notifyAccounts = 'notifyAccounts',
}

export enum MessageType {
  dapp = 'dapp',
  global = 'global',
}

export type DappMessage = {
  event: DappMessageEvent;
  payload: any;
  type: MessageType;
};

export type GlobalMessage = {
  event: GlobalMessageEvent;
  type: MessageType;
};
