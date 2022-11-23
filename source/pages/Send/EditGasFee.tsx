import { Form, Input, Radio, RadioChangeEvent } from 'antd';
import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { Layout, DefaultModal, NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { getController } from 'utils/browser';

interface IEdtedFeeValue {
  currentTypeFee: string;
  feeValue: string;
}

export const EditGasFee = () => {
  const controller = getController();
  const { alert, navigate } = useUtils();

  // when using the default routing, state will have the tx data
  // when using createPopup (DApps), the data comes from route params
  const { state }: { state: any } = useLocation();
  const isExternal = Boolean(state.approvedValue);

  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [editedFeeValue, setEditedFeeValue] = useState<IEdtedFeeValue>({
    currentTypeFee: '',
    feeValue: '',
  });

  const [currentRadioChecked, setCurrentRadioChecked] =
    useState('proposed_limit');

  const canGoBack = state?.external ? !state.external : !isExternal;

  console.log('state', state);

  const changeInputRadioValue = (event: RadioChangeEvent) => {
    setCurrentRadioChecked(event.target.value);
  };

  const getFormValues = (data: any) => {
    setEditedFeeValue({
      currentTypeFee: data.radio_group,
      feeValue:
        data.radio_group === 'custom_limit'
          ? data.custom_limit_input_value
          : '',
    });

    setConfirmed(true);
  };

  console.log('editedFeeValue', editedFeeValue);

  return (
    <Layout title="Edit Gas" canGoBack={canGoBack}>
      <DefaultModal
        show={confirmed}
        title="Transaction successful"
        description="Your transaction has been successfully submitted. You can see more details under activity on your home page."
        onClose={() => {
          controller.refresh(false);
          if (isExternal) navigate('/external/tx/send/approve');
          else navigate('/home');
        }}
      />
      {state.approvedValue ? (
        <div className="flex flex-col items-center justify-center w-full">
          <div className="grid gap-y-4 grid-cols-1 py-4 auto-cols-auto">
            <div className="grid items-center">
              <div className="flex items-center mb-2">
                <h1 className="text-base font-bold">
                  Spending limit permission
                </h1>
              </div>

              <p className="text-brand-graylight text-xs font-thin">
                Allow {state.host} to withdraw and spend up to the following
                amount:
              </p>
            </div>

            <Form.Item
              id="radio_group"
              name="radio_group"
              initialValue={currentRadioChecked}
            >
              <Radio.Group
                id="radioGroup"
                name="radioGroup"
                onChange={changeInputRadioValue}
              >
                <div className="grid gap-y-2 items-center my-6 text-sm">
                  <div className="flex items-center">
                    <Radio
                      value="proposed_limit"
                      name="proposed_limit"
                      id="proposed_limit"
                    />

                    <label htmlFor="proposed_limit" className="ml-2 font-bold">
                      Proposed approval limit
                    </label>
                  </div>
                  <div className="flex flex-col gap-y-2 pl-5">
                    <span>Spending limit requested by {state.host}</span>
                    <span>
                      {state.approvedValue}
                      <span className="ml-1 text-brand-royalblue font-semibold">
                        {state.tokenSymbol}
                      </span>
                    </span>
                  </div>
                </div>

                <div className="grid gap-y-2 items-center text-sm">
                  <div className="flex items-center">
                    <Radio
                      value="custom_limit"
                      name="custom_limit"
                      id="custom_limit"
                    />

                    <label htmlFor="proposed_limit" className="ml-2 font-bold">
                      Custom spending limit
                    </label>
                  </div>
                  <div className="grid gap-y-2 pl-5">
                    <span>Enter a maximum spending limit</span>
                    <Form.Item
                      id="custom_limit_input_value"
                      name="custom_limit_input_value"
                      rules={[
                        {
                          required: currentRadioChecked === 'custom_limit',
                          message: 'Please enter a valid amount value!',
                        },
                      ]}
                    >
                      <Input
                        type="text"
                        placeholder={state.approvedValue}
                        style={{ color: 'black' }}
                        disabled={currentRadioChecked !== 'custom_limit'}
                        // onChange={(event) => {
                        //   const value = parseFloat(event?.target?.value);

                        //   const condition =
                        //     value > 0 && value <= state.approvedValue;

                        //   if (!condition) return;

                        //   form.setFieldValue(
                        //     'custom_limit_input_value',
                        //     value
                        //   );
                        // }}
                      />
                    </Form.Item>
                  </div>
                </div>

                <div className="absolute bottom-12 md:static md:mt-10">
                  <NeutralButton type="submit" id="confirm_btn">
                    Save
                  </NeutralButton>
                </div>
              </Radio.Group>
            </Form.Item>
          </div>
        </div>
      ) : null}
    </Layout>
  );
};
