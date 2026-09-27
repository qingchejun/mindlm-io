import { lookup } from 'node:dns/promises';
import { isIP, isIPv4 } from 'node:net';
import { allowPrivateHosts, DEFAULTS } from '../util/env.js';
import { inputError, usageError } from '../util/errors.js';

/**
 * IPv4 ranges we refuse to fetch. Beyond the obvious loopback/private blocks
 * this covers the cloud metadata address (inside 169.254.0.0/16) and the
 * carrier-grade NAT range, both of which reach infrastructure rather than the
 * public web.
 */
const BLOCKED_V4 = [
  '0.0.0.0/8', // "this host"
  '10.0.0.0/8', // private
  '100.64.0.0/10', // carrier-grade NAT
  '127.0.0.0/8', // loopback
  '169.254.0.0/16', // link-local, includes 169.254.169.254 metadata
  '172.16.0.0/12', // private
  '192.0.0.0/24', // IETF protocol assignments
  '192.168.0.0/16', // private
  '198.18.0.0/15', // benchmarking
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reserved
] as const;

const BLOCKED_V6 = [
  '::/128', // unspecified
  '::1/128', // loopback
  '64:ff9b::/96', // NAT64 — embeds an IPv4 target
  'fc00::/7', // unique local
  'fe80::/10', // link-local
  'fec0::/10', // deprecated site-local
  'ff00::/8', // multicast
] as const;

const ACCEPTED_MIME = new Set([
  'text/html',
  'application/xhtml+xml',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'application/pdf',
]);

export function isPrivateAddress(address: string): boolean {
  if (isIPv4(address)) return matchesAny(ipv4Bytes(address), BLOCKED_V4);
  if (isIP(address) === 6) {
    const bytes = ipv6Bytes(address);
    if (!bytes) return true; // unparseable — refuse rather than guess
    // ::ffff:a.b.c.d and the deprecated ::a.b.c.d both carry an IPv4
    // destination; judge them as IPv4 so 127.0.0.1 cannot slip through.
    const embedded = embeddedIpv4(bytes);
    if (embedded) return matchesAny(embedded, BLOCKED_V4);
    return matchesAny(bytes, BLOCKED_V6);
  }
  return false;
}

/**
 * Validates a URL before it is fetched: http(s) only, and (unless
 * `MINDMAP_ALLOW_PRIVATE_HOSTS=true`) no address that resolves into a private or
 * infrastructure range. Returns the resolved addresses for logging.
 *
 * There is an unavoidable gap between this check and the socket connect — see
 * the DNS-rebinding note in SECURITY.md. For a local tool that is an accepted
 * limitation; the point is to stop prompt-injected content from steering the
 * fetcher at an intranet host.
 */
export async function assertFetchAllowed(url: URL): Promise<string[]> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw usageError(
      `Unsupported URL protocol "${url.protocol}".`,
      'Only http:// and https:// URLs can be fetched.',
    );
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const allowPrivate = allowPrivateHosts();

  if (isIP(host) !== 0) {
    if (!allowPrivate && isPrivateAddress(host)) throw blockedHost(url.hostname);
    return [host];
  }

  let addresses: string[];
  try {
    const records = await lookup(host, { all: true, verbatim: true });
    addresses = records.map((record) => record.address);
  } catch {
    throw inputError(`Could not resolve host "${host}".`);
  }
  if (addresses.length === 0) throw inputError(`Could not resolve host "${host}".`);

  if (!allowPrivate && addresses.some((address) => isPrivateAddress(address))) {
    throw blockedHost(url.hostname);
  }
  return addresses;
}

function blockedHost(hostname: string) {
  return inputError(
    `Refusing to fetch "${hostname}": it resolves to a private or loopback address.`,
    'Set MINDMAP_ALLOW_PRIVATE_HOSTS=true if you really mean to reach a local address.',
  );
}

export interface ParsedContentType {
  mime: string;
  charset: string | undefined;
}

export function parseContentType(header: string | null | undefined): ParsedContentType {
  if (!header) return { mime: '', charset: undefined };
  const [rawMime, ...params] = header.split(';');
  const mime = (rawMime ?? '').trim().toLowerCase();
  let charset: string | undefined;
  for (const param of params) {
    const match = /^\s*charset\s*=\s*"?([^";]+)"?\s*$/i.exec(param);
    if (match) charset = match[1]!.trim().toLowerCase();
  }
  return { mime, charset };
}

export function isAcceptedMime(mime: string): boolean {
  if (ACCEPTED_MIME.has(mime)) return true;
  // Some servers answer with an unhelpful generic type; treat it as text.
  return mime === '' || mime === 'application/octet-stream';
}

