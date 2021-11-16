import React from 'react';
// import { Button, Icon } from 'components/index';;
// import { useController, useFormat } from 'hooks/index';

// import { MAIN_VIEW } from '../routes';
import { AuthViewLayout } from 'containers/common/Layout';
// import { useHistory } from 'react-router-dom';

const NewAccountView = () => {
  // const [address, setAddress] = useState<string | undefined>();
  // const controller = useController();
  // const { ellipsis } = useFormat();
  // const [isCopied, copyText] = useCopyClipboard();
  // const [loading, setLoading] = useState<boolean>(false);
  // const history = useHistory();

  // const onSubmit = async (data: any) => {
  //   setLoading(true);
  //   const res = await controller.wallet.account.addNewAccount(data.name);

  //   if (res) {
  //     setAddress(res);
  //     setLoading(false);

  //     await controller.wallet.account.updateTokensState();
  //   }
  // };

  return (
    <AuthViewLayout title="CREATE ACCOUNT">
      {/* <span>Your new account has been created</span>
      <span>Click to copy your public address:</span>
      <span
      // onClick={() => {
      //   copyText(address);
      // }}
      >
        {ellipsis(address)}
      </span>
      <div>
        <Button
          type="button"
          onClick={() => history.push('/home')}
        >
          Finish
        </Button>
      </div> */}

      {/* <form>
        <span>Please name your new account:</span>
        <input type="text" />
        <div>
          <Button
            type="button"
            onClick={() => history.push('/home')}
          >
            Close
          </Button>
          {loading ? (
            <div>
              <Icon name="loading" className="w-4 bg-brand-graydark100 text-brand-white" />
            </div>
          ) : (
            <Button
              type="submit"
              disabled={loading}
            >
              Next
            </Button>
          )}
        </div>
      </form> */}
      <p>new account</p>
    </AuthViewLayout>
  );
};

export default NewAccountView;
