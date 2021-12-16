import React, { Fragment, useState } from 'react';
import { Header } from 'containers/common/Header';
import { AuthViewLayout, Layout } from 'containers/common/Layout';
import { Button, Icon } from 'components/index';;
import { usePopup, useController, usePrice, useStore, useUtils, useFormat, useAccount, useBrowser, useTransaction } from 'hooks/index';
import { IAccountState } from 'state/wallet/types';
import { Dialog, Transition } from '@headlessui/react';

export const SendConfirm = () => {
  const controller = useController();
  const getFiatAmount = usePrice();

  const { activeAccount } = useAccount();
  const { alert } = useUtils();
  const { confirmingTransaction } = useStore();
  const { browser } = useBrowser();
  const { handleConfirmSendTransaction } = useTransaction();

  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [showModal, setShowModal] = useState<boolean>(false);

  const { getHost, history } = useUtils();
  const { ellipsis, formatURL } = useFormat();
  const { closePopup } = usePopup();
  const { tempTx } = controller.wallet.account.getTransactionItem();

  const handleCancel = () => {
    history.push("/home");
  }

  const handleConfirm = async () => {
    await handleConfirmSendTransaction({
      setLoading,
      setConfirmed,
      controller,
      activeAccount,
      formatURL,
      confirmingTransaction,
      browser,
      tempTx,
      alert
    })
  }

  const ConfirmedModal = () => (
    <>
      <Transition appear show={showModal} as={Fragment}>
        <Dialog
          as="div"
          className="fixed inset-0 z-10 overflow-y-auto"
          onClose={() => setShowModal(false)}
        >
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

            {/* This element is to trick the browser into centering the modal contents. */}
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
              <div className="inline-block w-full max-w-md p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl rounded-2xl">
                <Dialog.Title
                  as="h3"
                  className="text-lg font-medium leading-6 text-gray-900"
                >
                  Transaction successful
                </Dialog.Title>
                <div className="mt-2">
                  <p className="text-sm text-gray-500">
                    Your transaction has been successfully submitted. You can see more details under activity on your home screen.
                  </p>
                </div>

                <div className="mt-4">
                  <button
                    type="button"
                    className="inline-flex justify-center px-4 py-2 text-sm font-medium text-blue-900 bg-blue-100 border border-transparent rounded-md hover:bg-blue-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500"
                    onClick={() => setShowModal(false)}
                  >
                    Got it
                  </button>
                </div>
              </div>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition>
      {/* {showModal && (
        <div className="transition-all duration-300 ease-in-out">
          <div
            onClick={() => setShowModal(false)}
            className="transition-all duration-300 ease-in-out fixed -inset-0 w-full z-0 bg-brand-darktransparent"
          />

          <div
            className="transition-all duration-300 ease-in-out fixed z-10 flex flex-col bg-brand-navymedium top-1/3 left-8 right-8 p-6 rounded-3xl"
          >
            <h2
              className="pb-4 text-brand-white border-b border-dashed border-brand-graylight w-full text-center mb-4"
            >
              Your transaction is underway
            </h2>

            <span
              className="font-light text-brand-graylight text-xs"
            >
              You can see more details under activity on your account screen.
            </span>

            <Button
              type="button"
              className="tracking-normal text-base leading-4 py-2.5 px-12 cursor-pointer rounded-full bg-brand-navymedium text-brand-white font-light border border-brand-white hover:bg-brand-white hover:text-brand-navymedium transition-all duration-300 mt-8"
              noStandard
              onClick={() => history.push('/home')}
            >
              Ok
            </Button>
          </div>
        </div>
      )} */}
    </>
  )

  return (
    <AuthViewLayout title="SEND SYS">
      {confirmed ? (
        <Transition appear show={confirmed} as={Fragment}>
          <Dialog
            as="div"
            className="fixed inset-0 z-10 overflow-y-auto"
            onClose={() => setConfirmed(false)}
          >
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
                <div className="font-poppins inline-block w-full max-w-md p-6 my-8 overflow-hidden text-center align-middle transition-all transform bg-brand-navyborder shadow-xl rounded-2xl">
                  <Dialog.Title
                    as="h3"
                    className="text-lg font-medium leading-6 text-brand-white"
                  >
                    Transaction successful
                  </Dialog.Title>
                  <div className="mt-2">
                    <p className="text-sm text-gray-300">
                      Your transaction has been successfully submitted. You can see more details under activity on your home screen.
                    </p>
                  </div>

                  <div className="mt-4">
                    <button
                      type="button"
                      className="inline-flex justify-center px-12 py-2 text-sm font-medium text-brand-royalBlue bg-blue-100 border border-transparent rounded-full hover:bg-blue-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-royalBlue"
                      onClick={() => history.push('/home')}
                    >
                      Got it
                    </button>
                  </div>
                </div>
              </Transition.Child>
            </div>
          </Dialog>
        </Transition>
      ) : (
        <>
          {tempTx && (
            <div className="mt-4 flex justify-center items-center flex-col">
              <p className="flex flex-col justify-center text-center items-center font-rubik">
                <span className="text-brand-royalBlue font-thin font-poppins">
                  Send
                </span>

                {tempTx.amount} {tempTx.token ? tempTx.token.symbol : 'SYS'}
              </p >

              <div className="w-full flex justify-center divide-y divide-dashed divide-slate-200 items-start flex-col gap-3 py-2 px-4 text-base mt-4 text-left">
                <p className="text-brand-royalBlue font-thin font-poppins flex flex-col w-full pt-2">
                  From

                  <span className="text-brand-white">{ellipsis(tempTx.fromAddress, 7, 15)}</span>
                </p>

                <p className="text-brand-royalBlue font-thin font-poppins flex flex-col w-full pt-2">
                  To

                  <span className="text-brand-white">{ellipsis(tempTx.toAddress, 7, 15)}</span>
                </p>

                <p className="text-brand-royalBlue font-thin font-poppins flex flex-col w-full pt-2">
                  Fee

                  <span className="text-brand-white">{tempTx.fee}</span>
                </p>

                <p className="text-brand-royalBlue font-thin font-poppins flex flex-col w-full pt-2">
                  Max total

                  <span className="text-brand-white">{Number(tempTx.fee) + Number(tempTx.amount)} SYS</span>
                </p>
              </div>

              <Button
                onClick={handleConfirm}
                type="button"
                className="bg-brand-navydarker"
                classNameBorder="absolute bottom-12"
              >
                Confirm
              </Button>
            </div >
          )}
        </>
      )}
    </AuthViewLayout >
  )
};
