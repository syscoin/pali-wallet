import React from 'react';
import Button from 'components/Button';
import Link from 'components/Link';
import { useController } from 'hooks/index';
import LogoImage from 'assets/images/logo.svg';
import { Form, Input } from 'antd';


const Starter = () => {
  const controller = useController();
  // const [isInvalid, setInvalid] = useState<boolean>(false);

  const onSubmit = (data: any) => {
    // setInvalid(!controller.wallet.unLock(data.password));
    controller.wallet.unLock(data.password);
  };

  return (
    <div>
      <h1 className="heading-start full-width t-roboto t-royalBlue">
        <p>Welcome to</p>
        <br />
        Pali Wallet
      </h1>
      <img src={LogoImage} alt="syscoin" />
      <Form
        name="basic"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 16 }}
        initialValues={{ remember: true }}
        onFinish={onSubmit}
        autoComplete="off"
      >
        <Form.Item
          label="Password"
          name="password"
          hasFeedback
          tooltip="You will need this password to create your wallet."
          rules={[
            {
              required: true,
              message: 'Password is a required field.'
            },
            {
              pattern: /^(?=.*[a-z])(?=.*[0-9])(?=.{8,})/,
              message: 'Please, check the requirements below.'
            }
          ]}
        >
          <Input.Password className="bg-brand-graymedium" />
        </Form.Item>
        <Button
          type="submit"
        >
          Unlock
        </Button>
      </Form>
      <Link to="/import">
        Import using wallet seed phrase
      </Link>
    </div>
  );
};

export default Starter;
