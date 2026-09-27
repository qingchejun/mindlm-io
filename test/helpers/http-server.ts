import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface TestServer {
  origin: string;
  url(path: string): string;
  close(): Promise<void>;
}

export type Handler = (request: IncomingMessage, response: ServerResponse) => void;

/**
 * A throwaway loopback server so URL tests never touch the network. Callers must
 * set MINDMAP_ALLOW_PRIVATE_HOSTS, since the SSRF guard blocks 127.0.0.1.
 */
export async function startTestServer(handler: Handler): Promise<TestServer> {
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;

  return {
    origin,
    url: (path) => new URL(path, origin).href,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
