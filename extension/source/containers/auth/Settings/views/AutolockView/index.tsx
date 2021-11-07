import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import * as yup from 'yup';
import TextInput from 'components/TextInput';
import Button from 'components/Button';
import { useController, useSettingsView } from 'hooks/index';
import Spinner from '@material-ui/core/CircularProgress';
// import { useAlert } from 'react-alert';

import { MAIN_VIEW } from '../routes';

import IWalletState from 'state/wallet/types';
import { useSelector } from 'react-redux';
import { RootState } from 'state/store';

const AutolockView = () => {
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const controller = useController();
  const { handleSubmit, register } = useForm({
    validationSchema: yup.object().shape({
      minutes: yup.number().required().integer().max(30).min(1),
    }),
  });
  const { timer }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );
  const [loading, setLoading] = useState<boolean>(false);
  // const [minutes, setMinutes] = useState<string>(String(timer));
  const showView = useSettingsView();
  // const alert = useAlert();

  const onSubmit = async (data: any) => {
    setLoading(true);
    controller.wallet.account.setAutolockTimer(data.minutes);
    setConfirmed(true);
  };

  // const handleMinutesChange = useCallback(
  //   (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
  //     setMinutes(event.target.value.replace(/[^0-9]/g, '').replace(/(\..*?)\*/g, '$1'));

  //     if (Number(event.target.value) > 30 ) {
  //       alert.removeAll();
  //       alert.error('Maximum 30 minutes of no activity.', { timeout: 2000 })
  //     }
  //   },
  //   []
  // );

  return (
    <div >
      {confirmed ? (
        <>
          {/* <span>After {minutes} minutes of no activity, your wallet will be locked.</span> */}
          <div>
            <Button
              type="button"
              onClick={() => showView(MAIN_VIEW)}
            >
              Finish
            </Button>
          </div>
        </>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)}>
          <span>You can set auto lock timer. Default is a few seconds after no activity.</span>
          <TextInput
            placeholder="Minutes"
            inputRef={register}
          />
          <span>Your wallet is set to automatically lock after {timer} minute of no activity.</span>
          <div>
            <Button
              type="button"
              onClick={() => showView(MAIN_VIEW)}
            >
              Close
            </Button>
            {loading ? (
              <div>
                <Spinner size={22} />
              </div>
            ) : (
              <Button
                type="submit"
                // disabled={loading || !minutes || Number(minutes) === timer || Number(minutes) > 30 || Number(minutes) <= 0}
              >
                Next
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
};

export default AutolockView;
