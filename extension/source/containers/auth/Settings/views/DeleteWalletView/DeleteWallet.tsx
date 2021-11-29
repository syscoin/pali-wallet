import React from 'react';
import { Icon } from 'components/index';;
import { 
  // useController,
  useUtils } from 'hooks/index';
import { AuthViewLayout } from 'containers/common/Layout';
import { Form, Input } from 'antd';
import { useController } from 'hooks/index';
import { Header } from 'containers/common/Header';
import { WarningCard } from 'containers/common/Layout/WarningCard';

const DeleteWalletView = () => {
  // const controller = useController();
  const { 
    //alert, 
    history } = useUtils();

const onSubmit = () => {
    console.log("d")
}
const controller = useController();
  // const onSubmit = (data: any) => {
  //   if (controller.wallet.checkPassword(data.password)) {
  //     controller.wallet.deleteWallet(data.password);
  //     history.push('/app.html');

  //     return;
  //   }

  //   alert.removeAll();
  //   alert.error('Error: Invalid password');
  // };

  return (
    <>
        <Header normalHeader />
        <AuthViewLayout title="DELETE WALLET"> </AuthViewLayout>
        <div >    
        <Form
            className="flex justify-center items-center flex-col gap-4 text-center"
            name="basic"
            labelCol={{ span: 8 }}
            wrapperCol={{ span: 16 }}
            initialValues={{ remember: true }}
            onFinish={onSubmit}
            autoComplete="off"
        >
        <WarningCard> this action will delete your wallet and all accounts
                      associated with this wallet. Please make sure to back up your Wallet
                      seed phase if you would like to access this wallet and associated
                      accounts in the future. 
        </WarningCard>
        <Form.Item
          name="password"
          hasFeedback
          rules={[
            {
              required: true,
              message: ''
            },
            ({}) => ({
              validator(_, value) {
                console.log('value pass',controller.wallet.unLock(value))
                if (controller.wallet.unLock(value)) {
                  return Promise.resolve();
                }

                return Promise.reject('');
              },
            }),
          ]}
        >
            <Input size={'large'} placeholder="Enter your password" className="w-80"/>
        </Form.Item>
        <div className="text-sm pt-1 text-brand-white text-justify">
            <p className="px-7">You still have funds at wallet. Remove funds or to delete fill seed phrase below.</p>
        </div>
        <Form.Item rules={[{ required: true }]} >
            <Input.TextArea  className="bg-brand-textareabg rounded w-80 text-base" rows={3}/>
        </Form.Item>
        <div className="inline-flex">
            <button
                className="mr-14 inline-flex tracking-normal text-base leading-4 py-2.5 px-8 cursor-pointer font-light border border-brand-white transition-all duration-300 bg-gradient-to-r from-blue-500 via-pink-500 to-green-500 tracking-normal text-base rounded-full hover:from-pink-500 hover:via-green-500 hover:to-yellow-500"
                type="button"
                onClick={() => history.goBack()}
                >
                <Icon name="close" className="inline-flex self-center text-base" maxWidth={"1"} />
                  Cancel
                </button>
            <button
                className="inline-flex tracking-normal text-base leading-4 py-2.5 px-8 cursor-pointer font-light border border-brand-white transition-all duration-300 bg-gradient-to-r from-blue-500 via-pink-500 to-green-500 tracking-normal text-base rounded-full hover:from-pink-500 hover:via-green-500 hover:to-yellow-500"
                type="submit"
            >
            <Icon name="delete" className="inline-flex self-center text-base" maxWidth={"1"} />
              Delete
            </button>
        </div>
      </Form>
      </div>
    </>
  );
};

export default DeleteWalletView;
