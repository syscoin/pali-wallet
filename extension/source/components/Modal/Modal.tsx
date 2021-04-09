import React, { FC } from "react";
import { browser } from 'webextension-polyfill-ts';

import styles from './Modal.scss';

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
  const handleDisconnect = () => {
    browser.runtime.sendMessage({ type: 'RESET_CONNECTION_INFO' });
  }

  return (
    <div className={styles.modal}>
      <div className={styles.title}>
        <small>{title}</small>

        {connected && (
          <small>You have 1 account connected to this site</small>
        )}
      </div>

      {message}

      {connected && (
        <div>
          <div className={styles.account}>
            <small>Account 1</small>
            <small title="Disconnect account" onClick={handleDisconnect}>X</small>
          </div>

          <div className={styles.permissions}>
            <p>Permissions</p>

            <div>
              <input disabled type="checkbox" name="permission" id="permission" checked/>
              <small>View the adresses of your permitted accounts.</small>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Modal;