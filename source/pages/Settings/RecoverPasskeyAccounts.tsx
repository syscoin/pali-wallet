import { Form, Input } from 'antd';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import { DropdownArrowSvg } from 'components/Icon/Icon';
import { NeutralButton } from 'components/index';
import { CreatedAccountSuccessfully } from 'components/Modal/WarningBaseModal';
import { useController } from 'hooks/useController';
import { useUtils } from 'hooks/useUtils';
import { navigateBack } from 'utils/navigationState';
import { bytesToHex, getDiscoverablePasskeyAssertion } from 'utils/passkey';
import { isValidSponsorServiceUrl } from 'utils/passkey/sponsorUrl';

const scrollAreaClassName =
  'remove-scrollbar flex w-full max-w-[352px] max-h-[calc(100vh-260px)] flex-col gap-4 overflow-y-auto pb-8 text-left';

const disclosureButtonClassName =
  'flex w-full cursor-pointer items-center justify-between rounded-lg bg-alpha-whiteAlpha100 px-4 py-4 text-left hover:bg-brand-blue500 hover:bg-opacity-20 disabled:cursor-not-allowed disabled:opacity-60';

const Chevron = ({ open }: { open: boolean }) => (
  <DropdownArrowSvg
    isOpen={open}
    className="ml-3 shrink-0 text-brand-blue500"
  />
);

const RecoverPasskeyAccounts = () => {
  const { t } = useTranslation();
  const { alert } = useUtils();
  const { controllerEmitter, handleWalletLockedError } = useController();
  const navigate = useNavigate();
  const location = useLocation();
  const [form] = Form.useForm();

  const [address, setAddress] = useState<string | undefined>();
  const [accountName, setAccountName] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [recoverySponsorUrl, setRecoverySponsorUrl] = useState<string>('');
  const [needsSponsorUrl, setNeedsSponsorUrl] = useState<boolean>(false);
  const [sponsorUrlMismatch, setSponsorUrlMismatch] = useState<boolean>(false);
  const trimmedRecoverySponsorUrl = recoverySponsorUrl.trim();
  const isRecoverySponsorUrlValid =
    !trimmedRecoverySponsorUrl ||
    isValidSponsorServiceUrl(trimmedRecoverySponsorUrl);
  const isRecoverySubmitDisabled =
    loading ||
    sponsorUrlMismatch ||
    (showAdvanced &&
      Boolean(trimmedRecoverySponsorUrl) &&
      !isRecoverySponsorUrlValid) ||
    (needsSponsorUrl &&
      (!trimmedRecoverySponsorUrl || !isRecoverySponsorUrlValid));
  const sponsorUrlSummary = needsSponsorUrl
    ? t('settings.passkeyRecoverySponsorUrlRequiredShort')
    : t('settings.passkeyRecoverySponsorUrlOptional');

  const recoverPasskeyAccounts = async () => {
    let formValues: { recoverySponsorUrl?: string };
    try {
      formValues = await form.validateFields();
    } catch {
      return;
    }

    setLoading(true);
    setNeedsSponsorUrl(false);

    try {
      const trimmedSponsorUrl = (formValues.recoverySponsorUrl || '').trim();

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
            sponsorUrls: trimmedSponsorUrl ? [trimmedSponsorUrl] : [],
          },
        ],
        300000
      )) as any;

      if (result.missingSponsorUrl > 0) {
        setNeedsSponsorUrl(true);
        setShowAdvanced(true);
        setSponsorUrlMismatch(Boolean(trimmedSponsorUrl));
        form.setFields([
          {
            name: 'recoverySponsorUrl',
            errors: [
              trimmedSponsorUrl
                ? t('settings.passkeyRecoverySponsorUrlMismatch')
                : t('settings.passkeyRecoverySponsorUrlRequired'),
            ],
          },
        ]);
        return;
      }

      if (result.recovered > 0) {
        const firstAccount = result.accounts?.[0];
        setAccountName(firstAccount?.label || t('settings.passkeyAccount'));
        setAddress(firstAccount?.address || '');
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
            navigateBack(navigate, location);
          }}
          title={t('settings.passkeyAccountsRecovered', { count: 1 })}
          phraseOne={`${accountName}`}
          phraseTwo={`${address}`}
        />
      ) : (
        <Form
          form={form}
          component={false}
          initialValues={{ recoverySponsorUrl }}
        >
          <div className={scrollAreaClassName}>
            <p className="text-left text-white text-sm">
              {t('settings.recoverPasskeyAccountsDescription')}
            </p>

            <div className="text-xs text-brand-graylight">
              <button
                type="button"
                className={disclosureButtonClassName}
                disabled={loading}
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                <span>
                  <span className="block text-sm font-medium text-white">
                    {t('generalMenu.advanced')}
                  </span>
                  <span className="mt-1 block">{sponsorUrlSummary}</span>
                </span>
                <Chevron open={showAdvanced} />
              </button>

              {showAdvanced && (
                <div className="mt-3">
                  <Form.Item
                    name="recoverySponsorUrl"
                    className="md:w-full mb-0 px-1"
                    hasFeedback
                    rules={[
                      () => ({
                        validator(_, value) {
                          const trimmedValue =
                            typeof value === 'string' ? value.trim() : '';
                          if (!trimmedValue) {
                            return needsSponsorUrl
                              ? Promise.reject(
                                  new Error(
                                    t(
                                      'settings.passkeyRecoverySponsorUrlRequired'
                                    )
                                  )
                                )
                              : Promise.resolve();
                          }
                          if (isValidSponsorServiceUrl(trimmedValue)) {
                            return Promise.resolve();
                          }
                          return Promise.reject(
                            new Error(t('settings.invalidSponsorUrl'))
                          );
                        },
                      }),
                    ]}
                  >
                    <Input
                      type="text"
                      disabled={loading}
                      placeholder={t('settings.sponsorServiceUrl')}
                      className="custom-input-normal passkey-input relative"
                      onChange={(event) => {
                        setSponsorUrlMismatch(false);
                        setRecoverySponsorUrl(event.target.value);
                      }}
                    />
                  </Form.Item>
                </div>
              )}
            </div>
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
