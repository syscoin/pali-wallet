import * as ethersModule from 'ethers';

const ethersAny = (ethersModule as any).ethers ?? ethersModule;
const utilsAny = ethersAny.utils ?? ethersAny;
const providersAny = ethersAny.providers ?? ethersAny;

const AbiCoderImpl =
  ethersAny.AbiCoder ??
  utilsAny.AbiCoder ??
  class {
    static defaultAbiCoder() {
      return utilsAny.defaultAbiCoder;
    }
  };

export type Block = any;
export type Contract = any;
export type Interface = any;
export type Provider = any;
export type Result = any;
export type TransactionReceipt = any;
export type TransactionResponse = any;

export const AbiCoder: any = AbiCoderImpl;
export const Contract: any = ethersAny.Contract;
const InterfaceImpl: any = ethersAny.Interface ?? utilsAny.Interface;
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
export const JsonRpcProvider: any = providersAny.JsonRpcProvider;
export const Signature: any = ethersAny.Signature;
export const TypedDataEncoder: any =
  ethersAny.TypedDataEncoder ?? utilsAny._TypedDataEncoder;
export const Wallet: any = ethersAny.Wallet;
export const ZeroAddress: string =
  ethersAny.ZeroAddress ?? ethersAny.constants?.AddressZero;
export const defaultAbiCoder = AbiCoder.defaultAbiCoder
  ? AbiCoder.defaultAbiCoder()
  : utilsAny.defaultAbiCoder;
export const AddressZero = ZeroAddress;
export const concat: any = ethersAny.concat ?? utilsAny.hexConcat;
export const dataSlice: any = ethersAny.dataSlice ?? utilsAny.hexDataSlice;
export const encodeBytes32String: any =
  ethersAny.encodeBytes32String ?? utilsAny.formatBytes32String;
export const getAddress: any = ethersAny.getAddress ?? utilsAny.getAddress;
export const getBytes: any = ethersAny.getBytes ?? utilsAny.arrayify;
export const hexlify: any = ethersAny.hexlify ?? utilsAny.hexlify;
export const id: any = ethersAny.id ?? utilsAny.id;
export const isAddress: any = ethersAny.isAddress ?? utilsAny.isAddress;
export const isHexString: any = ethersAny.isHexString ?? utilsAny.isHexString;
export const keccak256: any = ethersAny.keccak256 ?? utilsAny.keccak256;
export const namehash: any = ethersAny.namehash ?? utilsAny.namehash;
export const toBeHex: any = ethersAny.toBeHex ?? utilsAny.hexlify;
export const toUtf8Bytes: any = ethersAny.toUtf8Bytes ?? utilsAny.toUtf8Bytes;
export const zeroPadValue: any = ethersAny.zeroPadValue ?? utilsAny.hexZeroPad;
export const arrayify = getBytes;
export const hexConcat = concat;
export const hexDataSlice = dataSlice;
export const hexZeroPad = zeroPadValue;
export const formatBytes32String = encodeBytes32String;
export const hashMessage: any = ethersAny.hashMessage ?? utilsAny.hashMessage;
export const _TypedDataEncoder = TypedDataEncoder;
const ethersParseUnits: any = ethersAny.parseUnits ?? utilsAny.parseUnits;
const ethersParseEther: any = ethersAny.parseEther ?? utilsAny.parseEther;
const ethersFormatUnits: any = ethersAny.formatUnits ?? utilsAny.formatUnits;
const ethersFormatEther: any = ethersAny.formatEther ?? utilsAny.formatEther;

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
  if (value == null) return BigInt(0);
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

export const parseUnits = (value: string, unit?: string | number) =>
  BigNumberCompat.from(ethersParseUnits(value, unit));

export const parseEther = (value: string) =>
  BigNumberCompat.from(ethersParseEther(value));

export const formatUnits = (value: BigNumberish, unit?: string | number) =>
  ethersFormatUnits(toBigIntValue(value), unit);

export const formatEther = (value: BigNumberish) =>
  ethersFormatEther(toBigIntValue(value));
