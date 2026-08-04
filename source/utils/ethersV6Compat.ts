import {
  AbiCoder as EthersAbiCoder,
  encodeBytes32String as ethersEncodeBytes32String,
  Interface as EthersInterface,
} from 'ethers/abi';
import {
  getAddress as ethersGetAddress,
  isAddress as ethersIsAddress,
} from 'ethers/address';
import { Contract as EthersContract } from 'ethers/contract';
import {
  keccak256 as ethersKeccak256,
  Signature as EthersSignature,
} from 'ethers/crypto';
import {
  hashMessage as ethersHashMessage,
  id as ethersId,
  namehash as ethersNamehash,
  TypedDataEncoder as EthersTypedDataEncoder,
} from 'ethers/hash';
import { JsonRpcProvider as EthersJsonRpcProvider } from 'ethers/providers';
import {
  concat as ethersConcat,
  dataSlice as ethersDataSlice,
  formatEther as ethersFormatEther,
  formatUnits as ethersFormatUnits,
  getBytes as ethersGetBytes,
  hexlify as ethersHexlify,
  isHexString as ethersIsHexString,
  parseEther as ethersParseEther,
  parseUnits as ethersParseUnits,
  toBeHex as ethersToBeHex,
  toUtf8Bytes as ethersToUtf8Bytes,
  zeroPadValue as ethersZeroPadValue,
} from 'ethers/utils';
import { Wallet as EthersWallet } from 'ethers/wallet';

export type Block = any;
export type Contract = any;
export type Interface = any;
export type Provider = any;
export type Result = any;
export type TransactionReceipt = any;
export type TransactionResponse = any;

export const AbiCoder: any = EthersAbiCoder;
export const Contract: any = EthersContract;
const InterfaceImpl: any = EthersInterface;
if (InterfaceImpl?.prototype && !InterfaceImpl.prototype.getSighash) {
  InterfaceImpl.prototype.getSighash = function getSighash(fragment: any) {
    return this.getFunction(fragment).selector;
  };
}
if (InterfaceImpl?.prototype && !InterfaceImpl.prototype.getEventTopic) {
  InterfaceImpl.prototype.getEventTopic = function getEventTopic(
    fragment: any
  ) {
    return this.getEvent(fragment).topicHash;
  };
}
export const Interface: any = InterfaceImpl;
export const JsonRpcProvider: any = EthersJsonRpcProvider;
export const Signature: any = EthersSignature;
export const TypedDataEncoder: any = EthersTypedDataEncoder;
export const Wallet: any = EthersWallet;
export const ZeroAddress: string = '0x0000000000000000000000000000000000000000';
export const defaultAbiCoder = AbiCoder.defaultAbiCoder();
export const AddressZero = ZeroAddress;
export const concat: any = ethersConcat;
export const dataSlice: any = ethersDataSlice;
export const encodeBytes32String: any = ethersEncodeBytes32String;
export const getAddress: any = ethersGetAddress;
export const getBytes: any = ethersGetBytes;
export const hexlify: any = ethersHexlify;
export const id: any = ethersId;
export const isAddress: any = ethersIsAddress;
export const isHexString: any = ethersIsHexString;
export const keccak256: any = ethersKeccak256;
export const namehash: any = ethersNamehash;
export const toBeHex: any = ethersToBeHex;
export const toUtf8Bytes: any = ethersToUtf8Bytes;
export const zeroPadValue: any = ethersZeroPadValue;
export const arrayify = getBytes;
export const hexConcat = concat;
export const hexDataSlice = dataSlice;
export const hexZeroPad = zeroPadValue;
export const formatBytes32String = encodeBytes32String;
export const hashMessage: any = ethersHashMessage;
export const _TypedDataEncoder = TypedDataEncoder;

export type BigNumberish =
  | bigint
  | number
  | string
  | BigNumberCompat
  | {
      _hex?: string;
      hex?: string;
      toHexString?: () => string;
      toString?: () => string;
    };

