import React from 'react';
// import { Button, Icon } from 'components/index';;
// import { useController, useFormat, useUtils } from 'hooks/index';
import LogoImage from 'assets/images/logo-s.svg';
// import { MAIN_VIEW } from '../routes';
import { AuthViewLayout } from 'containers/common/Layout';
import { Form, Input } from 'antd';
import { Button } from 'components/Button';
import { AccountCreated } from './AccountCreated';

const NewAccountView = () => {
  // const [address, setAddress] = useState<string | undefined>();
  // const controller = useController();
  // const { ellipsis } = useFormat();
  // const { history } = useUtils();
  // const [isCopied, copyText] = useCopyClipboard();
  // const [loading, setLoading] = useState<boolean>(false);

  // const onSubmit = async (data: any) => {
  //   setLoading(true);
  //   const res = await controller.wallet.account.addNewAccount(data.name);

  //   if (res) {
  //     setAddress(res);
  //     setLoading(false);

  //     await controller.wallet.account.updateTokensState();
  //   }
  // };
  const accountCreate = false;
  const accountCreated = true;
  return (
    <>
      {accountCreate && (
        <>
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
          </AuthViewLayout>
          <div className="flex justify-center items-center flex-col min-w-full">
            <div>
              <img
                src={`/${LogoImage}`}
                className="mx-auto w-36 rounded-full"
                alt="Syscoin"
              />
            </div>
            <div className="pb-8">
              <p className="text-white">Select Avatar</p>
            </div>
            <Form
              className="flex justify-center items-center flex-col gap-4 text-center"
              name="basic"
              labelCol={{ span: 8 }}
              wrapperCol={{ span: 16 }}
              initialValues={{ remember: true }}
              autoComplete="off"
            >
              <Form.Item
                name="Username"
                rules={[
                  { required: true, message: 'Please input your username!' },
                ]}
              >
                <Input className="w-80 rounded-full h-10 bg-brand-navydarker" />
              </Form.Item>
            </Form>
            <div className="pt-40">
              <Button type="submit">Save</Button>
            </div>
          </div>
        </>
      )}
      {accountCreated && (
          <AccountCreated />
      )}
    </>
  );
};

export default NewAccountView;
