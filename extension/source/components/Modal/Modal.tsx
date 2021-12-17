import { Dialog, Transition } from '@headlessui/react';
import { useWindowsAPI } from 'hooks/useBrowser';
import { useUtils } from 'hooks/useUtils';
import React, { FC, Fragment, useMemo } from 'react';
import { Button } from '..';

interface IModal {
  title: string;
  onClose: any;
  closeMessage?: string;
  connectedAccount?: any;
  open: boolean;
  type: string;
  description: string;
  doNothing?: boolean;
}

const ConnectionModal = ({
  onClose,
  title = '',
  open,
  closeMessage = 'Close',
  connectedAccount,
  currentOrigin
}) => {
  return (
    <>
      {open && (
        <div className="transition-all duration-300 ease-in-out">
          <div
            onClick={onClose}
            className="transition-all duration-300 ease-in-out fixed -inset-0 w-full z-0 bg-brand-darktransparent"
          />

          <div
            className="transition-all duration-300 ease-in-out fixed z-10 flex flex-col bg-brand-navymedium top-1/3 left-8 right-8 p-6 rounded-3xl"
          >
            <h2
              className="pb-4 text-brand-white border-b border-dashed border-brand-graylight w-full text-center mb-4"
            >
              {title}
            </h2>

            {connectedAccount ? (
              <span
                className="font-light text-brand-graylight text-xs"
              >
                This account is connected to {currentOrigin || ''}.
              </span>
            ) : (
              <span
                className="font-light text-brand-graylight text-xs"
              >
                This account is not connected to this site. To connect to a sys platform site, find the connect button on their site.
              </span>
            )}

            <Button
              type="button"
              className="tracking-normal text-base leading-4 py-2.5 px-12 cursor-pointer rounded-full bg-brand-navymedium text-brand-white font-light border border-brand-white hover:bg-brand-white hover:text-brand-navymedium transition-all duration-300 mt-8"
              noStandard
              onClick={onClose}
            >
              {closeMessage}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

const DefaultModal = ({
  onClose,
  open,
  goTo = '/home',
  background = 'bg-brand-navyborder',
  textColor = 'text-gray-300',
  title = '',
  description = '',
  closeMessage = 'Ok',
  doNothing = false,
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
          onClick={goTo && doNothing ? () => null : goTo && !doNothing ? () => history.push(goTo) : onClose}
          className="transition-all duration-300 ease-in-out fixed -inset-0 w-full z-0 bg-brand-darktransparent"
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
            <div className={`font-poppins inline-block w-full max-w-md p-6 my-8 overflow-hidden text-center align-middle transition-all transform ${background} shadow-xl rounded-2xl`}>
              <Dialog.Title
                as="h3"
                className="text-lg font-medium leading-6 text-brand-white"
              >
                {title}
              </Dialog.Title>
              <div className="mt-2">
                <p className={`text-sm ${textColor}`}>
                  {description}
                </p>
              </div>

              <div className="mt-4">
                <button
                  type="button"
                  className="inline-flex justify-center px-12 py-2 text-sm font-medium text-brand-royalBlue bg-blue-100 border border-transparent rounded-full hover:bg-blue-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-royalBlue"
                  onClick={goTo ? () => history.push(goTo) : onClose}
                >
                  {closeMessage}
                </button>
              </div>
            </div>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  )
}

export const Modal: FC<IModal> = ({
  onClose,
  open,
  connectedAccount,
  type,
  description,
  title,
  doNothing
}) => {
  const { getCurrentOrigin } = useWindowsAPI();

  const currentOrigin = useMemo(async () => {
    return await getCurrentOrigin();
  }, []);

  return (
    <>
      {type === 'connection' && (
        <ConnectionModal
          onClose={onClose}
          open={open}
          closeMessage='Close'
          connectedAccount={connectedAccount}
          currentOrigin={currentOrigin}
        />
      )}

      {type === 'standard' && (
        <DefaultModal
          onClose={onClose}
          open={open}
          closeMessage='Got it'
          title={title}
          description={description}
          doNothing={doNothing}
        />
      )}
    </>
  );
};
