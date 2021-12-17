import React, { FC } from 'react';
import {
  LoadingOutlined,
  ArrowDownOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  ArrowUpOutlined,
  VerticalAlignTopOutlined,
  CopyOutlined,
  ArrowLeftOutlined,
  ExportOutlined,
  LinkOutlined,
  ClockCircleOutlined,
  FileProtectOutlined,
  WarningOutlined,
  KeyOutlined,
  UserOutlined,
  PartitionOutlined,
  LockOutlined,
  MoreOutlined,
  QuestionCircleOutlined,
  SettingOutlined,
  HomeOutlined,
  DollarOutlined,
  WalletOutlined,
  DeleteOutlined,
  CloseOutlined,
  SelectOutlined,
  DownOutlined,
  UpOutlined,
  CaretDownOutlined,
  GlobalOutlined,
  AppstoreAddOutlined,
  EditOutlined,
  CheckCircleOutlined,
  CaretUpOutlined,
  MessageOutlined
} from '@ant-design/icons';

const icons = {
  'loading': LoadingOutlined,
  'arrow-down': ArrowDownOutlined,
  'close-circle': CloseCircleOutlined,
  'reload': ReloadOutlined,
  'arrow-up': ArrowUpOutlined,
  'vertical-align': VerticalAlignTopOutlined,
  'copy': CopyOutlined,
  'arrow-left': ArrowLeftOutlined,
  'export': ExportOutlined,
  'link': LinkOutlined,
  'clock': ClockCircleOutlined,
  'file-protect': FileProtectOutlined,
  'warning': WarningOutlined,
  'key': KeyOutlined,
  'user': UserOutlined,
  'partition': PartitionOutlined,
  'lock': LockOutlined,
  'dots': MoreOutlined,
  'question': QuestionCircleOutlined,
  'settings': SettingOutlined,
  'home': HomeOutlined,
  'dolar': DollarOutlined,
  'wallet': WalletOutlined,
  'delete': DeleteOutlined, 
  'close': CloseOutlined,
  'select': SelectOutlined,
  'down': DownOutlined,
  'up': UpOutlined,
  'select-down': CaretDownOutlined,
  'globe': GlobalOutlined,
  'appstoreadd': AppstoreAddOutlined,
  'edit': EditOutlined,
  'check': CheckCircleOutlined,
  'select-up': CaretUpOutlined,
  'message': MessageOutlined
}

interface IIcon {
  name: string;
  className?: string;
  wrapperClassname?: string;
  rotate?: number
}

export const Icon: FC<IIcon> = ({
  name,
  className,
  wrapperClassname,
  rotate
}) => {
  const Component = icons[name];

  return (
    <div className={wrapperClassname ? wrapperClassname : "w-8"}>
      {Component ? <Component className={className}  rotate={rotate} /> : null}
    </div>
  );
};
