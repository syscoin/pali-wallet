import AccountController from './AccountController';
import WalletController from './WalletController';

describe('AccountController tests', () => {
  const { checkPassword } = WalletController();

  const { decryptAES } = AccountController({
    checkPassword: () => checkPassword('secret'),
  });

  it('should encrypt and decrypt string correctly', () => {
    const value = 'test';

    const encrypt = CryptoJS.AES.encrypt(value, 'secret');
    const decrypt = decryptAES(encrypt.toString(), 'secret');

    expect(decrypt).toBe(value);
  });
});
