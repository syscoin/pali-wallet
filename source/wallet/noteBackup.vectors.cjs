/* eslint-disable @typescript-eslint/no-var-requires -- Node-only independent vector generator. */
// Deterministic synthetic vectors. No production codec or wallet inputs are used.
const { pbkdf2Sync, createCipheriv, createHash } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const note = (n, amount = '1') =>
  `tornado-eth-${amount}-1-0x${n.toString(16).padStart(124, '0')}`;
const cases = [
  {
    name: 'empty',
    password: 'Synthetic café password',
    payload: {
      format: 'pali-private-notes',
      version: 1,
      createdAt: 1700000000000,
      notes: [],
    },
  },
  {
    name: 'history-and-uncertainty',
    password: 'Synthetic café password 🔐',
    payload: {
      format: 'pali-private-notes',
      version: 1,
      createdAt: 1700000000000,
      notes: [
        {
          note: note(1),
          createdAt: 1699999999000,
          reconciliationRequired: true,
          history: {
            deposits: [
              {
                outcome: 'submitted',
                from: '0x' + '11'.repeat(20),
                nonce: '7',
                transactionHash: '0x' + '22'.repeat(32),
              },
            ],
            withdrawals: [
              { outcome: 'unknown', mode: 'relayed', jobId: 'synthetic_job_1' },
              { outcome: 'unknown', mode: 'relayed', jobId: 'synthetic_job_2' },
            ],
          },
        },
        {
          note: note(2, '0.1'),
          createdAt: 1699999999001,
          reconciliationRequired: true,
          history: {
            withdrawals: [
              {
                outcome: 'unknown',
                mode: 'direct',
                from: '0x' + '33'.repeat(20),
                nonce: '18446744073709551615',
              },
            ],
          },
        },
      ],
    },
  },
  {
    name: 'decomposed-password',
    password: 'Synthetic cafe\u0301 password',
    payload: {
      format: 'pali-private-notes',
      version: 1,
      createdAt: 0,
      notes: [
        { note: note(3, '100'), createdAt: 0, reconciliationRequired: true },
      ],
    },
  },
];
const vectors = cases.map((entry, index) => {
  const salt = Buffer.from(
    Array.from({ length: 32 }, (_, i) => (i + index * 3) & 255)
  );
  const nonce = Buffer.from(
    Array.from({ length: 12 }, (_, i) => (32 + i + index * 3) & 255)
  );
  const plain = Buffer.from(JSON.stringify(entry.payload), 'utf8');
  const header = Buffer.alloc(64);
  header.write('PALINOTE', 0, 'ascii');
  header.set([1, 1, 1, 0], 8);
  salt.copy(header, 12);
  nonce.copy(header, 44);
  header.writeUInt32BE(plain.length + 16, 56);
  const key = pbkdf2Sync(
    Buffer.from(entry.password, 'utf8'),
    salt,
    900000,
    32,
    'sha512'
  );
  const cipher = createCipheriv('aes-256-gcm', key, nonce, {
    authTagLength: 16,
  });
  cipher.setAAD(header);
  const ciphertext = Buffer.concat([
    cipher.update(plain),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const file = Buffer.concat([header, ciphertext]);
  key.fill(0);
  return {
    ...entry,
    saltHex: salt.toString('hex'),
    nonceHex: nonce.toString('hex'),
    fileHex: file.toString('hex'),
    fileSha256: createHash('sha256').update(file).digest('hex'),
  };
});
writeFileSync(
  join(__dirname, 'noteBackup.vectors.json'),
  JSON.stringify(
    {
      provenance:
        'Synthetic test data only. Independently assembled with node:crypto pbkdf2Sync/createCipheriv, fixed 900000 SHA512 iterations and AES-256-GCM; no codec helper imported.',
      vectors,
    },
    null,
    2
  ) + '\n'
);
console.log('Generated ' + vectors.length + ' synthetic vectors');
