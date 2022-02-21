import { Dialog, Transition } from '@headlessui/react';
import { useUtils } from 'hooks/useUtils';
import React, { FC, Fragment } from 'react';

type IModal = {
  children?: any;
  closeMessage?: string;
  closePopup?: any;
  connectedAccount?: any;
  description?: string;
  doNothing?: boolean;
  log?: any;
  onClose: any;
  open: boolean;
  title?: string;
  type: string;
};

type DefaltModalType = {
  background?: string;
  closeMessage?: string;
  closePopup?: any;
  description?: string;
  doNothing?: boolean;
  goTo?: string;
  onClose: any;
  open: boolean;
  textColor?: string;
  title?: string;
};

type ErrorModalType = {
  background?: string;
  closeMessage?: string;
  closePopup?: any;
  description?: string;
  doNothing?: boolean;
  goTo?: string;
  log?: string;
  onClose: any;
  open: boolean;
  textColor?: string;
  title?: string;
};

const DefaultModal = ({
  onClose,
  open,
  goTo = '/home',
  background = 'bg-bkg-4',
  textColor = 'text-white',
  title = '',
  description = '',
  closeMessage = 'Ok',
  doNothing = false,
  closePopup,
}: DefaltModalType) => {
  const { navigate } = useUtils();

  const chooseAction = goTo && !doNothing ? () => navigate(goTo) : onClose;

  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog
        as="div"
        className="fixed z-10 inset-0 overflow-y-auto"
        onClose={onClose}
      >
        <div
          onClick={goTo && doNothing ? () => null : chooseAction}
          className="fixed z-0 -inset-0 w-full bg-brand-black bg-opacity-50 transition-all duration-300 ease-in-out"
        />

        <div className="px-4 min-h-screen text-center">
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

          <span
            className="inline-block align-middle h-screen"
            aria-hidden="true"
          >
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
            <div
              className={`font-poppins inline-block w-full max-w-2xl p-6 my-8 overflow-hidden text-center align-middle transition-all transform ${background} shadow-xl rounded-2xl`}
            >
              <Dialog.Title
                as="h3"
                className="pb-4 pt-2 text-brand-white text-lg font-medium leading-6 border-b border-dashed border-gray-600"
              >
                {title}
              </Dialog.Title>

              <div className="mt-2">
                <p className={`text-sm ${textColor}`}>{description}</p>
              </div>

              <div className="mt-4">
                <button
                  type="button"
                  className="inline-flex justify-center px-10 py-2 hover:text-brand-royalblue text-brand-white text-sm font-medium hover:bg-button-popuphover bg-transparent border border-brand-white rounded-full focus:outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-brand-royalblue focus-visible:ring-offset-2"
                  onClick={
                    goTo ? closePopup || (() => navigate(goTo)) : onClose
                  }
                  id="got-it-btn"
                >
                  {closeMessage}
                </button>
              </div>
            </div>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
};

const ErrorModal = ({
  onClose,
  open,
  goTo = '/home',
  background = 'bg-bkg-3',
  textColor = 'text-gray-300',
  title = '',
  description = '',
  closeMessage = 'Ok',
  doNothing = false,
  log = '',
}: ErrorModalType) => {
  const { navigate } = useUtils();

  const chooseAction = goTo && !doNothing ? () => navigate(goTo) : onClose;

  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog
        as="div"
        className="fixed z-10 inset-0 max-w-2xl overflow-y-auto"
        onClose={onClose}
      >
        <div
          onClick={goTo && doNothing ? () => null : chooseAction}
          className="fixed z-0 -inset-0 w-full bg-brand-black bg-opacity-50 transition-all duration-300 ease-in-out"
        />

        <div className="px-4 min-h-screen text-center">
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

          <span
            className="inline-block align-middle h-screen"
            aria-hidden="true"
          >
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
            <div
              className={`font-poppins inline-block w-full max-w-2xl p-6 my-8 overflow-hidden text-center align-middle transition-all border border-red-500 transform ${background} shadow-xl rounded-2xl`}
            >
              <Dialog.Title
                as="h3"
                className="text-brand-white text-lg font-medium leading-6"
              >
                {title}
              </Dialog.Title>
              <div className="mt-4">
                <p className={`text-sm ${textColor}`}>{description}</p>
              </div>

              <p className="my-4 text-red-500 text-sm">
                Error description:
                {log}
              </p>

              <div className="flex items-center justify-between mt-8">
                <button
                  type="button"
                  className="inline-flex justify-center px-12 py-2 text-red-500 text-sm font-medium bg-blue-100 border border-red-500 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-royalblue focus-visible:ring-offset-2"
                  onClick={onClose}
                >
                  {closeMessage}
                </button>

                <button
                  type="button"
                  className="inline-flex justify-center px-12 py-2 text-brand-white text-sm font-medium bg-red-500 hover:bg-opacity-70 border border-transparent rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-royalblue focus-visible:ring-offset-2"
                  onClick={() =>
                    window.open(
                      `mailto:amanda.gonsalves@pollum.io?subject="Pali Error Report: Token creation"&body=${log}`
                    )
                  }
                >
                  Report
                </button>
              </div>
            </div>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
};

export const Modal: FC<IModal> = ({
  onClose,
  open,
  type = '',
  description,
  title,
  doNothing,
  log,
  closePopup,
  children,
}) => (
  <>
    {type === 'default' && (
      <DefaultModal
        closePopup={closePopup}
        onClose={onClose}
        open={open}
        closeMessage="Got it"
        title={title}
        description={description}
        doNothing={doNothing}
      />
    )}

    {type === 'error' && (
      <ErrorModal
        onClose={onClose}
        open={open}
        closeMessage="Got it"
        title={title}
        description={description}
        doNothing={doNothing}
        log={log}
      />
    )}

    {type === '' && (
      <Transition appear show={open} as={Fragment}>
        <Dialog
          as="div"
          className="fixed z-10 inset-0 overflow-y-auto"
          onClose={onClose}
        >
          <div
            onClick={onClose}
            className="fixed z-0 -inset-0 w-full bg-brand-black bg-opacity-50 transition-all duration-300 ease-in-out"
          />

          <div className="px-4 min-h-screen text-center">
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

            <span
              className="inline-block align-middle h-screen"
              aria-hidden="true"
            >
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
    )}
  </>
);
