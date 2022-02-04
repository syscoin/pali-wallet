import React, { useState } from 'react';
import { Form, Input } from 'antd';
import { useController, useUtils } from 'hooks/index';
import { AuthViewLayout } from 'containers/common/Layout/AuthViewLayout';
import { SecondaryButton, InfoCard, CopyCard } from 'components/index';

const PhraseView = () => {
  const [phrase, setPhrase] = useState<string>(
    '**** ******* ****** ****** ****** ******** *** ***** ****** ***** *****'
  );

  const { useCopyClipboard, navigate } = useUtils();
  const controller = useController();
  const [copied, copyText] = useCopyClipboard();

  const handleCopySeed = () => {
    copyText(phrase);
  };

  return (
    <AuthViewLayout title="WALLET SEED PHRASE" id="seed-phrase-title">
      <p className="px-10 py-3 text-white text-sm">
        Please input your wallet password
      </p>

      <div className="flex flex-col items-center justify-center">
        <Form
          className="password flex flex-col gap-8 items-center justify-center my-6 w-full max-w-xs text-center"
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
                validator(_, value) {
                  const seed = controller.wallet.getPhrase(value);

                  if (seed) {
                    setPhrase(seed);

                    return Promise.resolve();
                  }

                  return Promise.reject();
                },
              }),
            ]}
          >
            <Input.Password
              className="seed-phrase-password-input"
              placeholder="Enter your password"
              id="phraseview_password"
            />
          </Form.Item>
        </Form>

        <CopyCard
          className="my-4"
          onClick={() =>
            phrase !==
              '**** ******* ****** ****** ****** ******** *** ***** ****** ***** *****' &&
            handleCopySeed()
          }
          label="Seed Phrase: (click to copy)"
        >
          <p className="mt-3 text-xs" id="user-phrase">
            {phrase}
          </p>
        </CopyCard>

        <InfoCard>
          <p>
            <b className="text-warning-info">WARNING:</b> Keep your seed phrase
            secret! Anyone with your seed phrase can access any account
            connected to this wallet and steal your assets
          </p>
        </InfoCard>

        <div className="absolute bottom-12">
          <SecondaryButton type="button" onClick={() => navigate('/home')}>
            {copied ? 'Copied' : 'Close'}
          </SecondaryButton>
        </div>
      </div>
    </AuthViewLayout>
  );
};

export default PhraseView;
