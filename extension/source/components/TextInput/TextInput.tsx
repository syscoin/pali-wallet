import React, { FC } from 'react';
import { Input, Space } from 'antd';
import { EyeInvisibleOutlined, EyeTwoTone } from '@ant-design/icons';

const TextInput: FC<{
  inputType?: string;
  className?: any;
  createPass?: boolean;
  placeholder: string;
  inputRef: any;
}> = ({
  inputType = 'text',
  // className = 'text-brand-graydark',
  createPass = false,
  placeholder = '',
  inputRef = null
}) => {
    return (
      <Space direction="vertical">
        {createPass ? (
          <Space>
            <Input.Password ref={inputRef} placeholder={placeholder} />
            <Input.Password
              ref={inputRef}
              placeholder={placeholder}
              iconRender={visible => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
            />
          </Space>
        ) : (
          <Space>
            {inputType === 'password' ? (
              <Space>
                <Input.Password
                  placeholder={placeholder}
                  iconRender={visible => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
                />
              </Space>
            ) : (
              <Space>
                <Input ref={inputRef} type={inputType} placeholder={placeholder} />
              </Space>
            )}
          </Space>
        )}
      </Space>
    );
  };

export default TextInput;
