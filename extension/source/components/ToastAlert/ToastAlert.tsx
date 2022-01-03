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
      className={`${options.type === 'error' ? 'bg-brand-navylight border-transparent pr-3 rounded-lg mb-16 w-72 text-center border flex justify-between items-center text-brand-white' : ''}`}
      onClick={close}
    >
      <div className="bg-brand-error border border-brand-error rounded-l-lg py-8 px-3">
        {options.type === 'error' && (
          <Icon
            name="close-circle"
            className="mb-1 bg-brand-white text-brand-white rounded-full"
            size={24}
          />
        )}
      </div>

      <div className="my-2 ml-2 text-left">
        <p className="text-sm font-bold">
          Error
        </p>

        <p className="text-xs my-2">
          {message}
        </p>
      </div>
    </div>
  );
};
