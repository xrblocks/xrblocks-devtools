import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  installInteractiveContext,
  interactiveHelpText,
} from '../src/interactive.js';
import {XRBlocksSession} from '../src/session/index.js';

const temporaryDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirs
      .splice(0)
      .map((directory) => rm(directory, {recursive: true, force: true}))
  );
});

describe('interactive REPL interface', () => {
  it('binds manual Session functions without the autonomous action loop', () => {
    const move = vi.fn();
    const session = fakeSession({
      move,
    });
    const server = {context: {}};

    installInteractiveContext(server as never, session);
    (server.context as Record<string, (...args: unknown[]) => unknown>).move({
      forwardMeters: 1,
    });

    expect(move).toHaveBeenCalledWith({forwardMeters: 1});
    expect(server.context).toHaveProperty('session', session);
    expect(server.context).not.toHaveProperty('act');
    expect(server.context).not.toHaveProperty('observe');
    expect(interactiveHelpText()).toContain('saveScreenshot(path, options?)');
    expect(interactiveHelpText()).toContain('Exit: .exit or Ctrl-D.');
  });

  it('saves screenshots through a file-oriented helper', async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'xrblocks-repl-test-')
    );
    temporaryDirs.push(directory);
    const output = path.join(directory, 'screen.png');
    const session = fakeSession({
      getScreenshot: vi
        .fn()
        .mockResolvedValue('data:image/png;base64,c2NyZWVu'),
    });
    const server = {context: {}};
    installInteractiveContext(server as never, session);

    await (
      server.context as Record<string, (...args: unknown[]) => Promise<unknown>>
    ).saveScreenshot(output);

    await expect(readFile(output, 'utf8')).resolves.toBe('screen');
  });
});

function fakeSession(overrides: Partial<XRBlocksSession>) {
  return Object.assign(Object.create(XRBlocksSession.prototype), {
    objects: {findByTag: vi.fn(), inspect: vi.fn()},
    simulator: {
      addObjects: vi.fn(),
      updateObjects: vi.fn(),
      removeObjects: vi.fn(),
      clearObjects: vi.fn(),
      getObjects: vi.fn(),
    },
    ...overrides,
  }) as XRBlocksSession;
}
