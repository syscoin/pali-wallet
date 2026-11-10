import { getAddress } from '../utils/ethersV6Compat.ts';

export type SmartAccountPreparationAuthenticator = Readonly<{
  config?: unknown;
  id?: string;
}>;
export type SmartAccountPreparationRequest = Readonly<{
  authenticator?: SmartAccountPreparationAuthenticator;
  initialAuthenticator?: SmartAccountPreparationAuthenticator;
  label?: string;
  policy?: Readonly<{ authenticator?: SmartAccountPreparationAuthenticator }>;
}>;
export type SmartAccountPreparationEcdsaConfig = Readonly<{
  owners: readonly string[];
  threshold: number;
}>;
export type SmartAccountPreparationTarget =
  | Readonly<{
      config: SmartAccountPreparationEcdsaConfig | undefined;
      id: 'ecdsa';
    }>
  | Readonly<{ id: 'p256-webauthn' | 'slh-dsa' }>;

export class SmartAccountPreparationError extends Error {
  readonly code:
    | 'PREPARE_FAILED'
    | 'COMPOSITE_UNSUPPORTED'
    | 'EXTERNAL_PASSKEY_UNSUPPORTED';

  constructor(code: SmartAccountPreparationError['code']) {
    super(code);
    this.name = 'SmartAccountPreparationError';
    this.code = code;
  }
}

/** Select for presentation without moving the extension's approval-time validation earlier. */
export function getRequestedSmartAccountAuthenticator(
  request: SmartAccountPreparationRequest
): SmartAccountPreparationAuthenticator {
  return (
    request.authenticator ||
    request.initialAuthenticator ||
    request.policy?.authenticator || { id: 'p256-webauthn' }
  );
}

/** Public target policy only. Credential acquisition and external-owner consent remain in the host. */
export function resolveSmartAccountPreparationTarget(
  selected: SmartAccountPreparationAuthenticator,
  { slhDsaSupported }: { slhDsaSupported: boolean }
): SmartAccountPreparationTarget {
  if (selected?.id === 'composite')
    throw new SmartAccountPreparationError('COMPOSITE_UNSUPPORTED');
  if (selected?.id === 'p256-webauthn') {
    if (selected.config !== undefined && selected.config !== null)
      throw new SmartAccountPreparationError('EXTERNAL_PASSKEY_UNSUPPORTED');
    return Object.freeze({ id: 'p256-webauthn' });
  }
  if (selected?.id === 'slh-dsa') {
    if (selected.config || !slhDsaSupported)
      throw new SmartAccountPreparationError('PREPARE_FAILED');
    return Object.freeze({ id: 'slh-dsa' });
  }
  if (selected?.id !== 'ecdsa')
    throw new SmartAccountPreparationError('PREPARE_FAILED');
  if (selected.config === undefined)
    return Object.freeze({ id: 'ecdsa', config: undefined });
  const config = selected.config as {
    owners?: unknown;
    threshold?: unknown;
  } | null;
  if (!Array.isArray(config?.owners) || config.owners.length === 0)
    throw new SmartAccountPreparationError('PREPARE_FAILED');
  const owners = config.owners.map((owner: string) => getAddress(owner));
  const threshold = config.threshold === undefined ? 1 : config.threshold;
  if (
    typeof threshold !== 'number' ||
    !Number.isInteger(threshold) ||
    threshold < 1 ||
    threshold > owners.length ||
    new Set(owners).size !== owners.length
  )
    throw new SmartAccountPreparationError('PREPARE_FAILED');
  return Object.freeze({
    id: 'ecdsa',
    config: Object.freeze({ owners: Object.freeze(owners), threshold }),
  });
}

export type SmartAccountPreparationResult = Readonly<{
  address: string;
  chainId: `0x${string}`;
  installedValidator?: string;
}>;

export function projectSmartAccountPreparationResult(
  address: string,
  chainId: number,
  installedValidator?: string
): SmartAccountPreparationResult {
  return Object.freeze({
    address,
    chainId: `0x${chainId.toString(16)}`,
    ...(installedValidator === undefined ? {} : { installedValidator }),
  });
}
