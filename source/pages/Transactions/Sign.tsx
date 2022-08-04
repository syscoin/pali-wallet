import React, { useState } from 'react';
import { useAlert } from 'react-alert';

import {
  DefaultModal,
  ErrorModal,
  Layout,
  PrimaryButton,
  SecondaryButton,
} from 'components/index';
import { useQueryData } from 'hooks/index';
import { getController } from 'utils/browser';
import { base64Regex } from 'utils/index';

interface ITxSign {
  send?: boolean;
}

const Sign: React.FC<ITxSign> = ({ send = false }) => {
  const { host, ...psbt } = useQueryData();

  const alert = useAlert();
  const accountCtlr = getController().wallet.account;

  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [logError, setLogError] = useState('');

  const handleConfirmSignature = async () => {
    setLoading(true);

    if (!base64Regex.test(psbt.psbt) || typeof psbt.assets !== 'string') {
      alert.removeAll();
      alert.error(
        'PSBT must be in Base64 format and assets must be a JSON string. Please check the documentation to see the correct formats.'
      );

      window.close();

      return;
    }

    try {
      const response = await accountCtlr.sys.tx.signTransaction(psbt, send);

      setConfirmed(true);
      setLoading(false);

      // setTimeout(() => cancelTransaction(browser, psbt), 4000);

      // TODO dispatch background event
    } catch (error: any) {
      setFailed(true);
      setLogError(error.message);

      setTimeout(window.close, 4000);
    }
  };

  return (
    <Layout canGoBack={false} title={'Signature Request'}>
      <DefaultModal
        onClose={window.close}
        show={!failed && confirmed}
        title={'Signature request successfully submitted'}
        description="You can check your request under activity on your home screen."
        buttonText="Got it"
      />

      <ErrorModal
        show={failed}
        onClose={window.close}
        title="Token creation request failed"
        description="Sorry, we could not submit your request. Try again later."
        log={logError || '...'}
        buttonText="Ok"
      />

      {!loading && (
        <div className="flex flex-col items-center justify-center w-full">
          <ul className="scrollbar-styled mt-4 px-4 w-full h-80 text-xs overflow-auto">
            <pre>
              {
                // TODO importPsbt
              }
              {/* {`${JSON.stringify(accountCtlr.importPsbt(psbt), null, 2)}`} */}
            </pre>
          </ul>

          <div className="absolute bottom-10 flex gap-3 items-center justify-between">
            <SecondaryButton type="button" action onClick={window.close}>
              Cancel
            </SecondaryButton>

            <PrimaryButton
              type="submit"
              action
              disabled={confirmed}
              loading={loading && !failed && !confirmed}
              onClick={handleConfirmSignature}
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
