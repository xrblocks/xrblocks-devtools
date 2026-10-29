import {createServer} from 'node:http';
import {createMcpHandler} from '@modelcontextprotocol/server';
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from '@modelcontextprotocol/node';
import {createTools} from './tools.js';
import {Sessions} from './sessions.js';

export async function runMcp(port: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const sessions = new Sessions();
  const handler = createMcpHandler(() =>
    createTools(sessions, controller.signal)
  );
  const handleRequest = toNodeHandler(handler);
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();
  const active = new Set<Promise<void>>();
  const http = createServer((request, response) => {
    if (!validateHost(request, response) || !validateOrigin(request, response))
      return;
    if (request.url?.split('?')[0] !== '/mcp') {
      response.writeHead(404).end();
      return;
    }
    if (controller.signal.aborted) {
      response.writeHead(503).end();
      return;
    }
    const pending = Promise.resolve(handleRequest(request, response)).catch(
      (error: unknown) => {
        console.error(error);
        if (!response.headersSent) response.writeHead(500);
        response.end();
      }
    );
    active.add(pending);
    void pending.finally(() => active.delete(pending));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(port, '127.0.0.1', () => {
        http.removeListener('error', reject);
        resolve();
      });
    });
    console.error(`XR Blocks MCP: http://127.0.0.1:${port}/mcp`);
    await new Promise<void>((resolve, reject) => {
      const stop = () => {
        http.removeListener('error', fail);
        resolve();
      };
      const fail = (error: Error) => {
        signal?.removeEventListener('abort', stop);
        reject(error);
      };
      http.once('error', fail);
      signal?.addEventListener('abort', stop, {once: true});
      if (signal?.aborted) stop();
    });
  } finally {
    await close();
  }

  async function close() {
    controller.abort(new Error('MCP server is shutting down.'));
    const stopped = new Promise<void>((resolve) => http.close(() => resolve()));
    const results = await Promise.allSettled([
      sessions.closeAll(),
      handler.close(),
    ]);
    await Promise.allSettled([...active]);
    http.closeAllConnections();
    await stopped;
    const errors = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : []
    );
    if (errors.length) throw new AggregateError(errors, 'MCP shutdown failed.');
  }
}
