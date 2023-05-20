export const zerosRepeatingAtStartOfEvmBalance = (balance: string) => {
  const ZERO_IN_STRING = '0';
  return balance.replace('.', '').startsWith(ZERO_IN_STRING.repeat(6));
};
