import { Form, Input } from 'antd';
import { isEmpty } from 'lodash';
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { Layout, Card, Button } from 'components/index';
import { StatusModal } from 'components/Modal/StatusModal';
import { useUtils } from 'hooks/index';
import { getController } from 'scripts/Background';

const PhraseView = () => {
  const [phrase, setPhrase] = useState<string>();
  const mockedPhrase =
    '**** ******* ****** ****** ****** ******** *** ***** ****** ***** *****';

  const [visible, setVisible] = useState<boolean>(false);
  const { t } = useTranslation();
  const { useCopyClipboard, navigate } = useUtils();
  const controller = getController();
  const [copied, copyText] = useCopyClipboard();

  const [showModal, setShowModal] = useState<boolean>(false);

  useEffect(() => {
    if (!copied) return;
    setShowModal(true);
  }, [copied]);

  const handleCopyToClipboard = () => {
    copyText(phrase);
  };

  return (
    <Layout title={t('settings.walletSeedPhrase')} id="seed-phrase-title">
      <StatusModal
        status="success"
        title="Copied"
        description={t('settings.seedPhraseCopied')}
        onClose={() => setShowModal(false)}
        show={showModal}
      />
      <p className="text-sm mb-6">
        {t('forgetWalletPage.importedAccountsWont')}
      </p>
      <div className="flex flex-col">
        <Form
          validateMessages={{ default: '' }}
          className="password flex flex-col gap-4 items-center justify-center mb-10 w-full text-center "
          name="phraseview"
          labelCol={{ span: 8 }}
          wrapperCol={{ span: 16 }}
          autoComplete="off"
        >
          <Form.Item
            name="password"
            hasFeedback
            className="w-full"
            rules={[
              {
                required: true,
                message: '',
              },
              () => ({
                async validator(_, value) {
                  try {
                    const seed = await controller.wallet.getSeed(value);
                    if (seed) {
                      setPhrase(seed);

                      return Promise.resolve();
                    }
                  } catch (e) {
                    console.log('Error: ', e);
                  }

                  return Promise.reject();
                },
              }),
            ]}
          >
            <Input.Password
              className="custom-input-password relative focus:border-fields-input-border"
              placeholder={t('settings.enterYourPassword')}
              id="phraseview_password"
            />
          </Form.Item>
        </Form>

        <div className="flex gap-3 items-start p-4 w-[22rem] max-w-[22rem] border border-border-default rounded-[10px] bg-brand-blue800">
          <div
            className={`flex flex-wrap flex-row gap-1 bg-brand-blue800 ${
              visible ? '' : 'filter blur-sm'
            }`}
          >
            {(isEmpty(phrase) ? mockedPhrase : phrase)
              .split(' ')
              .map((phraseText: string, index: number) => (
                <p key={index} className="flex text-white text-sm font-light ">
                  {phraseText}
                </p>
              ))}
          </div>
          <div
            className={`flex bg-brand-blue800 ${
              phrase ? `relative` : `hidden`
            }`}
          >
            {visible ? (
              <img
                className="w-[18px] max-w-none cursor-pointer hover:cursor-pointer z-20"
                onClick={() => setVisible(false)}
                src="/assets/icons/visibleEye.svg"
              />
            ) : (
              <img
                className="w-[18px] max-w-none cursor-pointer hover:cursor-pointer z-20"
                onClick={() => setVisible(true)}
                src="/assets/icons/notVisibleEye.svg"
              />
            )}
          </div>
        </div>

        <div className="flex w-full flex-col space-y-6 mt-2 mb-6 z-20">
          {copied ? (
            <div className="flex w-full gap-1 items-center cursor-pointer hover:cursor-pointer">
              <img
                className="w-[16px] max-w-none"
                src="/assets/icons/successIcon.svg"
              />
              <p className="text-sm text-white">Copied!</p>
            </div>
          ) : (
            <div
              className={`flex w-max gap-1 items-center ${
                phrase ? `cursor-pointer` : `cursor-not-allowed`
              } hover:cursor-pointer`}
              onClick={() => {
                phrase && handleCopyToClipboard();
              }}
            >
              <img className="max-w-none z-20 " src="/assets/icons/copy.svg" />
              <p className="text-sm text-white">Copy</p>
            </div>
          )}
        </div>

        <Card type="info">
          <div className="flex flex-col justify-start items-start">
            <p className="text-brand-yellowInfo text-sm font-normal text-left">
              {t('walletSeedPhrasePage.keepSeedPhrase')}
            </p>
            <p className="text-white text-sm font-normal text-left">
              {t('walletSeedPhrasePage.anyoneWithThisInfo')}
            </p>
          </div>
        </Card>

        <div className="my-7">
          <Button
            type="button"
            onClick={() => navigate('/home')}
            className="w-[352px] h-10 flex items-center justify-center rounded-[100px] bg-white border-white text-base font-medium text-brand-blue400"
          >
            {t('buttons.close')}
          </Button>
        </div>
      </div>
    </Layout>
  );
};

export default PhraseView;
