import { EthereumRpcErrorHandler } from '../helpers/errors/errorClassesHandlers.ts';
import { assertProviderRequestBudget } from '../utils/requestPayloadBudget.ts';

export type DappPermissionMethod =
  | 'wallet_getPermissions'
  | 'wallet_requestPermissions'
  | 'wallet_revokePermissions';
export function isDappPermissionMethod(
  method: string
): method is DappPermissionMethod {
  return (
    method === 'wallet_getPermissions' ||
    method === 'wallet_requestPermissions' ||
    method === 'wallet_revokePermissions'
  );
}
export function readDappPermissionRequest(
  method: DappPermissionMethod,
  params: unknown
): Readonly<Record<string, unknown>> {
  assertProviderRequestBudget({ method, params });
  if (method === 'wallet_getPermissions') {
    if (params !== undefined && (!Array.isArray(params) || params.length))
      throw new EthereumRpcErrorHandler(
        -32602,
        'Expected no permission parameters'
      );
    return Object.freeze({});
  }
  const values = Array.isArray(params)
    ? params
    : params === undefined
    ? []
    : [params];
  if (method === 'wallet_revokePermissions' && !values.length)
    return Object.freeze({});
  const value = values[0];
  if (
    values.length !== 1 ||
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  )
    throw new EthereumRpcErrorHandler(
      -32602,
      'Expected one permission request'
    );
  if (method === 'wallet_requestPermissions') {
    const names = Object.keys(value);
    if (names.length !== 1 || names[0] !== 'eth_accounts')
      throw new EthereumRpcErrorHandler(
        4200,
        'Only existing eth_accounts permission can be requested'
      );
    const options = (value as Record<string, unknown>).eth_accounts;
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      Object.keys(options).length
    )
      throw new EthereumRpcErrorHandler(
        4200,
        'Permission caveats require a new connection approval'
      );
  }
  return Object.freeze({ ...value });
}

/** The common grant projection. Hosts pass only chains already granted to this origin. */
export function projectDappPermissions(
  origin: string,
  address: string,
  date: number,
  chainIds: readonly number[] | undefined
) {
  const result = [
    {
      id: '1',
      parentCapability: 'eth_accounts',
      invoker: origin,
      caveats: [{ type: 'restrictReturnedAccounts', value: [address] }],
      date,
    },
  ];
  if (chainIds !== undefined)
    result.push({
      id: '2',
      parentCapability: 'endowment:permitted-chains',
      invoker: origin,
      caveats: [
        {
          type: 'restrictNetworkSwitching',
          value: [...new Set(chainIds)].map(
            (chainId) => `0x${chainId.toString(16)}`
          ),
        },
      ],
      date,
    });
  return result;
}
