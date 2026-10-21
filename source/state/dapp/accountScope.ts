import { ISlip44State } from 'state/vault/types';
import { INetworkType } from 'types/network';

import { IDApp } from './types';

export const resolveDappAccount = (
  grant: IDApp | undefined,
  accounts: ISlip44State['accounts'],
  network: ISlip44State['activeNetwork']
) => {
  if (!grant || grant.chain !== network.kind) return undefined;
  const account = accounts[grant.accountType]?.[grant.accountId];
  const scope = grant.utxoAccount;
  // Older unbound UTXO grants need consent again; never infer their identity
  // from the currently loaded vault. Receive-address rotation is allowed.
  return network.kind !== INetworkType.Syscoin ||
    (scope &&
      Number.isSafeInteger(scope.slip44) &&
      scope.slip44 === (network.slip44 ?? 57) &&
      typeof scope.xpub === 'string' &&
      scope.xpub.length > 0 &&
      scope.xpub === account?.xpub)
    ? account
    : undefined;
};
