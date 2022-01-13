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
        className="bg-bkg-4 border-transparent rounded-lg mb-16 w-72 text-center border h-20 flex justify-center gap-x-2 items-center text-brand-white"
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
              className="mb-1 bg-brand-white text-brand-white rounded-full"
              size={24}
            />
          )}
        </div>

        <div className="text-left w-full">
          <p className="text-sm font-bold">
            {options.type === 'success' ? 'Success' : 'Error'}
          </p>

          <p className="text-xs my-2">{message}</p>
        </div>
      </div>
    </>
  );
};
