import {XRBlocksSession} from '@xrblocks/devtools';
import {afterAll, it_session, vi} from '@xrblocks/devtools/test';

const open = vi.spyOn(XRBlocksSession, 'open').mockResolvedValue({
  close: async () => ({
    diagnostics: {consoleEntries: [], pageErrors: [], networkErrors: []},
    agentRuns: [],
  }),
});

afterAll(() => open.mockRestore());

it_session('runs with each primary hand', {switchHands: true}, async () => {});
