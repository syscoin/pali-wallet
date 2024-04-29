import { toSvg } from 'jdenticon';
import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { RootState } from 'state/store';
import { ellipsis } from 'utils/format';

export const FaucetComponentStates = () => {
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const { accounts } = useSelector((state: RootState) => state.vault);

  const [account] = useState({
    img: accounts[activeAccount.type][activeAccount.id]?.xpub,
    label: accounts[activeAccount.type][activeAccount.id]?.label,
    address: ellipsis(
      accounts[activeAccount.type][activeAccount.id]?.address,
      4,
      4
    ),
  });

  return { account };
};
