import { Form, Input } from 'antd';
import { useForm } from 'antd/lib/form/Form';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import { Button } from 'components/index';
import { OnboardingLayout } from 'components/Layout/OnboardingLayout';
import { StatusModal } from 'components/Modal/StatusModal';
import { useController } from 'hooks/useController';
import { useOnboardingSecrets } from 'hooks/useOnboardingSecrets';
import { formatSeedPhrase } from 'utils/format';

type SeedValidationType = {
  seedLength: number | null;
  seedLengthError: boolean;
};

const eyeStyle = 'w-[18px] max-w-none';

const ImportPhrase: React.FC = () => {
  const { TextArea } = Input;
  const { controllerEmitter } = useController();
  const [form] = useForm();
  const navigate = useNavigate();
  const location = useLocation();
  const { beginImport, secrets } = useOnboardingSecrets();
  const isRecovery = Boolean(secrets.recoveryTicket);
  const active = useRef(true);
  const requestGeneration = useRef(0);
  const validationRequest = useRef(0);
  const submissionPending = useRef(false);
  const routeKey = useRef(location.key);
  routeKey.current = location.key;
  useEffect(() => {
    active.current = ['/import', '/external/import'].includes(
      location.pathname
    );
    const discard = () => {
      // Invalidate before the provider clears secrets: RPC replies can arrive
      // before navigation unmounts this form.
      active.current = false;
      requestGeneration.current += 1;
      submissionPending.current = false;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') discard();
    };
    window.addEventListener('pagehide', discard);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      discard();
      window.removeEventListener('pagehide', discard);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [location.key, location.pathname]);
  const isCurrent = (generation: number, url: string) =>
    active.current &&
    generation === requestGeneration.current &&
    routeKey.current === location.key &&
    window.location.href === url;
  const { t } = useTranslation();
  const [seedIsValid, setSeedIsValid] = useState<boolean>();
  const [visible, setVisible] = useState<boolean>(false);
  const [seedValidation, setSeedValidation] = useState<SeedValidationType>({
    seedLength: null,
    seedLengthError: false,
  });
  const [showModal, setShowModal] = useState(false);

  const textAreaNotVisibleStyle = visible ? 'filter blur-sm' : '';

  const formBorderStatusStyle = useMemo(
    () =>
      !seedIsValid && form.getFieldValue('phrase')
        ? 'border-warning-error'
        : 'border-fields-input-border',
    [seedIsValid]
  );

  const onSubmit = async ({ phrase }: { phrase: string }) => {
    const url = window.location.href;
    if (!isCurrent(requestGeneration.current, url) || submissionPending.current)
      return;
    submissionPending.current = true;
    const generation = ++requestGeneration.current;
    try {
      const isSeedValid = await controllerEmitter(
        ['wallet', 'isSeedValid'],
        [phrase]
      );
      if (isSeedValid && isCurrent(generation, url)) {
        beginImport(phrase, secrets.recoveryTicket);
        navigate('/create-password-import', {
          state: { isWalletImported: true },
        });
      }
    } catch {
      if (isCurrent(generation, url)) setSeedIsValid(false);
    } finally {
      if (generation === requestGeneration.current)
        submissionPending.current = false;
    }
  };

  const handleKeypress = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      form.submit();
    }
  };

  return (
    <OnboardingLayout
      scrollable
      title={t(isRecovery ? 'settings.recoveryTitle' : 'titles.importWallet')}
    >
      <StatusModal
        status="warn"
        title={t('import.importModalWordMissing')}
        description={t('import.importModalSeed', {
          seedLength: seedValidation.seedLength,
        })}
        onClose={() => setShowModal(false)}
        show={showModal}
      />
      <Form
        validateMessages={{ default: '' }}
        form={form}
        name="import"
        onFinish={onSubmit}
        onValuesChange={() => {
          // User edits supersede any pending submission. Programmatic phrase
          // normalization via setFieldsValue does not trigger this callback.
          requestGeneration.current += 1;
          submissionPending.current = false;
          setSeedIsValid(false);
        }}
        autoComplete="off"
        className="flex flex-col gap-4 items-center w-full max-w-xs"
      >
        <Form.Item
          name="phrase"
          rules={[
            {
              required: true,
              message: '',
            },
            () => ({
              validator(_, value) {
                const generation = requestGeneration.current;
                const validationId = ++validationRequest.current;
                const url = window.location.href;
                if (!isCurrent(generation, url))
                  return Promise.reject(
                    new Error('Seed import is no longer active.')
                  );
                setSeedIsValid(false);
                value = formatSeedPhrase(
                  typeof value === 'string' ? value : ''
                );
                if (typeof value !== 'string') {
                  setSeedIsValid(false);
                  setSeedValidation({
                    seedLength: value.seedLength,
                    seedLengthError: true,
                  });
                  return Promise.reject(
                    new Error(
                      t('import.importModalSeed', {
                        seedLength: value.seedLength,
                      })
                    )
                  );
                }
                form.setFieldsValue({ phrase: value });

                //todo: we should validate the seed phrase with the new fn
                return controllerEmitter(
                  ['wallet', 'isSeedValid'],
                  [value]
                ).then((isSeedValid: boolean) => {
                  if (
                    !isCurrent(generation, url) ||
                    validationId !== validationRequest.current
                  )
                    throw new Error('Seed import is no longer active.');
                  setSeedIsValid(isSeedValid);
                  setSeedValidation({
                    seedLength: value.split(/\s+/).length,
                    seedLengthError: false,
                  });
                  if (isSeedValid) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error(t('seedConfirm.seedError')));
                });
              },
            }),
          ]}
        >
          <div className="relative">
            <TextArea
              id="import-wallet-input"
              aria-label={t('import.pasteYourWalletSeed')}
              rows={3}
              onBlur={() =>
                seedValidation.seedLengthError
                  ? setShowModal(true)
                  : setShowModal(false)
              }
              style={{ padding: '15px 48px 15px 15px' }}
              className={`${formBorderStatusStyle} ${textAreaNotVisibleStyle} bg-fields-input-primary overflow-hidden max-w-[17.5rem] w-[17.5rem] h-[5.625rem] text-brand-graylight text-sm border focus:border-fields-input-borderfocus rounded-lg outline-none resize-none `}
              placeholder={t('import.pasteYourWalletSeed')}
              onKeyPress={handleKeypress}
            />
            <button
              type="button"
              aria-label={t(
                visible ? 'import.showSeedPhrase' : 'import.hideSeedPhrase'
              )}
              onClick={() => setVisible((hidden) => !hidden)}
              className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-content-primary"
            >
              <img
                className={eyeStyle}
                alt=""
                src={
                  visible
                    ? '/assets/all_assets/visibleEye.svg'
                    : '/assets/all_assets/notVisibleEye.svg'
                }
              />
            </button>
          </div>
        </Form.Item>

        <div className="w-[85%] text-center text-xs">
          <span className="text-brand-blue100 font-bold">
            {t('import.importAttention')}
          </span>
          <span className="text-brand-gray200 font-normal">
            {t('import.importingYourAccount')}
          </span>
        </div>

        <div className="w-full pb-6 pt-2">
          <Button
            id="import-wallet-action"
            type="submit"
            disabled={!seedIsValid || !form.getFieldValue('phrase')}
            className={`${
              seedIsValid
                ? 'cursor-pointer opacity-100'
                : 'cursor-not-allowed opacity-60'
            } bg-brand-deepPink100 w-[17.5rem] mt-3 h-10 text-white text-base font-base font-medium rounded-2xl`}
          >
            {t(isRecovery ? 'buttons.recoverWallet' : 'buttons.import')}
          </Button>
        </div>
      </Form>
    </OnboardingLayout>
  );
};

export default ImportPhrase;
