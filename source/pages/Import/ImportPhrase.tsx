import { Form, Input } from 'antd';
import { useForm } from 'antd/lib/form/Form';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { Button } from 'components/index';
import { OnboardingLayout } from 'components/Layout/OnboardingLayout';
import { StatusModal } from 'components/Modal/StatusModal';
import { useController } from 'hooks/useController';
import { formatSeedPhrase } from 'utils/format';

type SeedValidationType = {
  seedLength: string;
  seedLengthError: boolean;
};

const eyeStyle = 'w-[18px] max-w-none cursor-pointer hover:cursor-pointer z-20';

const ImportPhrase: React.FC = () => {
  const { TextArea } = Input;
  const { controllerEmitter } = useController();
  const [form] = useForm();
  const navigate = useNavigate();
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

  const onSubmit = ({ phrase }: { phrase: string }) => {
    controllerEmitter(['wallet', 'isSeedValid'], [phrase]).then(
      (isSeedValid: boolean) => {
        if (isSeedValid) {
          navigate('/create-password-import', {
            state: { phrase, isWalletImported: true },
          });
        }
      }
    );
  };

  const handleKeypress = (event) => {
    if (event.key === 'Enter') {
      form.submit();
    }
  };

  return (
    <OnboardingLayout title={t('titles.importWallet')}>
      <StatusModal
        status="warn"
        title={t('import.importModalWordMissing')}
        description={t('import.importModalSeed', {
          seedLength: seedValidation.seedLength,
        })}
        onClose={() => setShowModal(false)}
        position="inset-[-6.5rem]"
        show={showModal}
      />
      <Form
        validateMessages={{ default: '' }}
        form={form}
        name="import"
        onFinish={onSubmit}
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
                value = formatSeedPhrase(value);
                form.setFieldsValue({ phrase: value });

                //todo: we should validate the seed phrase with the new fn
                return controllerEmitter(
                  ['wallet', 'isSeedValid'],
                  [value]
                ).then((isSeedValid: boolean) => {
                  if (isSeedValid) {
                    setSeedIsValid(isSeedValid && value);

                    setSeedValidation({
                      seedLength: value.seedLength,
                      seedLengthError: false,
                    });

                    return Promise.resolve();
                  }

                  setSeedValidation({
                    seedLength: value.seedLength,
                    seedLengthError: value.seedLengthError,
                  });
                  return Promise.reject(new Error('Invalid seed phrase'));
                });
              },
            }),
          ]}
        >
          <div className="relative">
            <TextArea
              id="import-wallet-input"
              rows={3}
              onBlur={() =>
                seedValidation.seedLengthError
                  ? setShowModal(true)
                  : setShowModal(false)
              }
              style={{ padding: '15px 38px 15px 15px' }}
              className={`${formBorderStatusStyle} ${textAreaNotVisibleStyle} bg-fields-input-primary overflow-hidden max-w-[17.5rem] w-[17.5rem] h-[5.625rem] text-brand-graylight text-sm border focus:border-fields-input-borderfocus rounded-lg outline-none resize-none `}
              placeholder={t('import.pasteYourWalletSeed')}
              onKeyPress={handleKeypress}
            />
            <div className="absolute left-[88%] top-[18%] flex bg-brand-blue800">
              {visible ? (
                <img
                  className={eyeStyle}
                  onClick={() => setVisible(false)}
                  src="/assets/all_assets/visibleEye.svg"
                />
              ) : (
                <img
                  className={eyeStyle}
                  onClick={() => setVisible(true)}
                  src="/assets/all_assets/notVisibleEye.svg"
                />
              )}
            </div>
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

        <div className="absolute bottom-12 md:bottom-80">
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
            {t('buttons.import')}
          </Button>
        </div>
      </Form>
    </OnboardingLayout>
  );
};

export default ImportPhrase;
