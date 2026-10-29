import {randomUUID} from 'node:crypto';
import {XRBlocksSession, type XRBlocksSessionConfig} from '../session/index.js';

type Entry = {
  session: XRBlocksSession;
  label?: string;
  queue: Promise<unknown>;
  closing: boolean;
};

export class Sessions {
  private readonly entries = new Map<string, Entry>();
  private readonly opening = new Set<Promise<unknown>>();
  private closing = false;

  async open(config: XRBlocksSessionConfig, label?: string) {
    if (this.closing) throw new Error('Server is shutting down.');
    const pending = this.openSession(config, label);
    this.opening.add(pending);
    try {
      return await pending;
    } finally {
      this.opening.delete(pending);
    }
  }

  private async openSession(config: XRBlocksSessionConfig, label?: string) {
    const session = await XRBlocksSession.open(config);

    if (this.closing) {
      await session.close();
      throw new Error('Server is shutting down.');
    }
    const sessionId = randomUUID();
    this.entries.set(sessionId, {
      session,
      label,
      queue: Promise.resolve(),
      closing: false,
    });
    return {sessionId, label, ...session.info};
  }

  list() {
    return [...this.entries].map(([sessionId, entry]) => ({
      sessionId,
      label: entry.label,
      ...entry.session.info,
      closing: entry.closing,
    }));
  }

  run<T>(
    sessionId: string,
    action: (session: XRBlocksSession) => Promise<T> | T
  ) {
    if (this.closing) throw new Error('Server is shutting down.');
    const entry = this.require(sessionId);
    if (entry.closing) throw new Error(`Session is closing: ${sessionId}`);
    const result = entry.queue.then(() => {
      if (this.closing) throw new Error('Server is shutting down.');
      return action(entry.session);
    });
    entry.queue = result.catch(() => undefined);
    return result;
  }

  async close(sessionId: string) {
    const entry = this.require(sessionId);
    entry.closing = true;
    await entry.queue;
    try {
      return await entry.session.close();
    } finally {
      this.entries.delete(sessionId);
    }
  }

  async closeAll() {
    this.closing = true;
    await Promise.allSettled([...this.opening]);
    const results = await Promise.allSettled(
      [...this.entries.values()].map(async (entry) => {
        entry.closing = true;
        try {
          await entry.session.close();
        } finally {
          await entry.queue;
        }
      })
    );
    this.entries.clear();
    const errors = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : []
    );
    if (errors.length)
      throw new AggregateError(errors, 'Session cleanup failed.');
  }

  private require(sessionId: string) {
    const entry = this.entries.get(sessionId);
    if (!entry) throw new Error(`Unknown session: ${sessionId}`);
    return entry;
  }
}
