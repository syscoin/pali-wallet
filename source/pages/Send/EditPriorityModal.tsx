import { Disclosure } from '@headlessui/react';
import { Form, Input } from 'antd';
import _ from 'lodash';
import React, { useMemo, useState } from 'react';

import { Modal, Icon, NeutralButton } from 'components/index';

import { PriorityBar } from './components';

export const EditPriorityModal = (props: any) => {
  const { showModal, setIsOpen, setFee, fee } = props;
  const [priority, setPriority] = useState<number>(0);
  const [customFee, setCustomFee] = useState({
    gasLimit: 0,
    maxPriorityFeePerGas: 0,
    maxFeePerGas: 0,
  });

  const maxFeePerGas = fee?.maxFeePerGas;
  const maxPriorityFeePerGas = fee?.maxPriorityFeePerGas;

  const onSubmit = () => {
    setFee((prevState: any) => {
      const filterCustomFee = _.flow([
        Object.entries,
        (arr) => arr.filter(([k, value]) => value > 0),
        Object.fromEntries,
      ])(customFee);
      return { ...prevState, ...filterCustomFee };
    });
    setIsOpen(false);

    return;
  };

  const transactionPrediction = useMemo(() => {
    const text =
      priority === 0
        ? 'Maybe in 30 seconds'
        : priority === 1
        ? 'Likely in 30 seconds'
        : 'Very likely in < 15 seconds';

    return text;
  }, [priority]);

  useMemo(() => {
    if (priority === 0) {
      setCustomFee((prevState) => ({
        ...prevState,
        maxPriorityFeePerGas: 0.8 * maxPriorityFeePerGas,
        maxFeePerGas: 0.8 * maxFeePerGas,
      }));
    }
    if (priority === 1) {
      setCustomFee((prevState) => ({
        ...prevState,
        maxPriorityFeePerGas: 1 * maxPriorityFeePerGas,
        maxFeePerGas: 1 * maxFeePerGas,
      }));
    }
    if (priority === 2) {
      setCustomFee((prevState) => ({
        ...prevState,
        maxPriorityFeePerGas: 1.2 * maxPriorityFeePerGas,
        maxFeePerGas: 1.2 * maxFeePerGas,
      }));
    }
  }, [priority]);

  return (
    <Modal show={showModal} onClose={() => setIsOpen(false)}>
      <div className="inline-block align-middle p-6 w-full max-w-2xl text-brand-white font-poppins bg-bkg-2 border border-brand-royalblue rounded-2xl shadow-xl overflow-hidden transform transition-all">
        <div className="flex flex-col items-center justify-center w-full">
          <p className="flex flex-col items-center justify-center text-center font-poppins text-xs">
            <span className="font-rubik text-base">Edit fee</span>
            <span className="mt-4">{transactionPrediction}</span>
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
          >
            <Form.Item
              name="gas-limit"
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
            >
              <Input
                type="number"
                placeholder="Gas limit"
                className="input-extra-small relative"
                onChange={(e) =>
                  setCustomFee((prevState) => ({
                    ...prevState,
                    gasLimit: +e.target.value,
                  }))
                }
              />
            </Form.Item>

            <Form.Item
              name="max-priority-fee"
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
              <Input
                type="number"
                placeholder="Max priority fee (GWEI)"
                className="input-extra-small relative"
                onChange={(e) =>
                  setCustomFee((prevState) => ({
                    ...prevState,
                    maxPriorityFeePerGas: +e.target.value,
                  }))
                }
              />
            </Form.Item>

            <Form.Item
              name="max-fee"
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
                    maxFeePerGas: +e.target.value,
                  }))
                }
              />
            </Form.Item>
          </Form>

          <div className="flex items-center justify-center mt-5">
            <NeutralButton type="submit" id="confirm_btn" onClick={onSubmit}>
              Save
            </NeutralButton>
          </div>
        </div>
      </div>
    </Modal>
  );
};
