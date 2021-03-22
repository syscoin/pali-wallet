import React, { ChangeEvent } from 'react';
import { useSelector } from 'react-redux';
import NetworkIcon from '@material-ui/icons/Timeline';
import ListIcon from '@material-ui/icons/ListAltRounded';
import InfoIcon from '@material-ui/icons/InfoRounded';
import DeleteIcon from '@material-ui/icons/Delete';

import Select from 'components/Select';
import Icon from 'components/Icon';
import { useController, useSettingsView } from 'hooks/index';
import { ABOUT_VIEW, DELETE_WALLET_VIEW, PHRASE_VIEW } from '../routes';
import { DAG_NETWORK } from 'constants/index';
import { RootState } from 'state/store';

import styles from './index.scss';

const GeneralView = () => {
  const controller = useController();
  const showView = useSettingsView();
  const network = useSelector(
    (state: RootState) => state.wallet!.activeNetwork
  );

  const handleChangeNetwork = (
    ev: ChangeEvent<{
      name?: string | undefined;
      value: unknown;
    }>
  ) => {
    controller.wallet.switchNetwork(ev.target.value as string);
  };

  return (
    <div className={styles.general}>
      <ul>
        <li className={styles.network}>
          <Icon Component={NetworkIcon} variant={styles.icon} />
          <span>
            Network
            <Select
              value={network || DAG_NETWORK.main.id}
              fullWidth
              onChange={handleChangeNetwork}
              options={[
                { [DAG_NETWORK.main.id]: DAG_NETWORK.main.label },
                { [DAG_NETWORK.ceres.id]: DAG_NETWORK.ceres.label },
              ]}
            />
          </span>
        </li>
        <li onClick={() => showView(PHRASE_VIEW)}>
          <Icon Component={ListIcon} />
          Wallet seed phrase
        </li>
        <li onClick={() => showView(ABOUT_VIEW)}>
          <Icon Component={InfoIcon} />
          About
        </li>
        <li onClick={() => showView(DELETE_WALLET_VIEW)}>
          <Icon Component={DeleteIcon} />
          Delete wallet
        </li>
      </ul>
    </div>
  );
};

export default GeneralView;
