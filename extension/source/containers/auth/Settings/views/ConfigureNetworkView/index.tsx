import React, { useState, useEffect } from 'react';
import clsx from 'clsx';
import { useForm } from 'react-hook-form';
import * as yup from 'yup';
import TextInput from 'components/TextInput';
import Button from 'components/Button';
import { useController, useCopyClipboard, useSettingsView } from 'hooks/index';
import { ellipsis } from 'containers/auth/helpers';
import Spinner from '@material-ui/core/CircularProgress';

import { MAIN_VIEW } from '../routes';

import styles from './index.scss';
import { SYS_NETWORK } from 'constants/index';

const ConfigureNetworkView = () => {
  const controller = useController();
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(false);

  const { handleSubmit, register } = useForm({
    validationSchema: yup.object().shape({
      name: yup.string().required(),
      blockbookURL: yup.string().required(),
    }),
  });

  const onSubmit = async (data: any) => {
    setLoading(true);
    console.log('data on submit network', data, data.name, data.blockbookURL)
    setSelected('');
  };

  return (
    <div>
      {selected ? (
        <form onSubmit={handleSubmit(onSubmit)} className={styles.configureNetworkWrapper}>
          <div className={styles.column}>
            <TextInput
              type="text"
              name="name"
              defaultValue={SYS_NETWORK[selected].label}
              fullWidth
              variant={styles.input}
              placeholder="Network name"
              inputRef={register}
            />

            <TextInput
              type="text"
              name="blockbookURL"
              defaultValue={SYS_NETWORK[selected].beUrl}
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
        <div className={styles.configureNetworkWrapper}>
          <ul className={styles.networksList}>
            {Object.values(SYS_NETWORK).map((network: any) => {
              return (
                <li
                  key={network.id}
                  className={styles.networkItem}
                  onClick={() => {
                    setSelected(network.id);
                  }}
                >
                  <span>
                    {network.label}
                  </span>

                  <small>
                    Blockbook URL:
                    <span> {network.beUrl}</span>
                  </small>
                </li>
              )
            })}
          </ul>

          <Button
            type="button"
            theme="btn-gradient-primary"
            variant={styles.button}
          >
            Configure new network
          </Button>
        </div>
      )}
    </div>
  );
};

export default ConfigureNetworkView;
