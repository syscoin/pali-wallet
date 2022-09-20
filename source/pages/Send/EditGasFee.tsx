// import React, { FC, useCallback, useState, useEffect } from 'react';

// import high from 'assets/images/high.png';
// import low from 'assets/images/low.png';
// import { Tooltip, Icon, DefaultModal } from 'components/index';
// import { getController } from 'utils/browser';

// export const EditGasFee: FC<{
//   form: any;
//   setEdit: any;
//   setFee: any;
//   setGasFee: any;
// }> = ({ setGasFee, setEdit, setFee, form }) => {
//   const controller = getController();

//   const [baseFee, setBaseFee] = useState('0');
//   const [proposedGasPrice, setProposedGasPrice] = useState('0');
//   const [fastGasPrice, setFastGasPrice] = useState('0');
//   const [safeGasPrice, setSafeGasPrice] = useState('0');
//   const [isSelected, setIsSelected] = useState(false);
//   const [feeType, setFeeType] = useState('low');

//   const getFees = useCallback(async () => {
//     const { suggestBaseFee, ProposeGasPrice } =
//       await controller.wallet.account.eth.tx.getGasOracle();

//     setBaseFee(suggestBaseFee);
//     setFastGasPrice(
//       await controller.wallet.account.eth.tx.getFeeByType('high')
//     );
//     setSafeGasPrice(await controller.wallet.account.eth.tx.getFeeByType('low'));
//     setProposedGasPrice(ProposeGasPrice);

//     const gasFee = await controller.wallet.account.eth.tx.getFeeByType(feeType);

//     setGasFee(gasFee);
//     setFee(gasFee);

//     form.setFieldsValue({ gasPrice: gasFee });
//   }, [controller.wallet.account, feeType]);

//   useEffect(() => {
//     getFees();
//   }, [getFees]);

//   return (
//     <div className="flex flex-col items-center justify-center p-4 w-full md:max-w-md">
//       <DefaultModal
//         show={isSelected}
//         title="Selected successfully"
//         description="Your gas fee has been successfully selected."
//         onClose={() => setEdit(false)}
//       />

//       <div className="flex gap-2 items-center justify-between w-full">
//         <div
//           onClick={() => {
//             setFeeType('low');
//             setIsSelected(true);
//           }}
//           className="flex items-center justify-between p-4 w-full h-16 text-xs border border-dashed border-dashed-dark rounded-lg cursor-pointer"
//         >
//           <img src={low} alt="low fee" />

//           <div className="flex flex-col gap-0.5 items-start">
//             <p className="text-brand-white text-sm">
//               <span className="mr-1">Low</span>
//               <small className="text-brand-royalblue">2 - 3 min</small>
//             </p>

//             <p className="flex gap-1 items-center justify-start">
//               {safeGasPrice}

//               <Tooltip content="Low gas fee in GWEI">
//                 <Icon name="question" className="mb-1" />
//               </Tooltip>
//             </p>
//           </div>
//         </div>

//         <div
//           onClick={() => {
//             setFeeType('high');
//             setIsSelected(true);
//           }}
//           className="flex items-center justify-between p-4 w-full h-16 text-xs border border-dashed border-dashed-dark rounded-lg cursor-pointer"
//         >
//           <img src={high} alt="high fee" />

//           <div className="flex flex-col gap-0.5 items-start">
//             <p className="text-brand-white text-sm">
//               <span className="mr-1">High</span>
//               <small className="text-brand-royalblue">2 - 3 min</small>
//             </p>

//             <p className="flex gap-1 items-center justify-start">
//               {fastGasPrice}

//               <Tooltip content="Fast gas fee in GWEI">
//                 <Icon name="question" className="mb-1" />
//               </Tooltip>
//             </p>
//           </div>
//         </div>
//       </div>

//       <p className="mb-1 mt-24 text-center text-brand-white text-base font-bold">
//         Network fee status (GWEI)
//       </p>

//       <div className="flex items-center justify-center w-full text-center text-brand-white text-sm font-bold">
//         <div className="flex flex-1 flex-col items-center justify-center p-3 h-16 text-brand-graylight bg-bkg-3">
//           <p>{baseFee}</p>
//           <small>Base fee</small>
//         </div>

