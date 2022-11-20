import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import {
  DefaultModal,
  ErrorModal,
  Layout,
  PrimaryButton,
  SecondaryButton,
} from 'components/index';
import { useQueryData } from 'hooks/index';
import { RootState } from 'state/store';
import { dispatchBackgroundEvent, getController } from 'utils/browser';

interface ISign {
  send?: boolean;
}
//TODO: enhance the UI
// TODO: display warning for eth_sign users show the decoded Personal Message
const EthSign: React.FC<ISign> = () => {
  const { host, ...data } = useQueryData();

  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [message, setMessage] = useState<string>('');
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const { isBitcoinBased } = useSelector((state: RootState) => state.vault);
  const { label, balances, address } = activeAccount;
  const { currency } = activeNetwork;
  const onSubmit = async () => {
    const { account } = getController().wallet;

    setLoading(true);

    try {
      let response = '';
      if (data.eventName === 'eth_sign')
        response = await account.eth.tx.ethSign(data);
      else if (data.eventName === 'personal_sign')
        response = await account.eth.tx.signPersonalMessage(data);
      else if (data.eventName === 'eth_signTypedData') {
        const typedData = {
          data: data[0],
        };
        response = account.eth.tx.signTypedData(address, typedData, 'V1');
      }
      setConfirmed(true);
      setLoading(false);

      const type = data.eventName;
      dispatchBackgroundEvent(`${type}.${host}`, response);
    } catch (error: any) {
      setErrorMsg(error.message);

      setTimeout(window.close, 40000);
    }
  };
  useEffect(() => {
    const { account } = getController().wallet;
    if (data.eventName === 'personal_sign') {
      const msg = data[0] === activeAccount.address ? data[1] : data[0];
      const parsedMessage = account.eth.tx.parsePersonalMessage(msg);
      setMessage(parsedMessage);
    }
    if (data.eventName === 'eth_sign') {
      setMessage(data[1]);
    }
  }, []);
  return (
    <Layout canGoBack={false} title={'SIGNATURE REQUEST'}>
      <DefaultModal
        show={confirmed}
        onClose={window.close}
        title={'Signature request successfully submitted'}
        description="You can check your request under activity on your home screen."
        buttonText="Got it"
      />

      <ErrorModal
        show={Boolean(errorMsg)}
        onClose={window.close}
        title="Signature request failed"
        description="Sorry, we could not submit your request. Try again later."
        log={errorMsg || '...'}
        buttonText="Ok"
      />

      {!loading && (
        <div className="flex flex-col items-center justify-center w-full">
          <div className="flex flex-row justify-between mb-2 w-full">
            <p className="font-poppins text-sm">Account: {label}</p>
            <p className="font-poppins text-sm">
              Balance: {balances[isBitcoinBased ? 'syscoin' : 'ethereum']}{' '}
              {currency.toUpperCase()}
            </p>
          </div>
          <div className="justify-left flex flex-row mb-16 w-full">
            <p className="font-poppins text-sm">Origin: {host}</p>
          </div>
          <div className="flex justify-center mb-2 w-full">
            <p className="m-0 font-poppins text-sm">You are signing:</p>
          </div>
          {data.eventName !== 'eth_signTypedData' && (
            <div className="flex flex-col pb-4 pt-4 w-full border-b border-t border-dashed border-dashed-dark">
              <h1 className="text-lg">Message:</h1>
              <p className="scrollbar-styled font-poppins text-sm overflow-auto">
                {message}
              </p>
            </div>
          )}

          {data.eventName === 'eth_signTypedData' &&
            data[0].map((item: any, number: number) => (
              <div
                key={number}
                className="flex flex-col pb-4 pt-4 w-full border-b border-t border-dashed border-dashed-dark"
              >
                <h1 className="text-lg">{item?.name}:</h1>
                <p className="scrollbar-styled font-poppins text-sm overflow-auto">
                  {item?.value}
                </p>
              </div>
            ))}

          <div className="absolute bottom-10 flex items-center justify-between px-10 w-full md:max-w-2xl">
            <SecondaryButton type="button" onClick={window.close}>
              Cancel
            </SecondaryButton>

            <PrimaryButton
              type="submit"
              disabled={confirmed}
              loading={loading}
              onClick={onSubmit}
            >
              Confirm
            </PrimaryButton>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default EthSign;
