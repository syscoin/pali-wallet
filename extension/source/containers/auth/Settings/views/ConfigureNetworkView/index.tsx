import React, { useState, useEffect } from 'react';
import clsx from 'clsx';
import { useForm } from 'react-hook-form';
import * as yup from 'yup';
import TextInput from 'components/TextInput';
import Button from 'components/Button';
import { useController, useCopyClipboard, useSettingsView } from 'hooks/index';
import { ellipsis, formatURL } from 'containers/auth/helpers';
import Spinner from '@material-ui/core/CircularProgress';

import { MAIN_VIEW } from '../routes';

import styles from './index.scss';
import { SYS_NETWORK } from 'constants/index';
import IWalletState from 'state/wallet/types';
import { useSelector } from 'react-redux';
import { RootState } from 'state/store';

const ConfigureNetworkView = () => {
  const controller = useController();
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(false);
  const [customNetwork, setCustomNetwork] = useState(false);

  const { handleSubmit, register } = useForm({
    validationSchema: yup.object().shape({
      name: yup.string().required(),
      blockbookURL: yup.string().required(),
    }),
  });

  const { networks }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );

  const onSubmit = async ({ name, blockbookURL}: any) => {
    setLoading(true);

    controller.wallet.account.updateNetworkData({ id: selected, label: name, beUrl: blockbookURL });

    setSelected('');
  };

  const submitCustomNetwork = async ({ name, blockbookURL}: any) => {
    setLoading(true);
    console.log('data on submit custom network', name, blockbookURL)
    controller.wallet.account.updateNetworkData({ id: name.toString().toLowerCase(), label: name, beUrl: blockbookURL });

    setCustomNetwork(false);
  };

  const defaultNetworks = ['main', 'testnet'];

  return (
    <div>
      {selected ? (
        <form onSubmit={handleSubmit(onSubmit)} className={styles.configureNetworkWrapper}>
          <div className={styles.column}>
            <TextInput
              type="text"
              name="name"
              defaultValue={networks[selected].label}
              fullWidth
              variant={styles.input}
              placeholder="Network name"
              inputRef={register}
            />

            <TextInput
              type="text"
              name="blockbookURL"
              defaultValue={networks[selected].beUrl}
              fullWidth
              variant={styles.input}
              placeholder="Blockbook URL"
              inputRef={register}
            />
          </div>

          <div className={styles.actions}>
            <Button
              type="button"
              theme="btn-outline-secondary"
              variant={clsx(styles.button, styles.close)}
              onClick={() => setSelected('')}
            >
              Close
            </Button>

            <Button
              type="submit"
              theme="btn-outline-primary"
              variant={styles.button}
            >
              Confirm
            </Button>
          </div>
        </form>
      ) : (
        <div>
          {customNetwork ? (
            <div>
              <form onSubmit={handleSubmit(submitCustomNetwork)} className={styles.configureNetworkWrapper}>
                <div className={styles.column}>
                  <TextInput
                    type="text"
                    name="name"
                    fullWidth
                    variant={styles.input}
                    placeholder="Network name"
                    inputRef={register}
                  />

                  <TextInput
                    type="text"
                    name="blockbookURL"
                    fullWidth
                    variant={styles.input}
                    placeholder="Blockbook URL"
                    inputRef={register}
                  />
                </div>

                <div className={styles.actions}>
                  <Button
                    type="button"
                    theme="btn-outline-secondary"
                    variant={clsx(styles.button, styles.close)}
                    onClick={() => setCustomNetwork(false)}
                  >
                    Close
                  </Button>

                  <Button
                    type="submit"
                    theme="btn-outline-primary"
                    variant={styles.button}
                  >
                    Save
                  </Button>
                </div>
              </form>
            </div>
          ) : (
            <div className={styles.configureNetworkWrapper}>
              <ul className={styles.networksList}>
                {Object.values(networks).map((network: any) => {
                  return (
                    <li
                      key={network.id}
                      className={defaultNetworks.includes(network.id) ? styles.defaultNetworkItem : styles.networkItem}
                      onClick={() => {
                        !defaultNetworks.includes(network.id) && setSelected(network.id);
                      }}
                    >
                      <span>
                        {formatURL(network.label, 25)}
                      </span>

                      <small>
                        Blockbook URL:
                        <span> {formatURL(String(network.beUrl), 25)}</span>
                      </small>
                    </li>
                  )
                })}
              </ul>

              <Button
                type="button"
                theme="btn-gradient-primary"
                variant={styles.button}
                onClick={() => setCustomNetwork(true)}
              >
                Custom network
              </Button>
            </div>
          )}
        </div>

      )}
    </div>
  );
};

export default ConfigureNetworkView;
