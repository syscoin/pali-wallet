import * as AntIcons from '@ant-design/icons';
import React, { FC } from 'react';

import { ExternalLinkIcon } from './ExternalLinkIcon';
import { ForgetWalletIcon } from './ForgetWalletIcon';
import { LoaderIcon } from './LoaderIcon';
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
  file: AntIcons.FileFilled,
  'file-protect': AntIcons.FileProtectOutlined,
  forget: ForgetWalletIcon,
  globe: AntIcons.GlobalOutlined,
  home: AntIcons.HomeOutlined,
  key: AntIcons.KeyOutlined,
  link: AntIcons.LinkOutlined,
  loading: LoaderIcon,
  lock: AntIcons.LockOutlined,
  message: AntIcons.MessageOutlined,
  partition: AntIcons.PartitionOutlined,
  question: AntIcons.QuestionCircleOutlined,
  reload: AntIcons.ReloadOutlined,
  rise: AntIcons.RiseOutlined,
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
  trash: AntIcons.DeleteOutlined,
  'external-link': ExternalLinkIcon,
  tag: AntIcons.TagFilled,
  import: AntIcons.ImportOutlined,
  'hamburger-menu': AntIcons.MenuOutlined,
};

const svgIcons = {
  ArrowUpBoldIcon: '../../assets/icons/ArrowUp.svg',
  ArrowDownLoad: '../../assets/icons/ArrowDownLoad.svg',
  ArrowDown: '../../assets/icons/ArrowDown.svg',
  ArrowLeft: '../../assets/icons/ArrowLeft.svg',
  Close: '../../assets/icons/closeBigger.svg',
  EditTx: '/assets/icons/editTx.svg',
  externalLink: '../../assets/icons/externalExplorer.svg',
  SpeedUp: '../../assets/icons/speedUp.svg',
  Trash: '../../assets/icons/trashIcon.svg',
  warning: '../../assets/icons/yellowWarn.svg',
  Copy: '/assets/icons/copy.svg',
  Info: '/assets/icons/info.svg',
  WhiteSuccess: '/assets/icons/whiteSuccess.svg',
  Edit: '/assets/icons/edit.svg',
  Network: '/assets/icons/network.svg',
  greenCheck: '/assets/icons/greencheck.svg',
  WhiteErrorIcon: '/assets/icons/errorIconWhite.svg',
  AttentionIcon: '/assets/icons/Attention.svg',
  AddUser: '/assets/icons/add-user.svg',
  Clock: '/assets/icons/clock.svg',
  DollarSign: '/assets/icons/dollar-sign.svg',
  HardWallet: '/assets/icons/hardwalletd.svg',
  Help: '/assets/icons/helpsuqare.svg',
  Key: '/assets/icons/key.svg',
  Language: '/assets/icons/language.svg',
  Lock: '/assets/icons/lock.svg',
  ManageUser: '/assets/icons/manage-user.svg',
  ImportUser: '/assets/icons/user-imported.svg',
};

interface IIcon {
  className?: string;
  color?: string;
  disabled?: boolean;
  id?: string;
  isSvg?: boolean;
  name: string;
  opacity?: number;
  rotate?: number;
  size?: number | string;
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
  disabled,
  opacity,
  isSvg,
}) => {
  const Component = icons[name];
  const svg = svgIcons[name];

  return (
    <div className={wrapperClassname} id={id}>
      {Component && !isSvg ? (
        <Component
          className={className}
          style={{ fontSize: size, color, opacity }}
          rotate={rotate}
          disabled={disabled}
        />
      ) : (
        <img
          className={className}
          src={svg}
          style={{ width: size, color, opacity }}
        />
      )}
    </div>
  );
};
