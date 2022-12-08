export declare type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | {
      [prop: string]: Json;
    };

export type IEthereumRpcErrorHandlerSerialized = {
  code: number;
  data?: Json;
  message: string;
  stack?: string;
};
