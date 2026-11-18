import { RpcReadCapabilities } from '@sidhujag/sysweb3-keyring/cjs/rpc-read-client.js';

/** The host owns endpoint capabilities; request data and cancellation stay per operation. */
export function createRpcReadCapabilitiesOwner() {
  const entries = new Map<string, RpcReadCapabilities>();
  return {
    get(scope: string, url: string): RpcReadCapabilities {
      const key = JSON.stringify([scope, url]);
      let entry = entries.get(key);
      if (!entry) entry = new RpcReadCapabilities(url);
      entries.delete(key);
      entries.set(key, entry);
      if (entries.size > 32) entries.delete(entries.keys().next().value!);
      return entry;
    },
    clear() {
      entries.clear();
    },
  };
}