const toBigIntValue = (value: BigNumberish | null | undefined): bigint => {
  if (value === null || value === undefined) return BigInt(0);
  if (value instanceof BigNumberCompat) return value.value;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  if (typeof value === 'string') {
    if (!value) return BigInt(0);
    return BigInt(value);
  }
  const hex = value._hex ?? value.hex ?? value.toHexString?.();
  if (hex) return BigInt(hex);
  if (value.toString) return BigInt(value.toString());
  return BigInt(0);
};

export class BigNumberCompat {
  readonly _isBigNumber = true;
  readonly value: bigint;

  private constructor(value: BigNumberish | null | undefined) {
    this.value = toBigIntValue(value);
  }

  static from(value: BigNumberish | null | undefined) {
    return new BigNumberCompat(value);
  }

  static isBigNumber(value: unknown): value is BigNumberCompat {
    return (
      value instanceof BigNumberCompat || Boolean((value as any)?._isBigNumber)
    );
  }

  get _hex() {
    return this.toHexString();
  }

  get hex() {
    return this.toHexString();
  }

  add(value: BigNumberish) {
    return BigNumberCompat.from(this.value + toBigIntValue(value));
  }

  sub(value: BigNumberish) {
    return BigNumberCompat.from(this.value - toBigIntValue(value));
  }

  mul(value: BigNumberish) {
    return BigNumberCompat.from(this.value * toBigIntValue(value));
  }

  div(value: BigNumberish) {
    return BigNumberCompat.from(this.value / toBigIntValue(value));
  }

  abs() {
    return BigNumberCompat.from(
      this.value < BigInt(0) ? -this.value : this.value
    );
  }

  pow(value: BigNumberish) {
    let result = BigInt(1);
    const exponent = toBigIntValue(value);
    for (let i = BigInt(0); i < exponent; i += BigInt(1)) {
      result *= this.value;
    }
    return BigNumberCompat.from(result);
  }

  shl(value: BigNumberish) {
    return BigNumberCompat.from(this.value << toBigIntValue(value));
  }

  or(value: BigNumberish) {
    return BigNumberCompat.from(this.value | toBigIntValue(value));
  }

  eq(value: BigNumberish) {
    return this.value === toBigIntValue(value);
  }

  lt(value: BigNumberish) {
    return this.value < toBigIntValue(value);
  }

  lte(value: BigNumberish) {
    return this.value <= toBigIntValue(value);
  }

  gt(value: BigNumberish) {
    return this.value > toBigIntValue(value);
  }

  gte(value: BigNumberish) {
    return this.value >= toBigIntValue(value);
  }

  isZero() {
    return this.value === BigInt(0);
  }

  isNegative() {
    return this.value < BigInt(0);
  }

  toBigInt() {
    return this.value;
  }

  toHexString() {
    const sign = this.value < BigInt(0) ? '-' : '';
    const abs = this.value < BigInt(0) ? -this.value : this.value;
    const hex = abs.toString(16);
    return `${sign}0x${hex.length % 2 ? `0${hex}` : hex}`;
  }

  toJSON() {
    return {
      type: 'BigNumber',
      hex: this.toHexString(),
    };
  }

  toNumber() {
    return Number(this.value);
  }

  toString() {
    return this.value.toString();
  }
}

export { BigNumberCompat as BigNumber };

export const toEthersBigNumberish = (value: BigNumberish | null | undefined) =>
  toBigIntValue(value);

const normalizeUnit = (unit?: string | number) => {
  if (typeof unit !== 'string') return unit;

  const trimmed = unit.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : unit;
};

export const parseUnits = (value: string, unit?: string | number) =>
  BigNumberCompat.from(ethersParseUnits(value, normalizeUnit(unit)));

export const parseEther = (value: string) =>
  BigNumberCompat.from(ethersParseEther(value));

export const formatUnits = (value: BigNumberish, unit?: string | number) =>
  ethersFormatUnits(toBigIntValue(value), normalizeUnit(unit));

export const formatEther = (value: BigNumberish) =>
  ethersFormatEther(toBigIntValue(value));
