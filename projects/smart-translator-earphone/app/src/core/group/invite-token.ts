/**
 * Story 9.1 — Invite token generator + parser.
 *
 * 6-character tokens drawn from a 26-symbol Crockford-base32 alphabet
 * (excludes I, L, O, U for readability). Case-insensitive on the
 * wire but normalised to upper-case for display.
 *
 *   Total space: 26^6 ≈ 308 M.
 *   Birthday-ish collisions become noticeable around 17 K live tokens
 *   — well above v1's expected concurrency. The relay is the source
 *   of truth and rejects collisions on `hostOpen`.
 *
 * The QR payload is `app://join?token=ABCDEF&hostLang=EN`. The native
 * app registers the `app://` scheme and parses with `parseJoinUrl`.
 */

const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23'; // 24 distinct visible glyphs
const TOKEN_LEN = 6;

/**
 * Random source (injectable for tests). Returns a number in [0, 1).
 * Defaults to `Math.random` which is fine for invite tokens because
 * the relay is the actual gate — the token's only job is to feel
 * non-guessable in a 6-char shoulder-surf scenario.
 */
export type RandomFn = () => number;

export function generateInviteToken(rand: RandomFn = Math.random): string {
  const chars: string[] = [];
  for (let i = 0; i < TOKEN_LEN; i += 1) {
    chars.push(ALPHABET[Math.floor(rand() * ALPHABET.length)]!);
  }
  return chars.join('');
}

export function isValidInviteToken(token: string): boolean {
  if (token.length !== TOKEN_LEN) return false;
  const upper = token.toUpperCase();
  for (const ch of upper) {
    if (!ALPHABET.includes(ch)) return false;
  }
  return true;
}

export function normaliseInviteToken(token: string): string {
  return token.trim().toUpperCase();
}

export interface JoinUrlPayload {
  token: string;
  hostLang?: string;
}

const SCHEME = 'app://join';

export function buildJoinUrl(payload: JoinUrlPayload): string {
  const params = new URLSearchParams();
  params.set('token', normaliseInviteToken(payload.token));
  if (payload.hostLang !== undefined) params.set('hostLang', payload.hostLang);
  return `${SCHEME}?${params.toString()}`;
}

export function parseJoinUrl(url: string): JoinUrlPayload | undefined {
  if (!url.startsWith(SCHEME)) return undefined;
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return undefined;
  const params = new URLSearchParams(url.slice(queryStart + 1));
  const tokenRaw = params.get('token');
  if (tokenRaw === null) return undefined;
  const token = normaliseInviteToken(tokenRaw);
  if (!isValidInviteToken(token)) return undefined;
  const out: JoinUrlPayload = { token };
  const hostLang = params.get('hostLang');
  if (hostLang !== null) out.hostLang = hostLang;
  return out;
}

export const INVITE_TOKEN_LENGTH = TOKEN_LEN;
export const INVITE_TOKEN_ALPHABET = ALPHABET;
