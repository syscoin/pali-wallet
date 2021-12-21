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
      className={`${options.type === 'error' ? 'bg-brand-navydarker border-brand-error' : 'bg-brand-navydark border-brand-royalBlue'} p-3 mb-20 w-72 text-center rounded-lg border flex justify-between text-brand-white text-sm`}
      onClick={close}
    >
      {options.type === 'error' && (
        <Icon
          name="close-circle"
          className="w-4 text-brand-white"
        />
      )}

      {message}
    </div>
  );
};
