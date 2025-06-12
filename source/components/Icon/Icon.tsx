import * as AntIcons from '@ant-design/icons';
import React, { FC } from 'react';

// Import SVGs as URLs (following existing codebase pattern)
import Copy from '../../assets/icons/copy.svg';
import Info from '../../assets/icons/info.svg';
import Wallet from '../../assets/icons/wallet.svg';
import Metamask from '../../assets/icons/metamask.svg';
import Pali from '../../assets/icons/pali.svg';
import WhiteSuccess from '../../assets/icons/whiteSuccess.svg';
import Edit from '../../assets/icons/edit.svg';
import Network from '../../assets/icons/network.svg';
import GreenCheck from '../../assets/icons/greencheck.svg';
import WhiteErrorIcon from '../../assets/icons/errorIconWhite.svg';
import AttentionIcon from '../../assets/icons/Attention.svg';
import AddUser from '../../assets/icons/add-user.svg';
import ArrowDown from '../../assets/icons/ArrowDown.svg';
import ArrowDownLoad from '../../assets/icons/ArrowDownLoad.svg';
import ArrowLeft from '../../assets/icons/ArrowLeft.svg';
import ArrowUpBoldIcon from '../../assets/icons/ArrowUp.svg';
import Clock from '../../assets/icons/clock.svg';
import Close from '../../assets/icons/closeBigger.svg';
import DollarSign from '../../assets/icons/dollar-sign.svg';
import EditTx from '../../assets/icons/editTx.svg';
import ExternalLink from '../../assets/icons/externalExplorer.svg';
import HardWallet from '../../assets/icons/hardwalletd.svg';
import Help from '../../assets/icons/helpsuqare.svg';
import Key from '../../assets/icons/key.svg';
import Language from '../../assets/icons/language.svg';
import Lock from '../../assets/icons/lock.svg';
import ManageUser from '../../assets/icons/manage-user.svg';
import PaliDefault from '../../assets/icons/pali-default.svg';
import PaliNotDefault from '../../assets/icons/pali-not-default.svg';
import PaliWhiteSmall from '../../assets/icons/pali-white-small.svg';
import SpeedUp from '../../assets/icons/speedUp.svg';
import Trash from '../../assets/icons/trashIcon.svg';
import ImportUser from '../../assets/icons/user-imported.svg';
import Warning from '../../assets/icons/yellowWarn.svg';

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

// SVG URLs from imports (processed by build system for better caching)
const svgIcons = {
  ArrowUpBoldIcon,
  ArrowDownLoad,
  ArrowDown,
  ArrowLeft,
  Close,
  EditTx,
  externalLink: ExternalLink,
  SpeedUp,
  Trash,
  warning: Warning,
  Copy,
  Info,
  Wallet,
  Metamask,
  Pali,
  WhiteSuccess,
  Edit,
  Network,
  greenCheck: GreenCheck,
  WhiteErrorIcon,
  AttentionIcon,
  AddUser,
  Clock,
  DollarSign,
  HardWallet,
  Help,
  Key,
  Language,
  Lock,
  ManageUser,
  ImportUser,
  PaliWhiteSmall,
  PaliNotDefault,
  PaliDefault,
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
  const svgUrl = svgIcons[name];

  return (
    <div className={wrapperClassname} id={id}>
      {Component && !isSvg ? (
        <Component
          className={className}
          style={{ fontSize: size, color, opacity }}
          rotate={rotate}
          disabled={disabled}
        />
      ) : svgUrl ? (
        <img
          className={className}
          src={svgUrl}
          alt={name}
          style={{
            width: size,
            height: size,
            color,
            opacity,
            transform: rotate ? `rotate(${rotate}deg)` : undefined,
          }}
        />
      ) : (
        // Fallback for any remaining icons
        <div
          className={className}
          style={{ width: size, height: size, opacity }}
        >
          {name}
        </div>
      )}
    </div>
  );
};
