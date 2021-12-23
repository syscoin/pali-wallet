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
      className={`${options.type === 'error' ? 'bg-brand-royalBlue border-brand-royalBlue' : 'bg-brand-navydark border-brand-royalBlue'} py-3 px-6 mb-16 w-full text-center rounded-lg border flex justify-between items-center text-brand-white gap-x-2 text-sm`}
      onClick={close}
    >
      {options.type === 'error' && (
        <Icon
          name="close-circle"
          className="w-2 mb-1 text-brand-white"
        />
      )}

      <p>
        {message}
      </p>
    </div>
  );
};
