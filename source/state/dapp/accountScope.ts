import { matchesDappAccountReference } from '../../shared/dappTypes';
import { ISlip44State } from 'state/vault/types';
import { canPublishAccountAddress } from 'utils/smartAccount/addressIdentity';

import { IDApp } from './types';

export const resolveDappAccount = (
  grant: IDApp | undefined,
  accounts: ISlip44State['accounts'],
  network: ISlip44State['activeNetwork']
) => {
  if (!grant || grant.chain !== network.kind) return undefined;
  const account = accounts[grant.accountType]?.[grant.accountId];
  if (!canPublishAccountAddress(account, grant.accountType, network.chainId))
    return undefined;
  return matchesDappAccountReference(grant, account, network)
    ? account
    : undefined;
};