//         <div className="flex flex-1 flex-col items-center justify-center p-3 h-16 text-brand-graylight bg-bkg-3">
//           <p>{proposedGasPrice}</p>
//           <small>Priority fee</small>
//         </div>

//         <div className="flex flex-1 flex-col items-center justify-center p-3 h-16 text-brand-graylight bg-bkg-3">
//           <p>{safeGasPrice}</p>
//           <small>Safe gas price</small>
//         </div>
//       </div>
//     </div>
//   );
// };

import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { Layout, DefaultModal, NeutralButton } from 'components/index';
import { useQueryData, useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { dispatchBackgroundEvent, getController } from 'utils/browser';
import { truncate, logError, ellipsis } from 'utils/index';

export const EditGasFee = () => {
  const controller = getController();
  const { alert, navigate } = useUtils();

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );

  // when using the default routing, state will have the tx data
  // when using createPopup (DApps), the data comes from route params
  const { state }: { state: any } = useLocation();
  const { host, ...externalTx } = useQueryData();
  const isExternal = Boolean(externalTx.amount);
  const tx = isExternal ? externalTx : state.tx;

  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const handleConfirm = async () => {
    const balance = isBitcoinBased
      ? activeAccount.balances.syscoin
      : activeAccount.balances.ethereum;

    if (activeAccount && balance > 0) {
      setLoading(true);

      try {
        if (isBitcoinBased) {
          const response =
            await controller.wallet.account.sys.tx.sendTransaction({
              ...tx,
              token: tx.token ? tx.token.assetGuid : null,
            });

          setConfirmed(true);
          setLoading(false);

          if (isExternal) dispatchBackgroundEvent(`txSend.${host}`, response);

          return response;
        }

        await controller.wallet.account.eth.tx.sendAndSaveTransaction({
          ...tx,
          amount: Number(tx.amount),
          chainId: activeNetwork.chainId,
        });

        setConfirmed(true);
        setLoading(false);
      } catch (error: any) {
        logError('error', 'Transaction', error);

        if (activeAccount) {
          if (isBitcoinBased && error && tx.fee > 0.00001) {
            alert.removeAll();
            alert.error(
              `${truncate(
                String(error.message),
                166
              )} Please, reduce fees to send transaction.`
            );
          }

          alert.removeAll();
          alert.error("Can't complete transaction. Try again later.");

          setLoading(false);
        }
      }
    }
  };

  return (
    <Layout title="SEND">
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
      {tx && (
        <div className="flex flex-col items-center justify-center w-full">
          <p className="flex flex-col items-center justify-center text-center font-rubik">
            <span className="text-brand-royalblue font-poppins font-thin">
              Send
            </span>

            <span>
              {`${tx.amount} ${' '} ${
                tx.token
                  ? tx.token.symbol
                  : activeNetwork.currency?.toUpperCase()
              }`}
            </span>
          </p>

          <div className="flex flex-col gap-3 items-start justify-center mt-4 px-4 py-2 w-full text-left text-sm divide-bkg-3 divide-dashed divide-y">
            <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
              From
              <span className="text-brand-royalblue text-xs">
                {ellipsis(tx.sender, 7, 15)}
              </span>
            </p>

            <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
              To
              <span className="text-brand-royalblue text-xs">
                {ellipsis(tx.receivingAddress, 7, 15)}
              </span>
            </p>

            <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
              Fee
              <span className="text-brand-royalblue text-xs">
                {!isBitcoinBased
                  ? `${tx.fee * 10 ** 9} GWEI`
                  : `${tx.fee} ${activeNetwork.currency}`}
              </span>
            </p>

            <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
              Max total
              <span className="text-brand-royalblue text-xs">
                {Number(tx.fee) + Number(tx.amount)}
                {`${activeNetwork.currency?.toUpperCase()}`}
              </span>
            </p>
          </div>

          <div className="absolute bottom-12 md:static md:mt-10">
            <NeutralButton
              loading={loading}
              onClick={handleConfirm}
              type="button"
              id="confirm-btn"
            >
              Confirm
            </NeutralButton>
          </div>
        </div>
      )}
    </Layout>
  );
};
