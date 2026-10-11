import { LangEn } from 'ethers/wordlists';

/** An optional wallet password, deliberately distinct from a recovery mnemonic. */
export const generateMemorablePassword = (): string => {
  const crypto = globalThis.crypto;
  if (typeof crypto?.getRandomValues !== 'function') {
    throw new Error('Secure password generation is unavailable');
  }

  const samples = new Uint16Array(9);
  try {
    crypto.getRandomValues(samples);
    // 65,536 is divisible by the 2,048-word list, so each word is uniform.
    // Reject the last six values for an unbiased decimal digit as well.
    for (let attempts = 0; samples[8] >= 65530; attempts += 1) {
      if (attempts === 16) throw new Error('Secure password generation failed');
      crypto.getRandomValues(samples.subarray(8));
    }
    const wordlist = LangEn.wordlist();
    const words: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      words.push(wordlist.getWord(samples[index] % 2048));
    }
    words[0] = words[0][0].toUpperCase() + words[0].slice(1);
    return `${words.join('-')}-${samples[8] % 10}`;
  } finally {
    samples.fill(0);
  }
};
