import { Dialog } from '@headlessui/react';
import React, { ReactNode } from 'react';

interface IModal {
  children: ReactNode;
  className?: string;
  onClose?: () => any;
  show?: boolean;
}

export const EditFeeModalBase = ({
  children,
  className = '',
  onClose,
  show = true,
}: IModal) => (
  <Dialog
    as="div"
    className={`fixed z-[100] inset-0 ${className} ${
      show ? 'visible' : 'invisible'
    }`}
    open={show}
    onClose={() => {
      if (onClose) onClose();
    }}
  >
    <div
      className={`fixed z-[99] inset-0 w-full bg-brand-black bg-opacity-50 transition-all duration-300 ease-in-out ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
    />

    <div className="fixed inset-0 z-[100] flex items-start justify-center p-2 overflow-y-auto">
      <Dialog.Overlay className="fixed inset-0" />

      <div
        className={`transition-all duration-300 ease-in-out transform ${
          show ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
        }`}
      >
        {children}
      </div>
    </div>
  </Dialog>
);
