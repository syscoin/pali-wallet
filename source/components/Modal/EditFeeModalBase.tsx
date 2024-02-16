import { Dialog, Transition } from '@headlessui/react';
import React, { Fragment, ReactNode } from 'react';

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
  <Transition appear show={show} as={Fragment}>
    <Dialog
      as="div"
      className={`fixed z-[9999] inset-0 overflow-y-auto ${className}`}
      onClose={() => {
        if (onClose) onClose();
      }}
    >
      <div className="fixed z-0 -inset-0 w-full bg-brand-black bg-opacity-50 transition-all duration-300 ease-in-out" />

      <div className="min-h-screen text-center">
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <Dialog.Overlay className="fixed inset-0" />
        </Transition.Child>

        <span className="inline-block align-middle h-screen" aria-hidden="true">
          &#8203;
        </span>

        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0 scale-95"
          enterTo="opacity-100 scale-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100 scale-100"
          leaveTo="opacity-0 scale-95"
        >
          {children}
        </Transition.Child>
      </div>
    </Dialog>
  </Transition>
);
