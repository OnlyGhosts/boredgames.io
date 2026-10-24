import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

/** The single value of a header, the first if it came more than once. */
function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
}

/**
 * The public address the request came from. Fly's proxy sets Fly-Client-IP; Vercel sets
 * x-real-ip and x-forwarded-for (first hop) to the client; locally it is the socket's address.
 * Used only to group rooms by network and never stored or sent anywhere as it is.
 */
export function clientAddress(req: IncomingMessage): string | null {
  const forwarded = header(req, 'x-forwarded-for')?.split(',')[0]?.trim();
  const candidates = [header(req, 'fly-client-ip'), header(req, 'x-real-ip'), forwarded, req.socket?.remoteAddress];
  for (const c of candidates) {
    if (!c || !isIP(normalise(c))) continue;
    // The machine itself (a desktop on localhost, the e2e suite) is no network anyone shares.
    return isLoopback(normalise(c)) ? null : normalise(c);
  }
  return null;
}

function normalise(addr: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(addr);
  return mapped ? mapped[1]! : addr;
}

function isLoopback(addr: string): boolean {
  return addr === '::1' || addr.startsWith('127.');
}

/** A private address reaches only a server on the same LAN: every phone doing so shares it. */
function isPrivate(addr: string): boolean {
  if (isIP(addr) === 4) return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(addr);
  return /^(f[cd]|fe[89ab])/i.test(addr);
}

/**
 * The part of an address shared by everyone on one network: an IPv4 address whole (the router's
 * NAT address), an IPv6 address's /64 prefix (each phone has its own address inside it), and
 * every private address one network (a server on the LAN, as in local development).
 */
export function networkOf(addr: string): string {
  if (isPrivate(addr)) return 'private';
  if (isIP(addr) !== 6) return addr;
  const [head = '', tail = ''] = addr.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = addr.includes('::') ? [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right] : left;
  return groups
    .slice(0, 4)
    .map((g) => String(parseInt(g || '0', 16)))
    .join(':') + '::/64';
}

/** A salted hash of the network: what rooms are keyed by instead of the address. */
export function networkKey(addr: string, salt: string): string {
  return createHash('sha256').update(salt).update('\0').update(networkOf(addr)).digest('base64url').slice(0, 32);
}

export function newSalt(): string {
  return randomBytes(32).toString('base64url');
}
