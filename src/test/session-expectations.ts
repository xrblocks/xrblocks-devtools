import type {XRBlocksSession} from '../session/index.js';

export function expectSessionHealthy(session: XRBlocksSession): void {
  const diagnostics = session.diagnostics;
  const consoleErrors = diagnostics.consoleEntries.filter(
    (entry) => entry.level === 'error'
  );
  if (
    consoleErrors.length === 0 &&
    diagnostics.pageErrors.length === 0 &&
    diagnostics.networkErrors.length === 0
  ) {
    return;
  }
  throw new Error(
    `Session has ${consoleErrors.length} console error(s), ${diagnostics.pageErrors.length} page error(s), and ${diagnostics.networkErrors.length} network error(s).\n${JSON.stringify(
      {
        consoleErrors,
        pageErrors: diagnostics.pageErrors,
        networkErrors: diagnostics.networkErrors,
      },
      null,
      2
    )}`
  );
}