export function assertAcceptedMime(mime: string, url: string): void {
  if (isAcceptedMime(mime)) return;
  throw inputError(
    `Unsupported content type "${mime}" at ${url}.`,
    'Supported: HTML, plain text, Markdown and PDF.',
  );
}

/**
 * Reads a response body but stops as soon as the cap is exceeded, so a
 * misbehaving (or hostile) server cannot make us buffer gigabytes.
 */
export async function readBodyLimited(
  response: Response,
  maxBytes = DEFAULTS.urlMaxBytes,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw tooLarge(maxBytes);
  }

  const body = response.body;
  if (!body) return new Uint8Array(0);

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) throw tooLarge(maxBytes);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
    await body.cancel().catch(() => {});
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function tooLarge(maxBytes: number) {
  return inputError(
    `Response is larger than the ${Math.round(maxBytes / 1024 / 1024)}MB limit.`,
    'Save the page locally and use the text command instead.',
  );
}

// ---------------------------------------------------------------------------
// address helpers
// ---------------------------------------------------------------------------

function matchesAny(bytes: Uint8Array, cidrs: readonly string[]): boolean {
  for (const cidr of cidrs) {
    const slash = cidr.lastIndexOf('/');
    const prefix = cidr.slice(0, slash);
    const bits = Number(cidr.slice(slash + 1));
    const base = isIPv4(prefix) ? ipv4Bytes(prefix) : ipv6Bytes(prefix);
    if (!base || base.length !== bytes.length) continue;
    if (sharesPrefix(bytes, base, bits)) return true;
  }
  return false;
}

function sharesPrefix(a: Uint8Array, b: Uint8Array, bits: number): boolean {
  const fullBytes = bits >> 3;
  for (let index = 0; index < fullBytes; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  const remaining = bits & 7;
  if (remaining === 0) return true;
  const mask = 0xff << (8 - remaining);
  return ((a[fullBytes] ?? 0) & mask) === ((b[fullBytes] ?? 0) & mask);
}

function ipv4Bytes(address: string): Uint8Array {
  const parts = address.split('.').map((part) => Number(part));
  return Uint8Array.from([parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 0]);
}

/** The IPv4 tail of an IPv4-mapped (`::ffff:`) or IPv4-compatible (`::`) address. */
function embeddedIpv4(bytes: Uint8Array): Uint8Array | undefined {
  for (let index = 0; index < 10; index += 1) {
    if (bytes[index] !== 0) return undefined;
  }
  const mapped = bytes[10] === 0xff && bytes[11] === 0xff;
  const compatible = bytes[10] === 0 && bytes[11] === 0;
  if (!mapped && !compatible) return undefined;
  return Uint8Array.from(bytes.subarray(12));
}

/** Expands an IPv6 literal (including `::` and a trailing IPv4 tail) to 16 bytes. */
function ipv6Bytes(address: string): Uint8Array | undefined {
  let text = address.split('%')[0] ?? '';
  text = text.replace(/^\[|\]$/g, '');

  let tail: Uint8Array | undefined;
  const lastColon = text.lastIndexOf(':');
  const maybeV4 = text.slice(lastColon + 1);
  if (isIPv4(maybeV4)) {
    tail = ipv4Bytes(maybeV4);
    // Drop the IPv4 tail and the colon that introduced it, but keep a `::`
    // intact (`::1.2.3.4` must leave `::`, not `:`).
    text = text.slice(0, text[lastColon - 1] === ':' ? lastColon + 1 : lastColon);
  }

  const groupsNeeded = tail ? 6 : 8;
  const halves = text.split('::');
  if (halves.length > 2) return undefined;

  const parse = (part: string): number[] | undefined => {
    if (part === '') return [];
    const out: number[] = [];
    for (const group of part.split(':')) {
      if (group === '' || !/^[0-9a-f]{1,4}$/i.test(group)) return undefined;
      out.push(Number.parseInt(group, 16));
    }
    return out;
  };

  const head = parse(halves[0] ?? '');
  const rest = halves.length === 2 ? parse(halves[1] ?? '') : undefined;
  if (!head || (halves.length === 2 && !rest)) return undefined;

  let groups: number[];
  if (halves.length === 2) {
    const fill = groupsNeeded - head.length - rest!.length;
    if (fill < 0) return undefined;
    groups = [...head, ...new Array<number>(fill).fill(0), ...rest!];
  } else {
    groups = head;
  }
  if (groups.length !== groupsNeeded) return undefined;

  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    bytes[index * 2] = (group >> 8) & 0xff;
    bytes[index * 2 + 1] = group & 0xff;
  });
  if (tail) bytes.set(tail, 12);
  return bytes;
}
