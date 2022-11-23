import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';

import { Layout, DefaultModal, NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { getController } from 'utils/browser';

export const EditGasFee = () => {
  const controller = getController();
  const { alert, navigate } = useUtils();

  // when using the default routing, state will have the tx data
  // when using createPopup (DApps), the data comes from route params
  const { state }: { state: any } = useLocation();
  const isExternal = Boolean(state.approvedValue);

  const [confirmed, setConfirmed] = useState<boolean>(false);

  console.log('state', state);

  // const handleConfirm = async () => {
  //   const balance = isBitcoinBased
  //     ? activeAccount.balances.syscoin
  //     : activeAccount.balances.ethereum;

  //   if (activeAccount && balance > 0) {
  //     setLoading(true);

  //     try {
  //       if (isBitcoinBased) {
  //         const response =
  //           await controller.wallet.account.sys.tx.sendTransaction({
  //             ...tx,
  //             token: tx.token ? tx.token.assetGuid : null,
  //           });

  //         setConfirmed(true);
  //         setLoading(false);

  //         if (isExternal) dispatchBackgroundEvent(`txSend.${host}`, response);

  //         return response;
  //       }

  //       await controller.wallet.account.eth.tx.sendAndSaveTransaction({
  //         ...tx,
  //         amount: Number(tx.amount),
  //         chainId: activeNetwork.chainId,
  //       });

  //       setConfirmed(true);
  //       setLoading(false);
  //     } catch (error: any) {
  //       logError('error', 'Transaction', error);

  //       if (activeAccount) {
  //         if (isBitcoinBased && error && tx.fee > 0.00001) {
  //           alert.removeAll();
  //           alert.error(
  //             `${truncate(
  //               String(error.message),
  //               166
  //             )} Please, reduce fees to send transaction.`
  //           );
  //         }

  //         alert.removeAll();
  //         alert.error("Can't complete transaction. Try again later.");

  //         setLoading(false);
  //       }
  //     }
  //   }
  // };

  return (
    <Layout title="Edit Gas">
      <DefaultModal
        show={confirmed}
        title="Transaction successful"
        description="Your transaction has been successfully submitted. You can see more details under activity on your home page."
        onClose={() => {
          controller.refresh(false);
          if (isExternal) window.close();
          else navigate('/home');
        }}
      />
      {state.approvedValue ? (
        <div className="flex flex-col items-center justify-center w-full">
          <div className="grid gap-y-4 grid-cols-1 py-4 auto-cols-auto">
            <div className="grid items-center">
              <div className="flex items-center mb-2">
                <h1 className="text-base font-bold">
                  Spending limit permission
                </h1>
              </div>

              <p className="text-brand-graylight text-xs font-thin">
                Allow {state.host} to withdraw and spend up to the following
                amount:
              </p>
            </div>

            <form>
              <div className="grid gap-y-2 items-center my-6 text-sm">
                <div className="flex items-center">
                  <input
                    type="radio"
                    id="proposed-limit"
                    name="proposed-limit"
                    value="proposed-limit"
                    checked
                  />
                  <label htmlFor="proposed-limit" className="ml-2 font-bold">
                    Proposed approval limit
                  </label>
                </div>
                <div className="flex flex-col gap-y-2 pl-5">
                  <span>Spending limit requested by {state.host}</span>
                  <span>
                    {state.approvedValue}
                    <span className="ml-1 text-brand-royalblue font-semibold">
                      {state.tokenSymbol}
                    </span>
                  </span>
                </div>
              </div>

              <div className="grid gap-y-2 items-center text-sm">
                <div className="flex items-center">
                  <input
                    type="radio"
                    id="custom-limit"
                    name="custom-limit"
                    value="custom-limit"
                  />
                  <label htmlFor="custom-limit" className="ml-2 font-bold">
                    Custom spending limit
                  </label>
                </div>
                <div className="grid gap-y-2 pl-5">
                  <span>Enter a maximum spending limit</span>
                  <input placeholder={state.approvedValue} />
                </div>
              </div>
            </form>
          </div>

          <div className="absolute bottom-12 md:static md:mt-10">
            <NeutralButton type="button" id="confirm-btn">
              Save
            </NeutralButton>
          </div>
        </div>
      ) : null}
    </Layout>
  );
};
