declare module 'syscointx-js' {
  export const bufferUtils: {
    deserializeAssetAllocations(payload: Uint8Array): unknown[];
  };
}
