import React, { useState } from 'react';
import { AuthViewLayout } from 'containers/common/Layout';
import { PrimaryButton, Modal } from 'components/index';;
import { useController, useStore, useUtils, useFormat, useAccount, useBrowser, useTransaction } from 'hooks/index';

export const SendConfirm = () => {
  const controller = useController();
  const { activeAccount } = useAccount();
  const { alert } = useUtils();
  const { confirmingTransaction } = useStore();
  const { browser } = useBrowser();
  const { handleConfirmSendTransaction } = useTransaction();

  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const { history } = useUtils();
  const { ellipsis, formatURL } = useFormat();

  const tempTx = controller.wallet.account.getTemporaryTransaction('sendAsset');

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

  return (
    <AuthViewLayout title="SEND SYS">
      {confirmed ? (
        <Modal
          type="default"
          title="Transaction successful"
          description="Your transaction has been successfully submitted. You can see more details under activity on your home page."
          open={confirmed}
          onClose={() => history.push('/home')}
          doNothing
        />
      ) : (
        <>
          {tempTx && (
            <div className="mt-4 flex justify-center items-center flex-col w-full">
              <p className="flex flex-col justify-center text-center items-center font-rubik">
                <span className="text-brand-royalBlue font-thin font-poppins">
                  Send
                </span>

                {tempTx.amount} {tempTx.token ? tempTx.token.symbol : 'SYS'}
              </p >

              <div className="w-full flex justify-center divide-y divide-dashed divide-brand-navyborder items-start flex-col gap-3 py-2 px-4 text-sm mt-4 text-left">
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

              <div className="absolute bottom-12">
                <PrimaryButton
                  loading={loading}
                  onClick={handleConfirm}
                  type="button"
                >
                  Confirm
                </PrimaryButton>
              </div>
            </div>
          )}
        </>
      )}
    </AuthViewLayout >
  )
};
