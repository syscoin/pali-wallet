import React, { useState } from 'react';
import clsx from 'clsx';
import { useForm } from 'react-hook-form';
import * as yup from 'yup';
import TextInput from 'components/TextInput';
import Button from 'components/Button';
import { useController } from 'hooks/index';
import { formatURL } from 'containers/auth/helpers';
import Spinner from '@material-ui/core/CircularProgress';

import styles from './index.scss';
import IWalletState from 'state/wallet/types';
import { useSelector } from 'react-redux';
import { RootState } from 'state/store';
import axios from 'axios';
import { useAlert } from 'react-alert';

const ConfigureNetworkView = () => {
  const controller = useController();
  const alert = useAlert();
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

  const onSubmit = async ({ name, blockbookURL }: any) => {
    setLoading(true);

    try {
      const response = await axios.get(`${blockbookURL}/api/v2`);
      const { coin } = response.data.blockbook;

      if (response && coin) {
        if (coin === 'Syscoin' || coin === 'Syscoin Testnet') {
          controller.wallet.account.updateNetworkData({ id: selected ? selected : name.toString().toLowerCase(), label: name, beUrl: blockbookURL });

          setLoading(false);
          setSelected('');
          setCustomNetwork(false);

          return;
        }

        throw new Error('Invalid blockbook URL.');
      }
    } catch (error) {
      alert.removeAll();
      alert.error('Invalid blockbook URL.', { timeout: 2000 });

      setLoading(false);
    }
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
              <form onSubmit={handleSubmit(onSubmit)} className={styles.configureNetworkWrapper}>
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
                    disabled={loading}
                  >
                    {loading ? (
                      <Spinner size={18} />
                    ) : 'Save'}
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
                disabled={loading}
              >
                {loading ? (
                  <Spinner size={18} />
                ) : 'Custom network'}
              </Button>
            </div>
          )}
        </div>

      )}
    </div>
  );
};

export default ConfigureNetworkView;
