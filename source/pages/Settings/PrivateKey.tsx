import { Input, Form } from 'antd';
import React, { useState, useEffect, useMemo } from 'react';
import { useSelector } from 'react-redux';

import { Layout, Card, CopyCard, NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';
import { ellipsis } from 'utils/index';

const PrivateKeyView = () => {
  const controller = getController();

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );

  const { useCopyClipboard, alert } = useUtils();

  const [copied, copyText] = useCopyClipboard();
  const [valid, setValid] = useState<boolean>(false);
  const [form] = Form.useForm();

  const getDecryptedPrivateKey = (key: string) => {
    try {
      return controller.wallet.getPrivateKeyByAccountId(
        activeAccountMeta.id,
        activeAccountMeta.type,
        key
      );
    } catch (e) {
      console.log('Wrong password', e);
    }
  };

  useEffect(() => {
    if (!copied) return;

    alert.removeAll();
    alert.success('Successfully copied');
  }, [copied]);

  const { url: activeUrl, explorer } = activeNetwork;

  const adjustedExplorer = useMemo(
    () => (explorer.endsWith('/') ? explorer : `${explorer}/`),
    [explorer]
  );

  const url = isBitcoinBased ? activeUrl : adjustedExplorer;

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

      <Form
        validateMessages={{ default: '' }}
        name="phraseview"
        form={form}
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 16 }}
        autoComplete="off"
      >
        <Form.Item
          name="password"
          hasFeedback
          className="my-4 md:w-full"
          rules={[
            {
              required: true,
              message: '',
            },
            () => ({
              async validator(_, pwd) {
                if (await controller.wallet.unlock(pwd)) {
                  setValid(true);

                  return Promise.resolve();
                }

                return Promise.reject();
              },
            }),
          ]}
        >
          <Input.Password
            className="input-small relative"
            placeholder="Enter your password"
          />
        </Form.Item>
      </Form>

      <CopyCard
        onClick={
          valid
            ? () =>
                copyText(getDecryptedPrivateKey(form.getFieldValue('password')))
            : undefined
        }
        label="Your private key"
      >
        <p>
          {valid && activeAccount.xpub
            ? ellipsis(
                getDecryptedPrivateKey(form.getFieldValue('password')),
                4,
                16
              )
            : '********...************'}
        </p>
      </CopyCard>

      <div className="absolute bottom-8 md:static">
        <NeutralButton
          width="56 px-8"
          type="button"
          onClick={() => window.open(explorerLink)}
        >
          See on explorer
        </NeutralButton>
      </div>
    </Layout>
  );
};

export default PrivateKeyView;
