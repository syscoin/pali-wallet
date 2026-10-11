type PersonalSignError =
  | 'send.signingForWrongAddress'
  | 'send.suspiciousSignInRequest';

export interface IPersonalSignReview {
  error?: PersonalSignError;
  message: string;
}

const SIWE_PHRASE = 'wants you to sign in with your Ethereum account';
const REG_NAME = "(?:[A-Za-z0-9._~!$&'()*+,;=-]|%[A-Fa-f0-9]{2})";
const URI_PCHAR = "(?:[A-Za-z0-9._~!$&'()*+,;=:@-]|%[A-Fa-f0-9]{2})";
const PCHAR = new RegExp(`^${URI_PCHAR}*$`);
const URI_AUTHORITY = `(?:(?:${REG_NAME}|:)*@)?(?:\\[(?:[A-Fa-f0-9:.]+|[vV][A-Fa-f0-9]+\\.[A-Za-z0-9._~!$&'()*+,;=:-]+)\\]|${REG_NAME}*)(?::[0-9]*)?`;
const URI_PATH = `(?:/${URI_PCHAR}*)*`;
const URI = new RegExp(
  `^[A-Za-z][A-Za-z0-9+.-]*:(?://${URI_AUTHORITY}${URI_PATH}|/(?:${URI_PCHAR}+${URI_PATH})?|${URI_PCHAR}+${URI_PATH}|)(?:\\?(?:${URI_PCHAR}|[/?])*)?(?:#(?:${URI_PCHAR}|[/?])*)?$`
);
const STATEMENT = /^[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;= ]*$/;

const isUri = (value: string) => {
  if (!URI.test(value)) return false;
  const literal = value.match(
    /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*?(\[[^\]]+\])/
  );
  if (!literal || /^\[[vV]/.test(literal[1])) return true;
  try {
    new URL(`https://${literal[1]}`); // Validate the IPv6 production, too.
    return true;
  } catch {
    return false;
  }
};

const isDateTime = (value: string) => {
  if (
    !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[Tt]([01]\d|2[0-3]):[0-5]\d:([0-5]\d|60)(\.\d+)?([Zz]|[+-]([01]\d|2[0-3]):[0-5]\d)$/.test(
      value
    )
  )
    return false;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
};

// ERC-4361 domain is an authority, with an optional scheme on the first line.
// Validate before URL normalization: a URL parser alone would discard userinfo
// or a path and could accept a misleading sign-in header for the same origin.
const getSiweOrigin = (header: string): string | null => {
  const schemeMatch = header.match(/^([A-Za-z][A-Za-z0-9+.-]*):\/\//);
  const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : 'https';
  const authority = schemeMatch ? header.slice(schemeMatch[0].length) : header;
  if (
    (scheme !== 'https' && scheme !== 'http') ||
    !/^(?:\[[A-Fa-f0-9:.]+\]|(?:[A-Za-z0-9._~!$&'()*+,;=-]|%[A-Fa-f0-9]{2})+)(?::\d+)?$/.test(
      authority
    )
  )
    return null;
  try {
    return new URL(`${scheme}://${authority}`).origin;
  } catch {
    return null;
  }
};

const parseSiwe = (text: string) => {
  const lines = text.split('\n');
  const header = lines[0]?.match(
    /^([^\s]+) wants you to sign in with your Ethereum account:$/
  );
  if (!header || !/^0x[A-Fa-f0-9]{40}$/.test(lines[1] || '') || lines[2] !== '')
    return null;

  // The optional statement occupies one line, followed by the required blank.
  let index = 3;
  if (lines[index] !== '') {
    if (!STATEMENT.test(lines[index] || '')) return null;
    index += 1;
  } else if (lines[index + 1] === '') {
    index += 1; // An explicitly empty statement is also permitted by the ABNF.
  }
  if (lines[index++] !== '') return null;

  const field = (name: string, validate: (value: string) => boolean) => {
    const prefix = `${name}: `;
    const line = lines[index++];
    return line?.startsWith(prefix) && validate(line.slice(prefix.length));
  };
  if (
    !field('URI', isUri) ||
    !field('Version', (value) => value === '1') ||
    !field('Chain ID', (value) => /^\d+$/.test(value)) ||
    !field('Nonce', (value) => /^[A-Za-z0-9]{8,}$/.test(value)) ||
    !field('Issued At', isDateTime)
  )
    return null;
  for (const name of ['Expiration Time', 'Not Before', 'Request ID']) {
    if (lines[index]?.startsWith(`${name}: `)) {
      if (
        !field(
          name,
          name === 'Request ID' ? (value) => PCHAR.test(value) : isDateTime
        )
      )
        return null;
    }
  }
  if (lines[index] === 'Resources:') {
    index += 1;
    while (index < lines.length) {
      const resource = lines[index++];
      if (!resource.startsWith('- ') || !isUri(resource.slice(2))) return null;
    }
  }
  if (index !== lines.length) return null;
  return { address: lines[1], origin: getSiweOrigin(header[1]) };
};

/** Review exactly the bytes personal_sign will sign, without changing its params. */
export const getPersonalSignReview = (
  payload: unknown,
  requesterOrigin: string,
  signerAddress: string
): IPersonalSignReview => {
  if (typeof payload !== 'string')
    return { message: '', error: 'send.suspiciousSignInRequest' };

  // Match the signer's complete, even-length hex decoding. Malformed 0x strings
  // are signed as literal text; never partially decode them for review.
  const text = /^0x(?:[A-Fa-f0-9]{2})*$/.test(payload)
    ? Buffer.from(payload.slice(2), 'hex').toString('utf8')
    : payload;
  const message =
    payload.length !== 42 && text && /^[\x20-\x7E\s]*$/.test(text)
      ? text
      : payload;
  if (!text.toLowerCase().includes(SIWE_PHRASE.toLowerCase()))
    return { message };

  const siwe = parseSiwe(text);
  if (!siwe?.origin || siwe.origin !== requesterOrigin)
    return { message, error: 'send.suspiciousSignInRequest' };
  if (siwe.address.toLowerCase() !== signerAddress.toLowerCase())
    return { message, error: 'send.signingForWrongAddress' };
  return { message };
};
