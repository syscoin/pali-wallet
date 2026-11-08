import type { IBlacklistCheckResult } from '../types/security.ts';

export type DappAddressAdvisory = Readonly<{
  address: string;
  field: string;
  reason?: string;
  severity: IBlacklistCheckResult['severity'];
}>;

export type DappMessageAdvisories = Readonly<{
  addresses: readonly DappAddressAdvisory[];
  warning?: DappAddressAdvisory;
}>;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Report the first serious warning immediately, even if a later lookup fails. */
export async function reviewDappMessageAdvisories({
  method,
  typedData,
  checkAddress,
  assertCurrent,
  onWarning,
}: {
  assertCurrent: () => void;
  checkAddress: (address: string) => Promise<IBlacklistCheckResult>;
  method: string;
  onWarning: (warning: DappAddressAdvisory) => void;
  typedData: unknown;
}): Promise<DappMessageAdvisories> {
  assertCurrent();
  if (method !== 'eth_signTypedData_v3' && method !== 'eth_signTypedData_v4')
    return { addresses: [] };
  const data = typedData as any;
  const message = data?.message;
  if (!message) return { addresses: [] };

  const targets: Array<{ address: string; field: string }> = [];
  const add = (field: string, address: unknown, excludeZero = false) => {
    if (
      typeof address === 'string' &&
      address.startsWith('0x') &&
      (!excludeZero || address !== ZERO_ADDRESS)
    )
      targets.push({ address, field });
  };

  if (data.primaryType === 'Permit' && message.spender)
    targets.push({ address: message.spender, field: 'spender' });

  if (data.primaryType === 'ERC721Order') {
    add('maker', message.maker);
    add('taker', message.taker, true);
    if (Array.isArray(message.fees)) {
      message.fees.forEach((fee: any, index: number) =>
        add(`fees[${index}].recipient`, fee?.recipient)
      );
    }
  }

  if (data.primaryType === 'OrderComponents') {
    add('offerer', message.offerer);
    add('zone', message.zone, true);
    if (Array.isArray(message.consideration)) {
      message.consideration.forEach((item: any, index: number) =>
        add(`consideration[${index}].recipient`, item?.recipient)
      );
    }
  }

  for (const field of ['to', 'recipient', 'operator', 'approved', 'delegate'])
    add(field, message[field]);

  return reviewDappAddressAdvisories({
    targets,
    checkAddress,
    assertCurrent,
    onWarning,
  });
}

export async function reviewDappAddressAdvisories({
  targets,
  checkAddress,
  assertCurrent,
  onWarning,
}: {
  assertCurrent: () => void;
  checkAddress: (address: string) => Promise<IBlacklistCheckResult>;
  onWarning: (warning: DappAddressAdvisory) => void;
  targets: readonly Readonly<{ address: string; field: string }>[];
}): Promise<DappMessageAdvisories> {
  assertCurrent();
  const addresses: DappAddressAdvisory[] = [];
  let warning: DappAddressAdvisory | undefined;
  for (const target of targets) {
    assertCurrent();
    const result = await checkAddress(target.address);
    assertCurrent();
    if (result.isBlacklisted) {
      const advisory = {
        ...target,
        reason: result.reason,
        severity: result.severity,
      };
      addresses.push(advisory);
      if (
        !warning &&
        (advisory.severity === 'high' || advisory.severity === 'critical')
      ) {
        warning = advisory;
        assertCurrent();
        onWarning(warning);
      }
    }
  }
  assertCurrent();
  return {
    addresses,
    warning,
  };
}
