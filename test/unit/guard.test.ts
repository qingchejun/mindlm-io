import { afterEach, describe, expect, it } from 'vitest';
import {
  assertFetchAllowed,
  isAcceptedMime,
  isPrivateAddress,
  parseContentType,
  readBodyLimited,
} from '../../src/extract/guard.js';

afterEach(() => {
  delete process.env.MINDMAP_ALLOW_PRIVATE_HOSTS;
});

describe('isPrivateAddress (IPv4)', () => {
  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '127.255.255.254',
    '169.254.1.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.8',
    '192.168.1.1',
    '198.18.0.1',
    '224.0.0.1',
    '240.0.0.1',
  ])('blocks %s', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(['1.1.1.1', '8.8.8.8', '93.184.216.34', '172.32.0.1', '11.0.0.1', '100.128.0.1'])(
    'allows %s',
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );
});

describe('isPrivateAddress (IPv6)', () => {
  it.each([
    '::',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'fe80::1%eth0',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '64:ff9b::7f00:1',
    '::127.0.0.1',
  ])('blocks %s', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(['2001:4860:4860::8888', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows %s',
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );
});

describe('assertFetchAllowed', () => {
  it('rejects non-http protocols', async () => {
    await expect(assertFetchAllowed(new URL('file:///etc/passwd'))).rejects.toThrow(
      /Unsupported URL protocol/,
    );
    await expect(assertFetchAllowed(new URL('ftp://example.com/x'))).rejects.toThrow(
      /Unsupported URL protocol/,
    );
  });

  it('rejects a loopback literal and the metadata address', async () => {
    await expect(assertFetchAllowed(new URL('http://127.0.0.1:8080/x'))).rejects.toThrow(
      /private or loopback/,
    );
    await expect(assertFetchAllowed(new URL('http://169.254.169.254/latest/'))).rejects.toThrow(
      /private or loopback/,
    );
    await expect(assertFetchAllowed(new URL('http://[::1]/x'))).rejects.toThrow(
      /private or loopback/,
    );
  });

  it('rejects a hostname that resolves to loopback', async () => {
    await expect(assertFetchAllowed(new URL('http://localhost/x'))).rejects.toThrow(
      /private or loopback/,
    );
  });

  it('allows private addresses once the opt-in is set', async () => {
    process.env.MINDMAP_ALLOW_PRIVATE_HOSTS = 'true';
    await expect(assertFetchAllowed(new URL('http://127.0.0.1:8080/x'))).resolves.toEqual([
      '127.0.0.1',
    ]);
  });

  it('reports an unresolvable host as an input error', async () => {
    await expect(assertFetchAllowed(new URL('http://no-such-host.invalid/x'))).rejects.toThrow(
      /Could not resolve host/,
    );
  });
});

describe('parseContentType', () => {
  it('splits the mime type from the charset', () => {
    expect(parseContentType('text/html; charset=UTF-8')).toEqual({
      mime: 'text/html',
      charset: 'utf-8',
    });
    expect(parseContentType('text/html;charset="gbk"')).toEqual({
      mime: 'text/html',
      charset: 'gbk',
    });
    expect(parseContentType(null)).toEqual({ mime: '', charset: undefined });
  });
});

describe('isAcceptedMime', () => {
  it('accepts the documented types and a missing type', () => {
    for (const mime of ['text/html', 'text/plain', 'text/markdown', 'application/pdf', '']) {
      expect(isAcceptedMime(mime)).toBe(true);
    }
  });

  it('rejects images and archives', () => {
    expect(isAcceptedMime('image/png')).toBe(false);
    expect(isAcceptedMime('application/zip')).toBe(false);
  });
});

describe('readBodyLimited', () => {
  it('reads a short body whole', async () => {
    const response = new Response('hello');
    expect(new TextDecoder().decode(await readBodyLimited(response, 1024))).toBe('hello');
  });

  it('refuses a body that declares itself too large', async () => {
    const response = new Response('hello', { headers: { 'content-length': '999999' } });
    await expect(readBodyLimited(response, 10)).rejects.toThrow(/larger than/);
  });

  it('stops once the streamed body passes the cap', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(new Uint8Array(8));
        controller.close();
      },
    });
    await expect(readBodyLimited(new Response(stream), 10)).rejects.toThrow(/larger than/);
  });
});
