import { createServer, request, type Server } from 'node:http';
import { connect } from 'node:net';

/**
 * A stand-in for the proxy in front of the site (Fly's, Vercel's): forwards every request and
 * WebSocket upgrade to `target`, adding x-forwarded-for: `address`. Pages opened through it come
 * from that address as far as the server can tell, which a browser context's own extra headers
 * cannot do (Chromium leaves them off the WebSocket handshake). Returns its origin and a closer.
 */
export async function proxyAs(address: string, target: string): Promise<{ origin: string; close: () => Promise<void> }> {
  const to = new URL(target);
  const port = Number(to.port || 80);
  const server: Server = createServer((req, res) => {
    const out = request({ host: to.hostname, port, method: req.method, path: req.url, headers: { ...req.headers, 'x-forwarded-for': address } }, (back) => {
      res.writeHead(back.statusCode ?? 502, back.headers);
      back.pipe(res);
    });
    out.on('error', () => res.destroy());
    req.pipe(out);
  });
  const open = new Set<{ destroy(): void }>();
  server.on('upgrade', (req, socket, head) => {
    open.add(socket);
    socket.on('close', () => open.delete(socket));
    const upstream = connect(port, to.hostname, () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        if (req.rawHeaders[i]!.toLowerCase() !== 'x-forwarded-for') lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      }
      lines.push(`x-forwarded-for: ${address}`);
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length) upstream.write(head);
      upstream.pipe(socket).pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no port');
  return {
    origin: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of open) socket.destroy();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
