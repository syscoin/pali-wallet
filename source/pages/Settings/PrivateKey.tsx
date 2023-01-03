import React, { useEffect } from 'react';
import { useForm, FieldValues } from 'react-hook-form';
import { useSelector } from 'react-redux';

import { Layout, Card, CopyCard, NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';
import { ellipsis } from 'utils/index';

const PrivateKeyView = () => {
  const controller = getController();

  const {
    handleSubmit,
    register,
    formState: { isValid },
    getValues,
  } = useForm();

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );

  const { useCopyClipboard, alert } = useUtils();

  const [copied, copyText] = useCopyClipboard();

  const onSubmit = (data: FieldValues) =>
    controller.wallet.getDecryptedPrivateKey(data.password);

  useEffect(() => {
    if (!copied) return;

    alert.removeAll();
    alert.success('Successfully copied');
  }, [copied]);

  const url = isBitcoinBased ? activeNetwork.url : activeNetwork.explorer;
  const property = isBitcoinBased ? 'xpub' : 'address';
  const value = isBitcoinBased ? activeAccount?.xpub : activeAccount.address;

  const explorerLink = isBitcoinBased
    ? `${url}/${property}/${value}`
    : `${url}${property}/${value}`;

  return (
    <Layout title="YOUR KEYS">
      <Card type="info">
        <p>
          <b className="text-warning-info">WARNING: </b>
          This is your account root indexer to check your full balance for{' '}
          {activeAccount?.label}, it isn't a receiving address. DO NOT SEND
          FUNDS TO THESE ADDRESSES, YOU WILL LOOSE THEM!
        </p>
      </Card>

      {isBitcoinBased && (
        <CopyCard
          className="my-4"
          onClick={() => copyText(String(activeAccount?.xpub))}
          label="Your XPUB"
        >
          <p>{ellipsis(activeAccount?.xpub, 4, 16)}</p>
        </CopyCard>
      )}

      <form
        className="flex flex-col gap-4 items-center justify-start w-full max-w-xs h-full text-center md:max-w-md"
        onSubmit={handleSubmit(onSubmit)}
      >
        <input
          type="password"
          placeholder="Enter your password"
          className="input-small relative md:w-full"
          {...register('password', {
            validate: {
              checkPwd: (pwd: string) => controller.wallet.checkPassword(pwd),
            },
          })}
        />

        <CopyCard
          onClick={isValid ? () => copyText(onSubmit(getValues())) : undefined}
          label="Your private key"
        >
          <p>
            {isValid && activeAccount.xpub
              ? ellipsis(onSubmit(getValues()), 4, 16)
              : '********...************'}
          </p>
        </CopyCard>

        <NeutralButton
          className="absolute bottom-12 px-8 w-56 md:static"
          type="button"
          onClick={() => window.open(explorerLink)}
        >
          See on explorer
        </NeutralButton>
      </form>
    </Layout>
  );
};

export default PrivateKeyView;
