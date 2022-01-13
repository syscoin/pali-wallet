const CryptoJS = require('crypto-js');
const bech32 = require('bech32');
const sys = require('syscoinjs-lib');
const { initialMockState, SYS_NETWORK } = require('../state/store');

const decryptAES = (encryptedString, key) => {
  return CryptoJS.AES.decrypt(encryptedString, key).toString(CryptoJS.enc.Utf8);
};
const isValidSYSAddress = (address, network, verification = true) => {
  let resAddress;
  let encode;
  if (!verification) {
    return true;
  }

  if (address && typeof address === 'string') {
    try {
      resAddress = bech32.decode(address);

      if (network === 'main' && resAddress.prefix === 'sys') {
        encode = bech32.encode(resAddress.prefix, resAddress.words);

        return encode === address.toLowerCase();
      }

      if (network === 'testnet' && resAddress.prefix === 'tsys') {
        encode = bech32.encode(resAddress.prefix, resAddress.words);

        return encode === address.toLowerCase();
      }
    } catch (error) {
      return false;
    }
  }

  return false;
};

const getTransactionInfoByTxId = (txid) =>
  sys.utils.fetchBackendRawTx(SYS_NETWORK.main.beUrl, txid);

describe('Account Test', () => {
  it('should return a decrypt string', () => {
    const value = 'test';
    const encrypt = CryptoJS.AES.encrypt(value, 'test123');
    const decrypt = decryptAES(encrypt.toString(), 'test123');
    expect(decrypt).toBe(value);
  });
  it('should return a sys address verification', () => {
    const invalidSysAddress = 'sys213ixks1mx';
    const value = isValidSYSAddress(invalidSysAddress, 'main');
    expect(value).toBeFalsy();
  });
  it('should return a transaction information', async () => {
    const result = await getTransactionInfoByTxId(
      initialMockState.accounts[0].transactions[0].txid
    );
    console.log(result);
  });
});
