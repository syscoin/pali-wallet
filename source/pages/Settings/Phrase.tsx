import React, { useState, useEffect } from 'react';
import { Form, Input } from 'antd';
import { useUtils } from 'hooks/index';
import { Layout, SecondaryButton, Card, CopyCard } from 'components/index';
import { getController } from 'utils/browser';

const PhraseView = () => {
  const [phrase, setPhrase] = useState<string>(
    '**** ******* ****** ****** ****** ******** *** ***** ****** ***** *****'
  );

  const { useCopyClipboard, navigate, alert } = useUtils();
  const controller = getController();
  const [copied, copyText] = useCopyClipboard();

  const handleCopySeed = () => {
    copyText(phrase);
  };

  useEffect(() => {
    if (!copied) return;

    alert.removeAll();
    alert.success('Seed phrase successfully copied');
  }, [copied]);

  return (
    <Layout title="WALLET SEED PHRASE" id="seed-phrase-title">
      <p className="px-10 py-3 text-white text-sm">
        Please input your wallet password
      </p>

      <div className="flex flex-col items-center justify-center md:w-full md:max-w-md">
        <Form
          className="password flex flex-col gap-8 items-center justify-center my-6 w-full max-w-xs text-center md:max-w-md"
          name="phraseview"
          labelCol={{ span: 8 }}
          wrapperCol={{ span: 16 }}
          autoComplete="off"
        >
          <Form.Item
            name="password"
            hasFeedback
            className="w-full md:max-w-md"
            rules={[
              {
                required: true,
                message: '',
              },
              () => ({
                validator(_, value) {
                  const seed = controller.wallet.getSeed(value);

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
              className="password"
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

        <Card type="info">
          <p>
            <b className="text-warning-info">WARNING:</b> Keep your seed phrase
            secret! Anyone with your seed phrase can access any account
            connected to this wallet and steal your assets
          </p>
        </Card>

        <div className="absolute bottom-12 md:static md:mt-10">
          <SecondaryButton type="button" onClick={() => navigate('/home')}>
            Close
          </SecondaryButton>
        </div>
      </div>
    </Layout>
  );
};

export default PhraseView;
