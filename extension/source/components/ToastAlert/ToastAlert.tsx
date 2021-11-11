import React, { FC } from 'react';
import Icon from "components/Icon";

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
      {options.type === 'error' && <Icon name="close-circle" className="w-4 bg-brand-gray200 text-brand-navy" />}
      {message}
    </div>
  );
};

export default ToastAlert;
