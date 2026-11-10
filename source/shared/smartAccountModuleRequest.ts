export const SMART_ACCOUNT_MODULE_REQUEST_METHODS = Object.freeze([
  'wallet_requestSmartAccountModuleInstall',
  'wallet_requestSmartAccountModuleUninstall',
] as const);

export type SmartAccountModuleRequestMethod =
  (typeof SMART_ACCOUNT_MODULE_REQUEST_METHODS)[number];

export type SmartAccountModuleRequest = Readonly<{
  action: 'install' | 'uninstall';
  method: SmartAccountModuleRequestMethod;
  module: Readonly<{ address?: string; initData?: string; name?: string }>;
}>;

export class SmartAccountModuleRequestError extends Error {
  readonly code = -32602;

  constructor() {
    super('Invalid smart account module');
    this.name = 'SmartAccountModuleRequestError';
  }
}

export function isSmartAccountModuleRequestMethod(
  method: unknown
): method is SmartAccountModuleRequestMethod {
  return SMART_ACCOUNT_MODULE_REQUEST_METHODS.some((value) => value === method);
}

/** Snapshot the extension's public RPC fields. User acknowledgement belongs to the host UI. */
export function normalizeSmartAccountModuleRequest(
  method: unknown,
  params: unknown
): SmartAccountModuleRequest {
  if (!isSmartAccountModuleRequestMethod(method))
    throw new SmartAccountModuleRequestError();
  // Existing extension requests also accept a direct object and ignore extra params.
  const input = Array.isArray(params) ? params[0] : params;
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new SmartAccountModuleRequestError();
  const module: { address?: string; initData?: string; name?: string } = {};
  for (const field of ['address', 'name', 'initData'] as const) {
    const value = (input as Record<string, unknown>)[field];
    if (value !== undefined) {
      if (typeof value !== 'string') throw new SmartAccountModuleRequestError();
      module[field] = value;
    }
  }
  return Object.freeze({
    method,
    action:
      method === SMART_ACCOUNT_MODULE_REQUEST_METHODS[0]
        ? 'install'
        : 'uninstall',
    module: Object.freeze(module),
  });
}
