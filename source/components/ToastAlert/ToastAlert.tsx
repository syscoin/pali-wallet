import React, { FC } from 'react';

import { Icon } from '../Icon';

interface IAlertTemplate {
  close: () => void;
  message: any;
  options: any;
}

export const ToastAlert: FC<IAlertTemplate> = ({ message, options, close }) => {
  const otherClasses =
    options.type === 'error'
      ? 'bg-warning-error border border-warning-error'
      : '';

  return (
    <>
      <div
        className="flex gap-x-2 items-center justify-center mb-16 w-72 h-20 text-center text-brand-white bg-bkg-4 border border-transparent rounded-lg"
        onClick={close}
      >
        <div
          className={`${
            options.type === 'success'
              ? 'bg-warning-success border border-warning-success'
              : otherClasses
          } rounded-l-lg h-full flex justify-center items-center w-1/4`}
        >
          {options.type === 'success' && (
            <Icon
              name={options.type === 'success' ? 'check' : 'close-circle'}
              className="mb-1 text-brand-white bg-brand-white rounded-full"
              size={24}
            />
          )}
        </div>

        <div className="w-full text-left">
          <p className="text-sm font-bold">
            {options.type === 'success' ? 'Success' : 'Error'}
          </p>

          <p className="my-2 text-xs">{message}</p>
        </div>
      </div>
    </>
  );
};
