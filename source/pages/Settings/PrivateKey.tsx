import { Form } from 'antd';
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FiExternalLink as ExternalLinkIcon } from 'react-icons/fi';
import { useSelector } from 'react-redux';

import { Card, CopyCard, ValidatedPasswordInput } from 'components/index';
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

  const getDecryptedPrivateKey = async (key: string) => {
    const privateKey = (await controllerEmitter(
      ['wallet', 'getPrivateKeyByAccountId'],
      [activeAccountMeta.id, activeAccountMeta.type, key]
    )) as string;

    return privateKey;
  };

  useEffect(() => {
    if (!copied) return;

    alert.info(t('settings.successfullyCopied'));
  }, [copied, alert, t]);

  // Password validation function for ValidatedPasswordInput
  const validatePassword = async (password: string) => {
    const { canLogin } = (await controllerEmitter(
      ['wallet', 'unlock'],
      [password, true]
    )) as any;

    if (!canLogin) {
      throw new Error('Invalid password');
    }

    // Get the private key
    const privateKey = await getDecryptedPrivateKey(password);
    return { canLogin, privateKey };
  };

  // Handle successful password validation
  const handleValidationSuccess = (result: any) => {
    setValid(true);
    setCurrentXprv(result.privateKey);
  };

  // Handle failed password validation
  const handleValidationError = () => {
    setValid(false);
    setCurrentXprv('');
  };

  const { url: activeUrl, explorer } = activeNetwork;

  const adjustedExplorer = useAdjustedExplorer(explorer);

  const url = isBitcoinBased ? activeUrl : adjustedExplorer;

  const property = isBitcoinBased ? 'xpub' : 'address';
  const value = isBitcoinBased ? activeAccount?.xpub : activeAccount.address;

  const explorerLink = isBitcoinBased
    ? `${url}/${property}/${value}`
    : `${url}${property}/${value}`;

  return (
    <>
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
          className="my-4 w-full md:max-w-md"
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
        <ValidatedPasswordInput
          onValidate={validatePassword}
          onValidationSuccess={handleValidationSuccess}
          onValidationError={handleValidationError}
          placeholder={t('settings.enterYourPassword')}
          form={form}
          name="password"
          className="my-4"
        />
      </Form>

      <CopyCard
        className="w-full md:max-w-md"
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
        <div className="w-full flex items-center justify-center text-brand-white hover:text-brand-deepPink100 my-6">
          <a
            href={explorerLink}
            target="_blank"
            className="flex items-center justify-center gap-x-2"
            rel="noreferrer"
          >
            <ExternalLinkIcon size={16} />
            <span className="font-normal font-poppins underline text-sm">
              {t('settings.seeOnExplorer')}
            </span>
          </a>
        </div>
      )}
    </>
  );
};

export default PrivateKeyView;
