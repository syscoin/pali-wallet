import React, { FC } from 'react';
import CancelIcon from '@material-ui/icons/Cancel';

interface IAlertTemplate {
  close: () => void;
  message: any;
  options: any;
  style: any;
}

const ToastAlert: FC<IAlertTemplate> = ({ message, options, style, close }) => {
  return (
    <div
      style={{
        ...style,
        marginBottom: '80px',
        width: '300px',
        textAlign: 'center',
      }}
      onClick={close}
    >
      {options.type === 'error' && <CancelIcon />}
      {message}
    </div>
  );
};

export default ToastAlert;
