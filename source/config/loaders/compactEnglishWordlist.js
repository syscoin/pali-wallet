/* eslint-disable @typescript-eslint/no-var-requires */
const { LangEn } = require('ethers/wordlists');

module.exports = function compactEnglishWordlist(source) {
  const original = JSON.parse(source);
  const words = Array.from({ length: 2048 }, (_, index) =>
    LangEn.wordlist().getWord(index)
  );
  if (JSON.stringify(original) !== JSON.stringify(words)) {
    throw new Error('BIP39 English data differs from the canonical word list');
  }
  // Keep the original CommonJS plain-array export and a fresh mutable array.
  return (
    "const {LangEn}=require('ethers/wordlists');" +
    'module.exports=Array.from({length:2048},(_,index)=>LangEn.wordlist().getWord(index));'
  );
};
