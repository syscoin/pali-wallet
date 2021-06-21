import React, { FC } from "react";
import { browser } from 'webextension-polyfill-ts';

import styles from './Modal.scss';

import { useSelector } from 'react-redux';
import { RootState } from 'state/store';
import { getHost } from '../../scripts/Background/helpers';
import { ellipsis, formatURL } from '../../containers/auth/helpers';
import IWalletState from 'state/wallet/types';
import trash from 'assets/images/svg/trash.svg';

interface IModal {
  title: any,
  message?: any,
  connected?: boolean,
  callback?: any
}

const Modal: FC<IModal> = ({
  title,
  message,
  connected,
  callback
}) => {
  const { accounts }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );

  const handleDisconnect = (id: number) => {
    browser.runtime.sendMessage({
      type: 'RESET_CONNECTION_INFO',
      target: 'background',
      id,
      url: title
    });
  }

  const connectedAccounts = accounts.filter(account => {
    return account.connectedTo.find((url: any) => url == getHost(title));
  });

  return (
    <div className={styles.modal}>
      <div className={styles.title}>
        <small>{formatURL(title)}</small>

        {connected && (
          <small>You have {connectedAccounts.length} account connected to this site</small>
        )}
      </div>

      <p>{message}</p>

      {!connected && (
        <div className={styles.close}>
          <button
            onClick={() => callback()}
          >
            Close
          </button>
        </div>
      )}

      {connected && (
        <div>
          {connectedAccounts.map((item, index) => {
            return (
              <div className={styles.account} key={index}>
                <div className={styles.data}>
                  <p>{item.label}</p>
                  <small>{ellipsis(item.address.main)}</small>
                </div>
                <img
                  src={trash}
                  alt="Remove account"
                  onClick={() => handleDisconnect(item.id)}
                />
              </div>
            )
          })}

          <div className={styles.permissions}>
            <p>Permissions</p>

            <div>
              <input disabled type="checkbox" name="permission" id="permission" checked />
              <small>View the adresses of your permitted accounts.</small>
            </div>
          </div>

          <div className={styles.close}>
            <button
              onClick={() => callback()}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Modal;
