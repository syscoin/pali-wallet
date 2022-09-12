import React, { useEffect, useState } from 'react';
import { useAlert } from 'react-alert';
import { useSelector } from 'react-redux';

import { isBase64, txUtils } from '@pollum-io/sysweb3-utils';
const { getPsbtFromJson } = txUtils();

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
  // `toSign` is a psbt if is sys: { psbt, assets }
  // otherwise it is { params: [from, msg], from }
  const { host, ...toSign } = useQueryData();

  const alert = useAlert();

  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSyscoinChain, setIsSycoinChain] = useState(false);

  const networks = useSelector((state: RootState) => state.vault.networks);
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  useEffect(() => {
    const _isSyscoinChain =
      Boolean(networks.syscoin[activeNetwork.chainId]) &&
      activeNetwork.url.includes('blockbook');
    setIsSycoinChain(_isSyscoinChain);

    if (!_isSyscoinChain) return;

    if (!isBase64(toSign.psbt) || typeof toSign.assets !== 'string') {
      alert.error(
        'PSBT must be in Base64 format and assets must be a JSON string. Please check the documentation to see the correct formats.'
      );

      window.close();

      return;
    }
  }, []);

  const onSubmit = async () => {
    setLoading(true);

    const { eth, sys } = getController().wallet.account;
    try {
      let response;
      if (isSyscoinChain) {
        response = await sys.tx.signTransaction(toSign, send);
      } else {
        console.log('toSign', toSign);
        // setActiveNetwork(networks.ethereum[4]);
        response = await eth.tx.signTypedDataV4(
          toSign.params[1]
          // toSign.from,
          // activeNetwork.url
        );
        console.log('response', response);
      }

      setConfirmed(true);
      setLoading(false);

      const type = send ? 'SignAndSend' : 'Sign';
      dispatchBackgroundEvent(`tx${type}.${host}`, response);
    } catch (error: any) {
      setErrorMsg(error.message);

      // setTimeout(window.close, 4000);

      throw error;
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

      <div className="flex flex-col items-center justify-center w-full">
        <ul className="scrollbar-styled mt-4 px-4 w-full h-80 text-xs overflow-auto">
          <pre>{`${JSON.stringify(
            isSyscoinChain ? getPsbtFromJson(toSign) : toSign.params[1],
            null,
            2
          )}`}</pre>
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
    </Layout>
  );
};

export default Sign;
