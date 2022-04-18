import axios from 'axios';
import { memoize } from 'lodash';
// import fetch from 'node-fetch';

const getFetchWithTimeout = memoize((timeout) => {
  if (!Number.isInteger(timeout) || timeout < 1) {
    throw new Error('Must specify positive integer timeout.');
  }

  return async function fetch(url, opts) {
    const abortController = new window.AbortController();
    const { signal } = abortController;
    const f = window.fetch(url, {
      ...opts,
      signal,
    });

    const timer = setTimeout(() => abortController.abort(), timeout);

    try {
      const res = await f;
      clearTimeout(timer);
      return res;
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  };
});

export const countDecimals = (x: number) => {
  if (Math.floor(x) === x) return 0;
  return x.toString().split('.')[1].length || 0;
};

export const isNFT = (guid: number) => {
  const assetGuid = BigInt.asUintN(64, BigInt(guid));

  return assetGuid >> BigInt(32) > 0;
};

export const sortList = (list: any) =>
  list.sort((a: any, b: any) => {
    const previous: any = a.symbol.toLowerCase();
    const next: any = b.symbol.toLowerCase();

    // @ts-ignore
    return (previous > next) - (previous < next);
  });

export const base64 =
  /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{4}|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)$/;

const fetchWithTimeout = getFetchWithTimeout(1000 * 30);

/**
 * Makes a JSON RPC request to the given URL, with the given RPC method and params.
 *
 * @param {string} rpcUrl - The RPC endpoint URL to target.
 * @param {string} rpcMethod - The RPC method to request.
 * @param {Array<unknown>} [rpcParams] - The RPC method params.
 * @returns {Promise<unknown|undefined>} Returns the result of the RPC method call,
 * or throws an error in case of failure.
 */
export const jsonRpcRequest = async (rpcUrl, rpcMethod, rpcParams = []) => {
  let fetchUrl = rpcUrl;

  const headers: { Authorization?: string; 'Content-Type': string } = {
    'Content-Type': 'application/json',
  };
  // Convert basic auth URL component to Authorization header
  const { origin, pathname, username, password, search } = new URL(rpcUrl);

  // URLs containing username and password needs special processing
  if (username && password) {
    const encodedAuth = Buffer.from(`${username}:${password}`).toString(
      'base64'
    );
    headers.Authorization = `Basic ${encodedAuth}`;
    fetchUrl = `${origin}${pathname}${search}`;
  }

  const jsonRpcResponse = await fetchWithTimeout(fetchUrl, {
    method: 'POST',
    body: JSON.stringify({
      id: Date.now().toString(),
      jsonrpc: '2.0',
      method: rpcMethod,
      params: rpcParams,
    }),
    headers,
    cache: 'default',
  }).then((httpResponse) => httpResponse.json());

  if (
    !jsonRpcResponse ||
    Array.isArray(jsonRpcResponse) ||
    typeof jsonRpcResponse !== 'object'
  ) {
    throw new Error(`RPC endpoint ${rpcUrl} returned non-object response.`);
  }

  const { error, result } = jsonRpcResponse;

  if (error) {
    throw new Error(error?.message || error);
  }

  return result;
};

const isValidChainIdForEthNetworks = (chainId) =>
  Number.isSafeInteger(chainId) && chainId > 0 && chainId <= 4503599627370476;

export const validateSysRpc = async (rpcUrl) => {
  const response = await axios.get(`${rpcUrl}/api/v2`);

  const {
    blockbook: { coin },
    backend: { chain },
  } = response.data;

  return Boolean(response && coin && chain);
};

export const validateEthRpc = async (chainId, rpcUrl) => {
  if (!isValidChainIdForEthNetworks)
    return new Error('Invalid chain ID for ethereum networks.');

  const response = await jsonRpcRequest(rpcUrl, 'eth_chainId');

  console.log('[validate eth rpc]', chainId, rpcUrl, response);

  return !!response;
};
