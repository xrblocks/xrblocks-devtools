import {XRBlocksSession} from '@xrblocks/devtools';
import {afterAll, expect, it_session, vi} from '@xrblocks/devtools/test';

const invoke = vi.fn().mockResolvedValue({loaded: true});
const open = vi.spyOn(XRBlocksSession, 'open').mockResolvedValue({
  close: async () => ({
    diagnostics: {consoleEntries: [], pageErrors: [], networkErrors: []},
    agentRuns: [],
  }),
  invoke,
});

afterAll(() => open.mockRestore());

it_session(
  'loads scenes',
  {scenes: ['Office', {path: './scenes/table.json'}]},
  async (_session, run) => {
    expect(run.scene).toBeDefined();
  }
);
