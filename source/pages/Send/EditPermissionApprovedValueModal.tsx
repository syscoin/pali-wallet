import { Dialog } from '@headlessui/react';
import { Form, Input, Radio, RadioChangeEvent } from 'antd';
import React, { useState } from 'react';

import { NeutralButton, Modal } from 'components/index';

export const EditPermissionApprovedValueModal = (props: any) => {
  const {
    host,
    customApprovedValue,
    tokenSymbol,
    showModal,
    setCustomApprovedAmount,
    setOpenEditFeeModal,
  } = props;

  const [formControlEditedFee] = Form.useForm();

  const [currentRadioChecked, setCurrentRadioChecked] =
    useState('proposed_limit');

  const onSubmitForm = (data: any) => {
    setCustomApprovedAmount({
      ...customApprovedValue,
      isCustom: currentRadioChecked === 'custom_limit',
      customApprovedValue:
        currentRadioChecked === 'custom_limit'
          ? data.custom_limit_input_value
          : '',
    });

    setOpenEditFeeModal(false);

    return;
  };

  const changeInputRadioValue = (event: RadioChangeEvent) => {
    setCurrentRadioChecked(event.target.value);
  };

  return (
    <Modal show={showModal} onClose={() => setOpenEditFeeModal(false)}>
      <div className="inline-block align-middle p-6 w-full max-w-2xl text-brand-white font-poppins bg-bkg-4 border border-brand-royalblue rounded-2xl shadow-xl overflow-hidden transform transition-all">
        <div className="flex flex-col items-center justify-center w-full">
          <div className="grid gap-y-4 grid-cols-1 auto-cols-auto">
            <div className="grid items-center">
              <div className="flex items-center mb-2">
                <Dialog.Title as="h2" className="text-base font-bold">
                  Spending limit permission
                </Dialog.Title>
              </div>

              <p className="text-left text-brand-graylight text-xs font-thin">
                Allow {host} to withdraw and spend up to the following amount:
              </p>
            </div>
            <Form form={formControlEditedFee} onFinish={onSubmitForm}>
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
                  <div className="grid gap-y-2 items-center mb-6 mt-2 text-sm">
                    <div className="flex items-center">
                      <Radio
                        value="proposed_limit"
                        name="proposed_limit"
                        id="proposed_limit"
                      />

                      <label
                        htmlFor="proposed_limit"
                        className="ml-2 font-bold"
                      >
                        Proposed approval limit
                      </label>
                    </div>
                    <div className="flex flex-col gap-y-2 pl-5 text-left">
                      <span>Spending limit requested by {host}</span>
                      <span>
                        {customApprovedValue.defaultApprovedValue}
                        <span className="ml-1 text-brand-royalblue font-semibold">
                          {tokenSymbol}
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-y-2 items-center mb-6 text-left text-sm">
                    <div className="flex items-center">
                      <Radio
                        value="custom_limit"
                        name="custom_limit"
                        id="custom_limit"
                      />

                      <label htmlFor="custom_limit" className="ml-2 font-bold">
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
                          },
                        ]}
                      >
                        <Input
                          type="text"
                          placeholder={customApprovedValue.defaultApprovedValue}
                          className={`px-4 py-2 text-brand-graylight ${
                            currentRadioChecked === 'custom_limit'
                              ? 'border bg-transparent border-slate-400'
                              : ''
                          } rounded outline-none`}
                          disabled={currentRadioChecked !== 'custom_limit'}
                        />
                      </Form.Item>
                    </div>
                  </div>

                  <div className="flex items-center justify-center">
                    <NeutralButton type="submit" id="confirm_btn">
                      Save
                    </NeutralButton>
                  </div>
                </Radio.Group>
              </Form.Item>
            </Form>
          </div>
        </div>
      </div>
    </Modal>
  );
};
