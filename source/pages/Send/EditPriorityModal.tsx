import { Form, Input } from 'antd';
import _ from 'lodash';
import React, { useEffect, useState } from 'react';

import { Modal, NeutralButton } from 'components/index';
import removeScientificNotation from 'utils/removeScientificNotation';

import { PriorityBar } from './components';

export const EditPriorityModal = (props: any) => {
  const {
    showModal,
    setIsOpen,
    customFee,
    setCustomFee,
    fee,
    setHaveError,
    isSendLegacyTransaction,
  } = props;
  const [priority, setPriority] = useState<number>(1);

  const [form] = Form.useForm();
  const maxFeePerGas = fee?.maxFeePerGas;
  const maxPriorityFeePerGas = fee?.maxPriorityFeePerGas;

  const handleSubmit = () => {
    const gasLimitField = form.getFieldValue('gasLimit');
    const maxFeePerGasField = form.getFieldValue('maxFeePerGas');
    const maxPriorityFeePerGasField = form.getFieldValue(
      'maxPriorityFeePerGas'
    );
    const validations = [
      Number(gasLimitField) > 1000,
      Number(maxPriorityFeePerGasField) < Number(maxFeePerGasField),
    ];

    if (validations.every((item) => item === true)) {
      setIsOpen(false);
      setHaveError(false);
      return;
    }
    setHaveError(true);
  };

  useEffect(() => {
    if (showModal) {
      if (priority === 0) {
        form.setFieldValue(
          'maxPriorityFeePerGas',
          removeScientificNotation(0.8 * maxPriorityFeePerGas)
        );
        form.setFieldValue(
          'maxFeePerGas',
          removeScientificNotation(0.8 * maxFeePerGas)
        );
        setCustomFee((prevState) => ({
          ...prevState,
          isCustom: true,
          maxPriorityFeePerGas: 0.8 * maxPriorityFeePerGas,
          maxFeePerGas: 0.8 * maxFeePerGas,
        }));
      }
      if (priority === 1) {
        form.setFieldValue(
          'maxPriorityFeePerGas',
          removeScientificNotation(1 * maxPriorityFeePerGas)
        );
        form.setFieldValue(
          'maxFeePerGas',
          removeScientificNotation(1 * maxFeePerGas)
        );
        setCustomFee((prevState) => ({
          ...prevState,
          isCustom: false,
          maxPriorityFeePerGas: 1 * maxPriorityFeePerGas,
          maxFeePerGas: 1 * maxFeePerGas,
        }));
      }
      if (priority === 2) {
        form.setFieldValue(
          'maxPriorityFeePerGas',
          removeScientificNotation(1.2 * maxPriorityFeePerGas)
        );
        form.setFieldValue(
          'maxFeePerGas',
          removeScientificNotation(1.2 * maxFeePerGas)
        );
        setCustomFee((prevState) => ({
          ...prevState,
          isCustom: true,
          maxPriorityFeePerGas: 1.2 * maxPriorityFeePerGas,
          maxFeePerGas: 1.2 * maxFeePerGas,
        }));
      }
    }
  }, [priority, fee, showModal]);

  return (
    <Modal
      show={showModal}
      onClose={() => {
        setCustomFee((prevState) => ({
          ...prevState,
          isCustom: false,
          maxPriorityFeePerGas: 1 * maxPriorityFeePerGas,
          maxFeePerGas: 1 * maxFeePerGas,
        }));
        setIsOpen(false);
      }}
    >
      <div className="inline-block align-middle p-6 w-full max-w-2xl text-brand-white font-poppins bg-bkg-2 border border-brand-royalblue rounded-2xl shadow-xl overflow-hidden transform transition-all">
        <div className="flex flex-col items-center justify-center w-full">
          <p className="flex flex-col items-center justify-center text-center font-poppins text-xs">
            <span className="font-rubik text-base">Edit fee</span>
          </p>

          <PriorityBar
            priority={priority}
            onClick={(value) => setPriority(value)}
          />

          <Form
            validateMessages={{ default: '' }}
            className="flex flex-col gap-3 items-center justify-center my-6 py-2 w-80 md:w-full md:max-w-md"
            name="priority-form"
            id="priority-form"
            labelCol={{ span: 8 }}
            wrapperCol={{ span: 16 }}
            autoComplete="off"
            form={form}
          >
            <div className="flex flex-col items-start justify-center">
              <span className="mb-1 ml-2.5 font-bold">Gas limit</span>
              <Form.Item
                name="gasLimit"
                className="text-left"
                hasFeedback
                rules={[
                  {
                    required: false,
                    message: 'Gas limit need to be greater than 1000',
                  },
                  () => ({
                    validator(_, value) {
                      if (value > 1000) {
                        return Promise.resolve();
                      }

                      return Promise.reject();
                    },
                  }),
                ]}
                initialValue={fee?.gasLimit}
              >
                <Input
                  type="number"
                  placeholder="Gas limit"
                  className="input-extra-small relative"
                  onChange={(e) =>
                    setCustomFee((prevState) => ({
                      ...prevState,
                      isCustom: true,
                      gasLimit: +e.target.value,
                    }))
                  }
                />
              </Form.Item>
            </div>

            <div className="flex flex-col items-start justify-center">
              <span className="mb-1 ml-2.5 font-bold">Max Priority (GWEI)</span>
              <Form.Item
                name="maxPriorityFeePerGas"
                className="text-left"
                hasFeedback
                rules={[
                  {
                    required: false,
                    message: '',
                  },
                  () => ({
                    validator(_, value) {
                      if (value < customFee.maxFeePerGas) {
                        return Promise.resolve();
                      }

                      return Promise.reject();
                    },
                  }),
                ]}
              >
                <Input
                  type="number"
                  placeholder="Max priority fee (GWEI)"
                  className="input-extra-small relative"
                  onChange={(e) =>
                    setCustomFee((prevState) => ({
                      ...prevState,
                      isCustom: true,
                      maxPriorityFeePerGas: +e.target.value,
                    }))
                  }
                />
              </Form.Item>
            </div>

            <div className="flex flex-col items-start justify-center">
              <span className="mb-1 ml-2.5 font-bold">Max Fee (GWEI)</span>
              <Form.Item
                name="maxFeePerGas"
                className="text-left"
                hasFeedback
                rules={[
                  {
                    required: false,
                    message: '',
                  },
                  () => ({
                    validator(_, value) {
                      if (value <= 30 && value >= 1) {
                        return Promise.resolve();
                      }

                      return Promise.reject();
                    },
                  }),
                ]}
              >
                {/* // taxa de base + taxa de prioridade */}
                <Input
                  type="number"
                  placeholder="Max fee (GWEI)"
                  className="input-extra-small relative"
                  onChange={(e) =>
                    setCustomFee((prevState) => ({
                      ...prevState,
                      isCustom: true,
                      maxFeePerGas: +e.target.value,
                    }))
                  }
                />
              </Form.Item>
            </div>
          </Form>

          <div className="flex items-center justify-center mt-5">
            <NeutralButton
              type="submit"
              id="confirm_btn"
              onClick={handleSubmit}
            >
              Save
            </NeutralButton>
          </div>
        </div>
      </div>
    </Modal>
  );
};
