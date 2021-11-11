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
  QuestionCircleOutlined
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
}

interface IIcon {
  name: string;
  className?: string;
  maxWidth?: string;
}

export const Icon: FC<IIcon> = ({ name, className, maxWidth }) => {
  {/* @ts-ignore */}
  const Component = icons[name];

  return (
    <div className={maxWidth ? maxWidth : "w-8"}>
      {Component ? <Component className={className} /> : null}
    </div>
  );
};
