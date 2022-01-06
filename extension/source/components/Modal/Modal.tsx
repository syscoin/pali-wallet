import { Dialog, Transition } from '@headlessui/react';
import { useUtils } from 'hooks/useUtils';
import React, { FC, Fragment } from 'react';

interface IModal {
  title: string;
  onClose: any;
  closeMessage?: string;
  connectedAccount?: any;
  open: boolean;
  type: string;
  description: string;
  doNothing?: boolean;
  log?: any;
  closePopup?: any;
}

const DefaultModal = ({
  onClose,
  open,
  goTo = '/home',
  background = 'bg-bkg-3',
  textColor = 'text-gray-300',
  title = '',
  description = '',
  closeMessage = 'Ok',
  doNothing = false,
  closePopup,
}) => {
  const { history } = useUtils();

  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog
        as="div"
        className="fixed inset-0 z-10 overflow-y-auto"
        onClose={onClose}
      >
        <div
          onClick={
            goTo && doNothing
              ? () => null
              : goTo && !doNothing
              ? () => history.push(goTo)
              : onClose
          }
          className="transition-all duration-300 ease-in-out fixed -inset-0 w-full z-0 bg-brand-black bg-opacity-50"
        />

        <div className="min-h-screen px-4 text-center">
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
            className="inline-block h-screen align-middle"
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
              className={`font-poppins inline-block w-full max-w-md p-6 my-8 overflow-hidden text-center align-middle transition-all transform ${background} shadow-xl rounded-2xl`}
            >
              <Dialog.Title
                as="h3"
                className="text-lg font-medium leading-6 text-brand-white"
              >
                {title}
              </Dialog.Title>
              <div className="mt-2">
                <p className={`text-sm ${textColor}`}>{description}</p>
              </div>

              <div className="mt-4">
                <button
                  type="button"
                  className="inline-flex justify-center px-12 py-2 text-sm font-medium text-brand-royalblue bg-blue-100 border border-transparent rounded-full hover:bg-blue-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-royalblue"
                  id="got-it-btn"
                  onClick={
                    goTo
                      ? closePopup
                        ? closePopup
                        : () => history.push(goTo)
                      : onClose
                  }
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
}) => {
  const { history } = useUtils();

  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog
        as="div"
        className="fixed inset-0 z-10 overflow-y-auto"
        onClose={onClose}
      >
        <div
          onClick={
            goTo && doNothing
              ? () => null
              : goTo && !doNothing
              ? () => history.push(goTo)
              : onClose
          }
          className="transition-all duration-300 ease-in-out fixed -inset-0 w-full z-0 bg-brand-black bg-opacity-50"
        />

        <div className="min-h-screen px-4 text-center">
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
            className="inline-block h-screen align-middle"
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
              className={`font-poppins inline-block w-full max-w-md p-6 my-8 overflow-hidden text-center align-middle transition-all border border-red-500 transform ${background} shadow-xl rounded-2xl`}
            >
              <Dialog.Title
                as="h3"
                className="text-lg font-medium leading-6 text-brand-white"
              >
                {title}
              </Dialog.Title>
              <div className="">
                <p className={`text-sm ${textColor}`}>{description}</p>
              </div>

              <p className="text-sm text-red-500 my-4">
                Error description: {log}
              </p>

              <div className="mt-8 flex justify-between items-center">
                <button
                  type="button"
                  className="inline-flex justify-center px-12 py-2 text-sm font-medium text-red-500 bg-blue-100 border border-red-500 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-royalblue"
                  onClick={onClose}
                >
                  {closeMessage}
                </button>

                <button
                  type="button"
                  className="inline-flex justify-center px-12 py-2 text-sm font-medium text-brand-white bg-red-500 border border-transparent rounded-full hover:bg-opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-royalblue"
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
  type,
  description,
  title,
  doNothing,
  log,
  closePopup,
}) => {
  return (
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
    </>
  );
};
