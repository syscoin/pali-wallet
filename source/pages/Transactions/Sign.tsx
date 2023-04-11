import React, { useState } from 'react';
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

const Sign: React.FC<ISign> = ({ send = false }) => {
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );

  const { host, eventName, ...data } = useQueryData();

  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const onSubmit = async () => {
    const { syscoinTransaction } = getController().wallet;
    const sign = syscoinTransaction.signTransaction;

    setLoading(true);

    try {
      const response = await sign(data, send);

      setConfirmed(true);
      setLoading(false);

      dispatchBackgroundEvent(`${eventName}.${host}`, response);
    } catch (error: any) {
      setErrorMsg(error.message);

      setTimeout(window.close, 4000);
    }
  };

  return (
    <Layout canGoBack={false} title={'SIGNATURE REQUEST'}>
      <DefaultModal
        show={confirmed}
        onClose={window.close}
        title={'Signature request successfully submitted'}
        description={
          send
            ? 'The Dapp has your signed psbt'
            : 'You can check your request under activity on your home screen.'
        }
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
          <ul className="scrollbar-styled mt-8 px-4 w-full h-80 text-xs overflow-auto">
            <pre>{`${JSON.stringify(data, null, 2)}`}</pre>
          </ul>

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

export default Sign;
