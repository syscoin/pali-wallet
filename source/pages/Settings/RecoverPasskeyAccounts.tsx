import { Form } from 'antd';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import { NeutralButton } from 'components/index';
import { CreatedAccountSuccessfully } from 'components/Modal/WarningBaseModal';
import { useController } from 'hooks/useController';
import { useUtils } from 'hooks/useUtils';
import { navigateBack } from 'utils/navigationState';
import { bytesToHex, getDiscoverablePasskeyAssertion } from 'utils/passkey';

const scrollAreaClassName =
  'remove-scrollbar flex w-full max-w-[352px] max-h-[calc(100vh-260px)] flex-col gap-4 overflow-y-auto pb-8 text-left';

const RecoverPasskeyAccounts = () => {
  const { t } = useTranslation();
  const { alert } = useUtils();
  const { controllerEmitter, handleWalletLockedError } = useController();
  const navigate = useNavigate();
  const location = useLocation();
  const [form] = Form.useForm();

  const [address, setAddress] = useState<string | undefined>();
  const [accountName, setAccountName] = useState<string>('');
  const [recoveredCount, setRecoveredCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const isRecoverySubmitDisabled = loading;

  const recoverPasskeyAccounts = async () => {
    try {
      await form.validateFields();
    } catch {
      return;
    }

    setLoading(true);

    try {
      await controllerEmitter(['wallet', 'assertPasskeySmartAccountSupported']);
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const assertion = await getDiscoverablePasskeyAssertion(
        bytesToHex(challenge)
      );
      const result = (await controllerEmitter(
        ['wallet', 'recoverPasskeySmartAccounts'],
        [
          {
            backupStatus: assertion.backupStatus,
            credentialId: assertion.credentialId,
            credentialIdHash: assertion.credentialIdHash,
          },
        ],
        300000
      )) as any;

      if (result.recovered > 0) {
        const firstAccount = result.accounts?.[0];
        setAccountName(firstAccount?.label || t('settings.passkeyAccount'));
        setAddress(firstAccount?.address || '');
        setRecoveredCount(result.recovered);
        alert.success(
          t('settings.passkeyAccountsRecovered', {
            count: result.recovered,
          })
        );
      } else {
        alert.error(t('settings.noPasskeyAccountsRecovered'));
      }
    } catch (error: any) {
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        alert.error(error?.message || t('settings.failedToRecoverPasskey'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {address ? (
        <CreatedAccountSuccessfully
          show={address !== ''}
          onClose={() => {
            setAddress('');
            setRecoveredCount(0);
            navigateBack(navigate, location);
          }}
          title={t('settings.passkeyAccountsRecovered', {
            count: recoveredCount,
          })}
          phraseOne={`${accountName}`}
          phraseTwo={`${address}`}
        />
      ) : (
        <Form form={form} component={false}>
          <div className={scrollAreaClassName}>
            <p className="text-left text-white text-sm">
              {t('settings.recoverPasskeyAccountsDescription')}
            </p>
          </div>

          <div className="w-full px-4 absolute bottom-12 md:static">
            <NeutralButton
              type="button"
              disabled={isRecoverySubmitDisabled}
              loading={loading}
              onClick={recoverPasskeyAccounts}
              fullWidth
            >
              {t('settings.recoverPasskeyAccounts')}
            </NeutralButton>
          </div>
        </Form>
      )}
    </>
  );
};

export default RecoverPasskeyAccounts;
