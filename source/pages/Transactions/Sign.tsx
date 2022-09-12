import React, { useState } from 'react';

import { isBase64, txUtils } from '@pollum-io/sysweb3-utils';

import {
  DefaultModal,
  ErrorModal,
  Layout,
  PrimaryButton,
  SecondaryButton,
} from 'components/index';
import { useQueryData, useUtils } from 'hooks/index';
import { dispatchBackgroundEvent, getController } from 'utils/browser';

interface ISign {
  send?: boolean;
}

const Sign: React.FC<ISign> = ({ send = false }) => {
  const { host, ...psbt } = useQueryData();

  const { alert } = useUtils();

  const { getPsbtFromJson } = txUtils();
  const { signTransaction } = getController().wallet.account.sys.tx;

  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const onSubmit = async () => {
    setLoading(true);

    if (!isBase64(psbt.psbt) || typeof psbt.assets !== 'string') {
      alert.error(
        'PSBT must be in Base64 format and assets must be a JSON string. Please check the documentation to see the correct formats.'
      );

      // window.close();

      return;
    }

    try {
      // @ts-ignore
      const data = getPsbtFromJson(JSON.stringify(psbt));
      // @ts-ignore
      const response = await signTransaction(data, send);

      setConfirmed(true);
      setLoading(false);

      const type = send ? 'SignAndSend' : 'Sign';
      dispatchBackgroundEvent(`tx${type}.${host}`, response);
    } catch (error: any) {
      setErrorMsg(error.message);

      setTimeout(window.close, 4000);
    }
  };

  return (
    <Layout canGoBack={false} title={'Signature Request'}>
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
          <ul className="scrollbar-styled mt-4 px-4 w-full h-80 text-xs overflow-auto">
            {/* <pre>{`${JSON.stringify(psbt, null, 2)}`}</pre> */}
            psbt
          </ul>

          <div className="absolute bottom-10 flex gap-3 items-center justify-between">
            <SecondaryButton type="button" action onClick={window.close}>
              Cancel
            </SecondaryButton>

            <PrimaryButton
              type="submit"
              action
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
