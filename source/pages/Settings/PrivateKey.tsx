import { Input, Form } from 'antd';
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Layout, Card, CopyCard, NeutralButton } from 'components/index';
import { useAdjustedExplorer, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { ellipsis } from 'utils/index';

const PrivateKeyView = () => {
  const { controllerEmitter } = useController();
  const { t } = useTranslation();
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
  const [currentXprv, setCurrentXprv] = useState<string>('');
  const [form] = Form.useForm();

  const currentPassword = form.getFieldValue('password');

  const getDecryptedPrivateKey = async (key: string) => {
    try {
      const privateKey = (await controllerEmitter(
        ['wallet', 'getPrivateKeyByAccountId'],
        [activeAccountMeta.id, activeAccountMeta.type, key]
      )) as string;

      return privateKey;
    } catch (e) {
      console.log('Wrong password', e);
    }
  };

  useEffect(() => {
    if (!copied) return;

    alert.removeAll();
    alert.success(t('settings.successfullyCopied'));
  }, [copied]);

  useEffect(() => {
    (async () => {
      if (currentPassword.length >= 8) {
        try {
          const xprv = await getDecryptedPrivateKey(
            form.getFieldValue('password')
          );

          setCurrentXprv(xprv);
        } catch (error) {
          console.error(error);
        }
      }
    })();
  }, [currentPassword]);

  const { url: activeUrl, explorer } = activeNetwork;

  const adjustedExplorer = useAdjustedExplorer(explorer);

  const url = isBitcoinBased ? activeUrl : adjustedExplorer;

  const property = isBitcoinBased ? 'xpub' : 'address';
  const value = isBitcoinBased ? activeAccount?.xpub : activeAccount.address;

  const explorerLink = isBitcoinBased
    ? `${url}/${property}/${value}`
    : `${url}${property}/${value}`;

  return (
    <Layout title={t('accountMenu.yourKeys').toUpperCase()}>
      {isBitcoinBased && (
        <Card type="info">
          <p>
            <b className="text-warning-info">{t('settings.forgetWarning')}: </b>
            {t('settings.thisIsYourAccountIndexer')} {activeAccount?.label},{' '}
            {t('settings.itIsntAReceivingAddress')}
          </p>
        </Card>
      )}

      {isBitcoinBased && (
        <CopyCard
          className="my-4"
          onClick={() => copyText(String(activeAccount?.xpub))}
          label={t('settings.yourXpub')}
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
                const { canLogin } = (await controllerEmitter(
                  ['wallet', 'unlock'],
                  [pwd, true]
                )) as any;

                if (canLogin) {
                  setValid(true);

                  return Promise.resolve();
                }

                return Promise.reject();
              },
            }),
          ]}
        >
          <Input.Password
            className="input-small relative custom-input-password"
            placeholder={t('settings.enterYourPassword')}
          />
        </Form.Item>
      </Form>

      <CopyCard
        onClick={valid ? () => copyText(currentXprv) : undefined}
        label={t('settings.yourPrivateKey')}
      >
        <p>
          {valid && activeAccount.xpub
            ? ellipsis(currentXprv, 4, 16)
            : '********...************'}
        </p>
      </CopyCard>

      {isBitcoinBased && (
        <div className="absolute bottom-8 md:static">
          <NeutralButton
            width="56 px-8"
            type="button"
            onClick={() => window.open(explorerLink)}
          >
            {t('settings.seeOnExplorer')}
          </NeutralButton>
        </div>
      )}
    </Layout>
  );
};

export default PrivateKeyView;
