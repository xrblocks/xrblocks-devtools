import {XRBlocksSession} from '@xrblocks/devtools';
import {afterAll, expect, it_session, vi} from '@xrblocks/devtools/test';

const open = vi.spyOn(XRBlocksSession, 'open').mockImplementation(async () => ({
  close: async () => ({
    diagnostics: {consoleEntries: [], pageErrors: [], networkErrors: []},
  }),
  getCamera: async () => ({}),
  stepFrame: async () => undefined,
}));

afterAll(() => open.mockRestore());

it_session(
  'opens the app for each primary hand',
  {
    switchHands: true,
    recording: 'hand-session',
    realTime: true,
  },
  async (session, {primaryHand, secondaryHand}) => {
    expect(primaryHand).not.toBe(secondaryHand);
    const config = open.mock.calls.at(-1)?.[0];
    expect(config).not.toHaveProperty('recordAgent');
    expect(config?.recording).toMatchObject({
      mode: 'checkpoints',
    });
    expect(await session.getCamera()).toBeTypeOf('object');
    await session.stepFrame(2);
  }
);
