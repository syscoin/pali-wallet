import * as React from 'react';
import { FC } from 'react';
import { useController } from 'hooks/index';
import { useSelector } from 'react-redux';
import IWalletState from 'state/wallet/types';
import { RootState } from 'state/store';
import { useHistory } from 'react-router-dom';
import Icon from 'components/Icon';

interface IAccountView {
  id: number;
}

const AccountView: FC<IAccountView> = ({ id }) => {
  const controller = useController();
  const history = useHistory();
  const { accounts }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );
  const sysExplorer = controller.wallet.account.getSysExplorerSearch();
  const handleOpenExplorer = () => {
    window.open(`${sysExplorer}/xpub/${accounts[id].xpub}`);
  };

  return (
    <div>
      {/* <section>
            {accounts.length > 1 ? (
              <FullSelect
                value={String(activeAccountId)}
                options={accounts}
                onChange={(val: string) => {
                  controller.wallet.switchWallet(Number(val));
                  controller.wallet.account.watchMemPool(accounts[Number(val)]);
                }}
              />
            ) : (
              accounts.find((element) => element.id === activeAccountId)?.label
            )}
          </section> */}
      <ul>
        <li onClick={() => history.push('/account-priv')}>
          <Icon name="export" className="w-4 bg-brand-green" />
          Export account keys
        </li>
        <li onClick={handleOpenExplorer}>
          <Icon name="link" className="w-4 bg-brand-green" />
          View on explorer
        </li>
      </ul>
    </div>
  );
};

export default AccountView;
