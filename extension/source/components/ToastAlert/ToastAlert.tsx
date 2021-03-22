import React, { FC } from 'react';
import clsx from 'clsx';
// import InfoIcon from '@material-ui/icons/InfoOutlined';
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
      })}
      style={{
        ...style,
        marginBottom: '80px',
        width: '300px',
        textAlign: 'center',
      }}
      onClick={close}
    >
      {/* {options.type === 'info' && <InfoIcon style={{ fontSize: '15px' }} />} */}
      {/* {options.type === 'success' && <SuccessIcon />} */}
      {options.type === 'error' && <CancelIcon className={styles.icon} />}
      {message}
    </div>
  );
};

export default ToastAlert;
