import { Json } from '@metamask/utils';

export type IEthereumRpcErrorHandlerSerialized = {
  code: number;
  data?: Json;
  message: string;
  stack?: string;
};
