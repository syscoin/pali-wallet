import { Input, Form } from 'antd';
import { useForm } from 'antd/es/form/Form';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { NeutralButton } from 'components/index';
import { ImportedWalletSuccessfully } from 'components/Modal/WarningBaseModal';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { extractErrorMessage } from 'utils/index';
import { navigateBack } from 'utils/navigationState';
import { validatePrivateKeyValue } from 'utils/validatePrivateKey';

const ImportAccountView = () => {
  const { controllerEmitter, handleWalletLockedError } = useController();
  const { navigate, alert } = useUtils();
  const { t } = useTranslation();
  const [form] = useForm();
  const [validPrivateKey, setValidPrivateKey] = useState(false);
  const location = useLocation();

  //* States
  const [isAccountImported, setIsAccountImported] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [watchOnly, setWatchOnly] = useState(false);
  const [validIdentifier, setValidIdentifier] = useState(false);

  const {
    accounts,
    activeAccount: activeAccountMeta,
    isBitcoinBased,
    activeNetwork,
  } = useSelector((state: RootState) => state.vault);

  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];

  if (!activeAccount) throw new Error('No account');

  const handleImportAccount = async () => {
    setIsImporting(true);
    if (form.getFieldValue('privKey')) {
      try {
        const account = await controllerEmitter(
          watchOnly
            ? ['wallet', 'importWatchOnlyFromController']
            : ['wallet', 'importAccountFromPrivateKey'],
          [form.getFieldValue('privKey'), form.getFieldValue('label')]
        );

        if (account) setIsAccountImported(true);

        setIsImporting(false);
      } catch (error) {
        setIsImporting(false);

        // Check if this is a wallet locked error and handle redirect
        const wasHandled = handleWalletLockedError(error);
        if (!wasHandled) {
          // If not a wallet locked error, show the original error message
          alert.error(extractErrorMessage(error, 'Import failed'));
        }
      }
    }
  };

  return (
    <>
      <ImportedWalletSuccessfully
        show={isAccountImported}
        onClose={() => navigateBack(navigate, location)}
        title={t('settings.accountImported')}
      />

      <p className="mb-8 text-left text-white text-sm">
        {t('settings.importAccountsWont')}
      </p>

      <div className="flex flex-col items-center justify-center">
        <Form
          validateMessages={{ default: '' }}
          className="flex flex-col gap-2 text-center md:w-full mb-10"
          name="newaccount"
          labelCol={{ span: 8 }}
          wrapperCol={{ span: 16 }}
          autoComplete="off"
          form={form}
        >
          <Form.Item
            name="label"
            className="md:w-full"
            hasFeedback
            rules={[
              {
                required: false,
                message: '',
              },
            ]}
          >
            <Input
              type="text"
              className="custom-input-normal relative"
              placeholder={`${t('settings.label')} (${t('settings.optional')})`}
              id="account-name-input"
            />
          </Form.Item>
          <div className="flex items-center justify-between mb-2">
            <label className="text-white text-sm">Watch-only</label>
            <input
              type="checkbox"
              checked={watchOnly}
              onChange={(e) => setWatchOnly(e.target.checked)}
              className="toggle-checkbox"
            />
          </div>
          <Form.Item
            name="privKey"
            className="md:w-full"
            hasFeedback
            rules={[
              { required: true, message: '' },
              () => ({
                async validator(_, value) {
                  if (!watchOnly) {
                    const isValid = await validatePrivateKeyValue(
                      value,
                      isBitcoinBased,
                      activeNetwork
                    );
                    if (isValid) {
                      setValidPrivateKey(true);
                      setValidIdentifier(false);
                      return Promise.resolve();
                    }
                    setValidPrivateKey(false);
                    // Check if it's a network type mismatch
                    const zprvPrefixes = ['zprv', 'vprv', 'xprv', 'tprv'];
                    const prefix = value.substring(0, 4);
                    const looksLikeZprv = zprvPrefixes.includes(prefix);
                    const looksLikeEvm =
                      value.startsWith('0x') || /^[0-9a-fA-F]{64}$/.test(value);
                    if (!isBitcoinBased && looksLikeZprv) {
                      return Promise.reject(
                        new Error(t('settings.utxoKeyOnEvmError'))
                      );
                    }
                    if (isBitcoinBased && looksLikeEvm) {
                      return Promise.reject(
                        new Error(t('settings.evmKeyOnUtxoError'))
                      );
                    }
                    return Promise.reject(
                      new Error(t('settings.invalidPrivateKeyFormat'))
                    );
                  } else {
                    // Watch-only: accept any non-empty input; validate on submit
                    const hasValue = !!(
                      value && String(value).trim().length > 0
                    );
                    setValidIdentifier(hasValue);
                    setValidPrivateKey(false);
                    return hasValue
                      ? Promise.resolve()
                      : Promise.reject(
                          new Error(t('settings.invalidPrivateKeyFormat'))
                        );
                  }
                },
              }),
            ]}
          >
            <Input
              type="text"
              className="custom-input-normal relative"
              placeholder={
                watchOnly
                  ? 'Address / XPUB / Descriptor'
                  : t('settings.yourPrivateKey')
              }
              id="account-name-input"
            />
          </Form.Item>
        </Form>

        <div className="w-full px-4 absolute bottom-12 md:static">
          <NeutralButton
            type="button"
            loading={isImporting}
            onClick={handleImportAccount}
            fullWidth={true}
            disabled={watchOnly ? !validIdentifier : !validPrivateKey}
          >
            {t('buttons.import')}
          </NeutralButton>
        </div>
      </div>
    </>
  );
};

export default ImportAccountView;
