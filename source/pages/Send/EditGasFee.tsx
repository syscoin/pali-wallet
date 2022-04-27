import React, { FC, useCallback, useState, useEffect } from 'react';
import { Tooltip, Icon, DefaultModal } from 'components/index';
import low from 'assets/images/low.png';
import high from 'assets/images/high.png';
import { getController } from 'utils/browser';

export const EditGasFee: FC<{
  form: any;
  setEdit: any;
  setFee: any;
  setGasFee: any;
}> = ({ setGasFee, setEdit, setFee, form }) => {
  const controller = getController();

  const [baseFee, setBaseFee] = useState('0');
  const [proposedGasPrice, setProposedGasPrice] = useState('0');
  const [fastGasPrice, setFastGasPrice] = useState('0');
  const [safeGasPrice, setSafeGasPrice] = useState('0');
  const [isSelected, setIsSelected] = useState(false);
  const [feeType, setFeeType] = useState('low');

  const getFees = useCallback(async () => {
    const { suggestBaseFee, ProposeGasPrice } =
      await controller.wallet.account.eth.tx.getGasOracle();

    setBaseFee(suggestBaseFee);
    setFastGasPrice(
      await controller.wallet.account.eth.tx.getFeeByType('high')
    );
    setSafeGasPrice(await controller.wallet.account.eth.tx.getFeeByType('low'));
    setProposedGasPrice(ProposeGasPrice);

    const gasFee = await controller.wallet.account.eth.tx.getFeeByType(feeType);

    setGasFee(gasFee);
    setFee(gasFee);

    form.setFieldsValue({ gasPrice: gasFee });
  }, [controller.wallet.account, feeType]);

  useEffect(() => {
    getFees();
  }, [getFees]);

  return (
    <div className="flex flex-col items-center justify-center p-4 w-full md:max-w-md">
      <DefaultModal
        show={isSelected}
        title="Selected successfully"
        description="Your gas fee has been successfully selected."
        onClose={() => setEdit(false)}
      />
      <div className="flex gap-2 items-center justify-between w-full">
        <div
          onClick={() => {
            setFeeType('low');
            setIsSelected(true);
          }}
          className="flex items-center justify-between p-4 w-full h-16 text-xs border border-dashed border-dashed-dark rounded-lg cursor-pointer"
        >
          <img src={low} alt="low fee" />

          <div className="flex flex-col gap-0.5 items-start">
            <p className="text-brand-white text-sm">
              <span className="mr-1">Low</span>
              <small className="text-brand-royalblue">2 - 3 min</small>
            </p>

            <p className="flex gap-1 items-center justify-start">
              {safeGasPrice}

              <Tooltip content="Low gas fee in GWEI">
                <Icon name="question" className="mb-1" />
              </Tooltip>
            </p>
          </div>
        </div>

        <div
          onClick={() => {
            setFeeType('high');
            setIsSelected(true);
          }}
          className="flex items-center justify-between p-4 w-full h-16 text-xs border border-dashed border-dashed-dark rounded-lg cursor-pointer"
        >
          <img src={high} alt="high fee" />

          <div className="flex flex-col gap-0.5 items-start">
            <p className="text-brand-white text-sm">
              <span className="mr-1">High</span>
              <small className="text-brand-royalblue">2 - 3 min</small>
            </p>

            <p className="flex gap-1 items-center justify-start">
              {fastGasPrice}

              <Tooltip content="Fast gas fee in GWEI">
                <Icon name="question" className="mb-1" />
              </Tooltip>
            </p>
          </div>
        </div>
      </div>

      <p className="mb-1 mt-24 text-center text-brand-white text-base font-bold">
        Network fee status (GWEI)
      </p>

      <div className="flex items-center justify-center w-full text-center text-brand-white text-sm font-bold">
        <div className="flex flex-1 flex-col items-center justify-center p-3 h-16 text-brand-graylight bg-bkg-3">
          <p>{baseFee}</p>
          <small>Base fee</small>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center p-3 h-16 text-brand-graylight bg-bkg-3">
          <p>{proposedGasPrice}</p>
          <small>Priority fee</small>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center p-3 h-16 text-brand-graylight bg-bkg-3">
          <p>{safeGasPrice}</p>
          <small>Safe gas price</small>
        </div>
      </div>
    </div>
  );
};
