import React from 'react';

import { Icon } from '../Icon';

interface IToastAlert {
  close: () => void;
  message: string;
  options: { type: string };
}

export const ToastAlert: React.FC<IToastAlert> = ({
  close,
  message,
  options,
}) => {
  const isSuccess = options.type === 'success';

  return (
    <div
      className="flex gap-x-2 items-center justify-center mb-16 w-72 h-20 text-center text-brand-white bg-bkg-4 border border-transparent rounded-lg"
      onClick={close}
    >
      <div
        className={`${
          isSuccess
            ? 'bg-warning-success border border-warning-success'
            : 'bg-warning-error border border-warning-error'
        } rounded-l-lg h-full flex justify-center items-center w-1/4`}
        id="modal-alert"
      >
        {isSuccess && (
          <Icon
            name="check"
            className="mb-1 text-brand-white bg-brand-white rounded-full"
            size={24}
          />
        )}
      </div>

      <div className="w-full text-left">
        <p className="text-sm font-bold">{isSuccess ? 'Success' : 'Error'}</p>
        <p className="my-2 text-xs">{message}</p>
      </div>
    </div>
  );
};
