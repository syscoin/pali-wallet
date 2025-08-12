import { Dialog } from '@headlessui/react';
import React, { useCallback, useMemo } from 'react';

import { WhiteSuccessIconSvg, ErrorIconSvg, WarnIconSvg } from '../Icon/Icon';

interface IModal {
  description?: string;
  onClose?: () => any;
  position?: string;
  show?: boolean;
  status: string;
  title: string;
}

export const StatusModal = ({
  description,
  onClose,
  show = true,
  title,
  position = 'inset-0',
  status = '',
}: IModal) => {
  const theme = useMemo(() => {
    const themes = {
      error: {
        iconComponent: ErrorIconSvg,
        iconBg: 'bg-brand-redDark',
        bg: 'bg-brand-red',
      },
      success: {
        iconComponent: WhiteSuccessIconSvg,
        iconBg: 'bg-brand-darkGreen',
        bg: 'bg-brand-green',
      },
      warn: {
        iconComponent: WarnIconSvg,
        iconBg: 'bg-brand-yellowInfoDark',
        bg: 'bg-brand-yellowInfo',
      },
    };

    return themes[status] || {};
  }, [status]);

  const handleOnClose = useCallback(() => {
    if (onClose) onClose();
  }, []);

  return (
    <Dialog
      as="div"
      className={`fixed z-[60] ${position} overflow-y-auto  rounded-[20px]`}
      open={Boolean(show)}
      onClose={handleOnClose}
    >
      <div className="fixed z-0 -inset-0 w-full bg-transparent bg-opacity-50" />

      <div className="min-h-screen  text-center flex flex-col align-bottom justify-end items-center rounded-t-[50px]">
        <Dialog.Overlay className="fixed inset-0" />

        <div
          className={`rounded-[20px] mb-12 flex flex-row align-bottom justify-end ${
            theme.iconBg
          } items-center shadow-md transition-transform duration-200 ${
            show ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
          }`}
        >
          <div className={`${theme.iconBg} p-4  h-full`}>
            <theme.iconComponent className="w-[24px] h-[24px]" />
          </div>
          <div
            className={`flex flex-col w-[264px] rounded-r-[20px] p-4 ${theme.bg}`}
          >
            <div className="flex flex-row w-full justify-between">
              <p className="text-white text-base font-medium ">{title}</p>
              <img
                src="../../assets/all_assets/close.svg"
                className="w-[15px] h-[15px] hover:cursor-pointer"
                onClick={handleOnClose}
              />
            </div>
            <p className="text-white text-left text-sm font-normal">
              {description}
            </p>
          </div>
        </div>
      </div>
    </Dialog>
  );
};
