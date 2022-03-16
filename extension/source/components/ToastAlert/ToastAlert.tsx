import React, { FC } from 'react';
import clsx from 'clsx';
import CancelIcon from '@material-ui/icons/Cancel';

import styles from './ToastAlert.scss';

interface IAlertTemplate {
  close: () => void;
  message: any;
  options: any;
  style: any;
}

const ToastAlert: FC<IAlertTemplate> = ({ message, options, style, close }) => {
  return (
    <div
      className={clsx(styles.toast, {
        [styles.error]: options.type === 'error',
        [styles.show]: options.type === 'success',
      })}
      style={{
        ...style,
        marginBottom: '80px',
        width: '300px',
        textAlign: 'center',
      }}
      onClick={close}
    >
      {options.type === 'error' && <CancelIcon className={styles.icon} />}
      {message}
    </div>
  );
};

export default ToastAlert;
