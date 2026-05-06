/**
 * Stories 9.1 / 9.2 — invite-token tests.
 */

import {
  buildJoinUrl,
  generateInviteToken,
  INVITE_TOKEN_ALPHABET,
  INVITE_TOKEN_LENGTH,
  isValidInviteToken,
  normaliseInviteToken,
  parseJoinUrl,
} from './invite-token';

describe('generateInviteToken', () => {
  it('returns a token of the configured length', () => {
    const t = generateInviteToken();
    expect(t).toHaveLength(INVITE_TOKEN_LENGTH);
  });

  it('only uses chars from the alphabet', () => {
    for (let i = 0; i < 50; i += 1) {
      const t = generateInviteToken();
      for (const ch of t) {
        expect(INVITE_TOKEN_ALPHABET.includes(ch)).toBe(true);
      }
    }
  });

  it('uses the injected RNG', () => {
    let i = 0;
    const rand = (): number => {
      const v = i / 100;
      i += 1;
      return v;
    };
    const t = generateInviteToken(rand);
    expect(t).toHaveLength(INVITE_TOKEN_LENGTH);
    // Determinism check: same RNG -> same token.
    let j = 0;
    const t2 = generateInviteToken(() => {
      const v = j / 100;
      j += 1;
      return v;
    });
    expect(t2).toBe(t);
  });
});

describe('isValidInviteToken', () => {
  it('accepts a freshly generated token', () => {
    expect(isValidInviteToken(generateInviteToken())).toBe(true);
  });

  it('rejects wrong-length tokens', () => {
    expect(isValidInviteToken('ABC')).toBe(false);
    expect(isValidInviteToken('ABCDEFGH')).toBe(false);
  });

  it('rejects tokens with disallowed chars', () => {
    expect(isValidInviteToken('ABCDEI')).toBe(false); // I is excluded
    expect(isValidInviteToken('ABCDE1')).toBe(false); // 1 is excluded
  });

  it('treats lowercase tokens as valid (case-insensitive)', () => {
    const t = generateInviteToken();
    expect(isValidInviteToken(t.toLowerCase())).toBe(true);
  });
});

describe('normaliseInviteToken', () => {
  it('trims and uppercases', () => {
    expect(normaliseInviteToken('  abcdef  ')).toBe('ABCDEF');
  });
});

describe('join URL', () => {
  it('round-trips token + hostLang', () => {
    const url = buildJoinUrl({ token: 'abcdef', hostLang: 'EN' });
    const parsed = parseJoinUrl(url);
    expect(parsed?.token).toBe('ABCDEF');
    expect(parsed?.hostLang).toBe('EN');
  });

  it('round-trips without hostLang', () => {
    const url = buildJoinUrl({ token: 'ABCDEF' });
    const parsed = parseJoinUrl(url);
    expect(parsed?.token).toBe('ABCDEF');
    expect(parsed?.hostLang).toBeUndefined();
  });

  it('rejects URLs with the wrong scheme', () => {
    expect(parseJoinUrl('https://example.test?token=ABCDEF')).toBeUndefined();
  });

  it('rejects URLs missing the query string', () => {
    expect(parseJoinUrl('app://join')).toBeUndefined();
  });

  it('rejects URLs missing the token param', () => {
    expect(parseJoinUrl('app://join?hostLang=EN')).toBeUndefined();
  });

  it('rejects URLs with an invalid token', () => {
    expect(parseJoinUrl('app://join?token=ABCDEI')).toBeUndefined();
  });
});
