import React, { FC } from 'react';
import * as AntIcons from '@ant-design/icons';

import { ForgetWalletIcon } from './ForgetWalletIcon';

const icons = {
  appstoreadd: AntIcons.AppstoreAddOutlined,
  'arrow-down': AntIcons.ArrowDownOutlined,
  'arrow-left': AntIcons.ArrowLeftOutlined,
  'arrow-up': AntIcons.ArrowUpOutlined,
  'check-outlined': AntIcons.CheckOutlined,
  close: AntIcons.CloseOutlined,
  'close-circle': AntIcons.CloseCircleOutlined,
  check: AntIcons.CheckCircleOutlined,
  clock: AntIcons.ClockCircleOutlined,
  copy: AntIcons.CopyOutlined,
  delete: AntIcons.DeleteOutlined,
  desktop: AntIcons.LaptopOutlined,
  dolar: AntIcons.DollarOutlined,
  dots: AntIcons.MoreOutlined,
  down: AntIcons.DownOutlined,
  edit: AntIcons.EditOutlined,
  export: AntIcons.ExportOutlined,
  'file-protect': AntIcons.FileProtectOutlined,
  forget: ForgetWalletIcon,
  globe: AntIcons.GlobalOutlined,
  home: AntIcons.HomeOutlined,
  key: AntIcons.KeyOutlined,
  link: AntIcons.LinkOutlined,
  loading: AntIcons.LoadingOutlined,
  lock: AntIcons.LockOutlined,
  message: AntIcons.MessageOutlined,
  partition: AntIcons.PartitionOutlined,
  question: AntIcons.QuestionCircleOutlined,
  reload: AntIcons.ReloadOutlined,
  select: AntIcons.SelectOutlined,
  'select-down': AntIcons.CaretDownOutlined,
  'select-up': AntIcons.CaretUpOutlined,
  settings: AntIcons.SettingOutlined,
  user: AntIcons.UserOutlined,
  up: AntIcons.UpOutlined,
  verified: AntIcons.VerifiedOutlined,
  'vertical-align': AntIcons.VerticalAlignTopOutlined,
  wallet: AntIcons.WalletOutlined,
  warning: AntIcons.WarningOutlined,
};

interface IIcon {
  className?: string;
  color?: string;
  id?: string;
  name: string;
  rotate?: number;
  size?: number;
  wrapperClassname?: string;
}

export const Icon: FC<IIcon> = ({
  className,
  color,
  id,
  name,
  rotate,
  size,
  wrapperClassname,
}) => {
  const Component = icons[name];

  return (
    <div className={wrapperClassname} id={id}>
      {Component && (
        <Component
          className={className}
          style={{ fontSize: size, color }}
          rotate={rotate}
        />
      )}
    </div>
  );
};
