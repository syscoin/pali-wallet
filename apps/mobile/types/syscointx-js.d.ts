declare module 'syscointx-js' {
  export const bufferUtils: {
    deserializeAssetAllocations(payload: Uint8Array): unknown[];
    serializeAssetAllocations(allocations: unknown[]): Uint8Array;
  };
  export const coinSelect: {
    utils: {
      dustThreshold(output: { scriptPubKey: Uint8Array }): {
        toString(): string;
      };
    };
  };
}
