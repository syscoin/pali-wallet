import React, { FC } from 'react';
import { Icon } from "../Icon";

interface IAlertTemplate {
  close: () => void;
  message: any;
  options: any;
}

export const ToastAlert: FC<IAlertTemplate> = ({ message, options, close }) => {
  return (
    <div
      className="mb-20 w-72 text-center"
      onClick={close}
    >
      {options.type === 'error' && <Icon name="close-circle" className="w-4 bg-brand-gray200 text-brand-navy" />}
      {message}
    </div>
  );
};
