import React from 'react';
// import { Button } from 'components/index';;
// import { useController, useUtils, useStore } from 'hooks/index';
// import IWalletState from 'state/wallet/types';
// import { useSelector } from 'react-redux';
// import { RootState } from 'state/store';
import ViewLayout from '../Layout';
// import { useHistory } from 'react-router-dom';

const AutolockView = () => {
  // const [confirmed, setConfirmed] = useState<boolean>(false);
  // const controller = useController();
  // const { timer } = useStore();
  // const { alert } = useUtils();

  // const [loading, setLoading] = useState<boolean>(false);
  // const [minutes, setMinutes] = useState<string>(String(timer));
  // const history = useHistory();

  // const onSubmit = async (data: any) => {
  //   setLoading(true);
  //   controller.wallet.account.setAutolockTimer(data.minutes);
  //   setConfirmed(true);
  // };

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
    <ViewLayout title="AUTO LOCK TIMER">
      <p>auto lock timer</p>
    </ViewLayout>
  );
};

export default AutolockView;
