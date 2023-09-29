import React from 'react';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
  return (
    <div
      className={`${
        isSuccess ? 'bg-alert-lightsuccess' : 'bg-alert-lighterror'
      } flex gap-x-2 items-center justify-center mb-16 w-72 h-20 text-center text-brand-white border border-transparent rounded-lg`}
      onClick={close}
    >
      <div
        className={`${
          isSuccess
            ? 'bg-alert-darksuccess border border-warning-success'
            : 'bg-alert-darkerror border border-warning-error'
        } rounded-l-lg h-full flex justify-center items-center w-1/4`}
        id="modal-alert"
      >
        <Icon
          name={isSuccess ? 'check' : 'close-circle'}
          className="mb-1 text-brand-white bg-brand-white rounded-full"
          size={24}
        />
      </div>

      <div className="w-full text-left">
        <p className="text-sm font-bold">
          {isSuccess ? t('buttons.success') : t('buttons.error')}
        </p>
        <p className="my-2 text-xs">{message}</p>
      </div>
    </div>
  );
};
