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
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const onSubmit = async () => {
    const { account } = getController().wallet;

    setLoading(true);

    try {
      let response = '';
      if (data.eventName === 'eth_sign')
        response = await account.eth.tx.ethSign(data);
      else if (data.eventName === 'personal_sign')
        response = await account.eth.tx.signPersonalMessage(data);
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
    if (data.eventName === 'personal_sign') {
      const { account } = getController().wallet;
      const msg = data[0] === activeAccount.address ? data[1] : data[0];
      //TODO: add parsedMessage to the UI so users can see it as well
      const parsedMessage = account.eth.tx.parsePersonalMessage(msg);
      console.log('Parsed Message', parsedMessage);
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

export default EthSign;
