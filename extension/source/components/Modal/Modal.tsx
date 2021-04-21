import React, { FC } from "react";
import { browser } from 'webextension-polyfill-ts';

import styles from './Modal.scss';

import { useSelector } from 'react-redux';
import { RootState } from 'state/store';
import IWalletState from 'state/wallet/types';

interface IModal {
  title: any,
  message?: any,
  connected?: boolean,
}

const Modal: FC<IModal> = ({
  title,
  message,
  connected,
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
    return account.connectedTo.find((url: any) => url == title);
  });

  return (
    <div className={styles.modal}>
      <div className={styles.title}>
        <small>{title}</small>

        {connected && (
          <small>You have {connectedAccounts.length} account connected to this site</small>
        )}
      </div>

      {message}

      {connected && (
        <div>
          {connectedAccounts.map((item, index) => {
            return (
              <div className={styles.account} key={index}>
                <small>{item.label}</small>
                <small title="Disconnect account" onClick={ () => handleDisconnect(item.id) }>X</small>
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
        </div>
      )}
    </div>
  );
};

export default Modal;