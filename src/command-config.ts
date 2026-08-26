import type {AgentObservationKind} from './agent-observations.js';
import {parseAgentObservations} from './agent-observations.js';
import type {XRBlocksSessionConfig} from './session/index.js';
import type {VisualizeKind, ViewPreset} from './visualize/types.js';

type FlagKind = 'boolean' | 'string' | 'number';
type FlagDefinition = {
  name: string;
  short?: string;
  kind: FlagKind;
  value?: string;
  description: string;
};

type CommandDefinition = {
  name: CommandName;
  usage: string;
  summary: string;
  flags: readonly FlagDefinition[];
};

type CommandName = 'visualize' | 'interact' | 'agent' | 'test';

type FlagValues = Record<string, string | number | boolean>;

export type ParsedCommand =
  | {kind: 'help'; command?: CommandName; exitCode: number}
  | {
      kind: 'visualize';
      visualizeKind: VisualizeKind;
      target: string;
      out: string;
      size?: string;
      background?: string;
      views?: ViewPreset;
      assetsDir?: string;
      xrblocksRoot?: string;
    }
  | {kind: 'interact'; session: XRBlocksSessionConfig}
  | {
      kind: 'agent';
      session: XRBlocksSessionConfig;
      task: string;
      model?: string;
      maxTurns?: number;
      judgeTrajectory?: string;
      context: AgentObservationKind[];
      quiet: boolean;
    }
  | {
      kind: 'test';
      tests: string;
      appDir: string;
      xrblocksRoot?: string;
      entry?: string;
      outputDir: string;
      sessionTimeoutMs?: number;
      judgeModel?: string;
    };

const sessionFlags = [
  flag('app-dir', 'string', 'Run an XR Blocks App directory', 'dir'),
  flag(
    'xrblocks-root',
    'string',
    'Use an XR Blocks checkout/package root',
    'dir'
  ),
  flag('url', 'string', 'Connect to an already served XR Blocks App', 'url'),
  flag('entry', 'string', 'Select an app page path', 'path'),
  flag('headed', 'boolean', 'Show the browser window'),
  flag('monitor-audio', 'boolean', 'Play injected microphone audio'),
  flag('no-realtime', 'boolean', 'Disable realtime embodied control'),
  flag(
    'simulator-reach-limit',
    'boolean',
    'Enforce the simulator hand reach radius'
  ),
  flag(
    'simulator-navmesh',
    'boolean',
    'Enable the active simulator environment navmesh'
  ),
  flag(
    'embodied-control-import',
    'string',
    'Set a browser-loadable embodied-control module',
    'module'
  ),
  flag('timeout-ms', 'number', 'Set the browser startup timeout', 'ms'),
] as const;

const recordingFlags = [
  flag('record-video', 'string', 'Record Playwright video', 'path'),
  flag(
    'record-checkpoints',
    'string',
    'Record one frame per action to MP4',
    'path'
  ),
  flag(
    'record-video-padding-ms',
    'number',
    'Keep padding around each recorded action',
    'ms'
  ),
  flag(
    'record-video-scope',
    'string',
    'Select actions, scene, or full video',
    'scope'
  ),
  flag('keep-raw-video', 'boolean', 'Keep the raw Playwright WebM'),
] as const;

const definitions: Record<CommandName, CommandDefinition> = {
  visualize: {
    name: 'visualize',
    usage: 'visualize <ui|model> <module|-> -o <out.png> [options]',
    summary: 'Render a Preview Module to an image.',
    flags: [
      flag('out', 'string', 'Write the image to this path', 'path', 'o'),
      flag('size', 'string', 'Set output size as WxH', 'WxH'),
      flag('bg', 'string', 'Set the background color', 'color'),
      flag(
        'views',
        'string',
        'Model only: use inspection-4, turntable-4, or front',
        'preset'
      ),
      flag('assets-dir', 'string', 'Resolve local preview assets here', 'dir'),
      flag(
        'xrblocks-root',
        'string',
        'UI only: use an XR Blocks checkout/package root',
        'dir'
      ),
    ],
  },
  interact: {
    name: 'interact',
    usage: 'interact (--app-dir <dir> | --url <url>) [options]',
    summary: 'Open Interactive Mode for a Session.',
    flags: [...sessionFlags, ...recordingFlags],
  },
  agent: {
    name: 'agent',
    usage: 'agent (--app-dir <dir> | --url <url>) --task <text> [options]',
    summary: 'Run an autonomous session action.',
    flags: [
      ...sessionFlags,
      ...recordingFlags,
      flag('task', 'string', 'Describe the task for the agent', 'text'),
      flag('model', 'string', 'Select the model', 'model'),
      flag('max-turns', 'number', 'Limit model turns', 'count'),
      flag(
        'judge-trajectory',
        'string',
        'Judge the completed trajectory against a requirement',
        'requirement'
      ),
      flag(
        'record-agent',
        'string',
        'Write agent trajectories and images',
        'dir'
      ),
      flag(
        'observations',
        'string',
        'Select all or a comma-separated observation list',
        'kinds'
      ),
      flag('quiet', 'boolean', 'Suppress progress events'),
    ],
  },
  test: {
    name: 'test',
    usage: 'test <file> --app <dir> [options]',
    summary: 'Run XR Blocks tests.',
    flags: [
      flag('app', 'string', 'Use this XR Blocks App directory', 'dir'),
      flag(
        'xrblocks-root',
        'string',
        'Use an XR Blocks checkout/package root',
        'dir'
      ),
      flag('entry', 'string', 'Select an app page path', 'path'),
      flag('output', 'string', 'Write result.json and artifacts here', 'dir'),
      flag('timeout-ms', 'number', 'Set the browser startup timeout', 'ms'),
      flag('judge-model', 'string', 'Select the model for AI judges', 'model'),
    ],
  },
};

export function parseCommand(
  argv: string[],
  signal?: AbortSignal
): ParsedCommand {
  const [name, ...args] = argv;
  if (name === undefined) return {kind: 'help', exitCode: 2};
  if (name === 'help' || name === '--help' || name === '-h') {
    const requested = args[0];
    return {
      kind: 'help',
      command: isCommandName(requested) ? requested : undefined,
      exitCode: 0,
    };
  }
  if (!isCommandName(name)) throw new Error(`Unknown command: ${name}`);
  const definition = definitions[name];
  const parsed = parseArguments(definition, args);
  if (parsed.help) return {kind: 'help', command: name, exitCode: 0};

  if (name === 'visualize') {
    const [visualizeKind, target, ...extra] = parsed.positionals;
    if (visualizeKind !== 'ui' && visualizeKind !== 'model') {
      throw new Error('Visualize requires kind "ui" or "model".');
    }
    if (!target) throw new Error('Visualize requires a module path or "-".');
    if (extra.length > 0) {
      throw new Error(`Unexpected argument: ${extra[0]}`);
    }
    const out = stringValue(parsed.flags, 'out');
    if (!out) throw new Error('Visualize requires -o/--out.');
    if (visualizeKind === 'ui' && parsed.flags.views !== undefined) {
      throw new Error('--views is only available for model previews.');
    }
    if (
      visualizeKind === 'model' &&
      parsed.flags['xrblocks-root'] !== undefined
    ) {
      throw new Error('--xrblocks-root is only available for UI previews.');
    }
    return {
      kind: 'visualize',
      visualizeKind,
      target,
      out,
      size: stringValue(parsed.flags, 'size'),
      background: stringValue(parsed.flags, 'bg'),
      views: viewPreset(parsed.flags),
      assetsDir: stringValue(parsed.flags, 'assets-dir'),
      xrblocksRoot: stringValue(parsed.flags, 'xrblocks-root'),
    };
  }

  if (name === 'test') {
    const [tests, ...extra] = parsed.positionals;
    if (!tests) throw new Error('Test requires a test file.');
    if (extra.length > 0) throw new Error(`Unexpected argument: ${extra[0]}`);
    const appDir = stringValue(parsed.flags, 'app');
    if (!appDir) throw new Error('Test requires --app.');
    return {
      kind: 'test',
      tests,
      appDir,
      xrblocksRoot: stringValue(parsed.flags, 'xrblocks-root'),
      entry: stringValue(parsed.flags, 'entry'),
      outputDir:
        stringValue(parsed.flags, 'output') ?? 'artifacts/xrblocks-test',
      sessionTimeoutMs: numberValue(parsed.flags, 'timeout-ms'),
      judgeModel: stringValue(parsed.flags, 'judge-model'),
    };
  }

  if (parsed.positionals.length > 0) {
    throw new Error(`Unexpected argument: ${parsed.positionals[0]}`);
  }
  const session = sessionConfig(parsed.flags, name, signal);
  if (name === 'interact') {
    return {
      kind: name,
      session,
    };
  }

  const task = stringValue(parsed.flags, 'task');
  if (!task) throw new Error('Agent requires --task.');
  const judgeTrajectory = stringValue(parsed.flags, 'judge-trajectory');
  if (
    parsed.flags['judge-trajectory'] !== undefined &&
    !judgeTrajectory?.trim()
  ) {
    throw new Error('--judge-trajectory requires a non-empty requirement.');
  }
  return {
    kind: name,
    session,
    task,
    model: stringValue(parsed.flags, 'model'),
    maxTurns: numberValue(parsed.flags, 'max-turns'),
    judgeTrajectory,
    context: parseAgentObservations(stringValue(parsed.flags, 'observations')),
    quiet: Boolean(parsed.flags.quiet),
  };
}

export function commandHelp(command?: CommandName) {
  if (!command) {
    return [
      'Usage:',
      ...Object.values(definitions).map(
        (definition) => `  xrblocks-devtools ${definition.usage}`
      ),
      '',
      'Run "xrblocks-devtools help <command>" for command options.',
    ].join('\n');
  }
  const definition = definitions[command];
  const optionLines = definition.flags.map((definition) => {
    const long = `--${definition.name}${definition.kind === 'boolean' ? '' : ` <${definition.value ?? 'value'}>`}`;
    const names = definition.short ? `-${definition.short}, ${long}` : long;
    return `  ${names.padEnd(38)} ${definition.description}`;
  });
  return [
    `Usage: xrblocks-devtools ${definition.usage}`,
    '',
    definition.summary,
    '',
    'Options:',
    ...optionLines,
    '  -h, --help'.padEnd(40) + ' Show this help',
  ].join('\n');
}

function parseArguments(definition: CommandDefinition, args: string[]) {
  const byLong = new Map(definition.flags.map((flag) => [flag.name, flag]));
  const byShort = new Map(
    definition.flags.flatMap((flag) =>
      flag.short ? ([[flag.short, flag]] as const) : []
    )
  );
  const flags: FlagValues = {};
  const positionals: string[] = [];
  let help = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (!arg.startsWith('-') || arg === '-') {
      positionals.push(arg);
      continue;
    }
    const flagDefinition = arg.startsWith('--')
      ? byLong.get(arg.slice(2))
      : byShort.get(arg.slice(1));
    if (!flagDefinition) {
      throw new Error(`Unknown ${definition.name} option: ${arg}`);
    }
    if (flags[flagDefinition.name] !== undefined) {
      throw new Error(`Option may only be provided once: ${arg}`);
    }
    if (flagDefinition.kind === 'boolean') {
      flags[flagDefinition.name] = true;
      continue;
    }
    const value = args[++index];
    if (value === undefined) throw new Error(`${arg} requires a value.`);
    if (flagDefinition.kind === 'number') {
      const number = Number(value);
      if (!Number.isFinite(number)) {
        throw new Error(`--${flagDefinition.name} must be a number.`);
      }
      flags[flagDefinition.name] = number;
    } else {
      flags[flagDefinition.name] = value;
    }
  }
  return {flags, positionals, help};
}

function sessionConfig(
  flags: FlagValues,
  command: CommandName,
  signal?: AbortSignal
): XRBlocksSessionConfig {
  const app = appInput(flags, command);
  return {
    ...app,
    headless: !flags.headed,
    realTime: flags['no-realtime'] ? false : undefined,
    monitorAudio: trueValue(flags, 'monitor-audio'),
    simulatorReachLimit: trueValue(flags, 'simulator-reach-limit'),
    simulatorNavMesh: trueValue(flags, 'simulator-navmesh'),
    embodiedControlImport: stringValue(flags, 'embodied-control-import'),
    timeoutMs: numberValue(flags, 'timeout-ms'),
    recording: recording(flags),
    recordAgent: stringValue(flags, 'record-agent')
      ? {outDir: stringValue(flags, 'record-agent')!}
      : undefined,
    signal,
  };
}

function appInput(flags: FlagValues, command: CommandName) {
  const appDir = stringValue(flags, 'app-dir');
  const url = stringValue(flags, 'url');
  const xrblocksRoot = stringValue(flags, 'xrblocks-root');
  const entry = stringValue(flags, 'entry');
  if (!appDir && !url) {
    throw new Error(`${command} requires --app-dir or --url.`);
  }
  if (appDir && url) {
    throw new Error(`${command} accepts --app-dir or --url, not both.`);
  }
  if (url) {
    if (entry) throw new Error('--entry is only available with --app-dir.');
    if (xrblocksRoot) {
      throw new Error('--xrblocks-root is only available with --app-dir.');
    }
    return {url};
  }
  return {appDir: appDir!, xrblocksRoot, entry};
}

function recording(flags: FlagValues) {
  const video = stringValue(flags, 'record-video');
  const checkpoints = stringValue(flags, 'record-checkpoints');
  const hasVideoOptions =
    flags['record-video-padding-ms'] !== undefined ||
    flags['record-video-scope'] !== undefined ||
    Boolean(flags['keep-raw-video']);
  if (video && checkpoints)
    throw new Error('Use --record-video or --record-checkpoints, not both.');
  if (!video && hasVideoOptions)
    throw new Error('Video recording options require --record-video.');
  if (checkpoints) {
    return {
      mode: 'checkpoints' as const,
      out: checkpoints,
    };
  }
  if (!video) return undefined;
  const scope = videoScope(flags);
  const paddingMs = numberValue(flags, 'record-video-padding-ms');
  if (scope !== 'actions' && flags['record-video-padding-ms'] !== undefined)
    throw new Error('--record-video-padding-ms requires action video scope.');
  if (scope === 'full' && flags['keep-raw-video'])
    throw new Error('--keep-raw-video is not available with full video scope.');
  return {
    mode: 'video' as const,
    out: video,
    scope,
    ...(flags['keep-raw-video'] ? {keepRaw: true} : {}),
    ...(paddingMs === undefined ? {} : {paddingMs}),
  };
}

function videoScope(flags: FlagValues): 'actions' | 'scene' | 'full' {
  const value = stringValue(flags, 'record-video-scope') ?? 'actions';
  if (value === 'actions' || value === 'scene' || value === 'full')
    return value;
  throw new Error('--record-video-scope must be actions, scene, or full.');
}

function viewPreset(flags: FlagValues): ViewPreset | undefined {
  const value = stringValue(flags, 'views');
  if (value === undefined) return undefined;
  if (
    value === 'inspection-4' ||
    value === 'turntable-4' ||
    value === 'front'
  ) {
    return value;
  }
  throw new Error('--views must be inspection-4, turntable-4, or front.');
}

function stringValue(flags: FlagValues, key: string) {
  const value = flags[key];
  return typeof value === 'string' ? value : undefined;
}

function numberValue(flags: FlagValues, key: string) {
  const value = flags[key];
  return typeof value === 'number' ? value : undefined;
}

function trueValue(flags: FlagValues, key: string) {
  return flags[key] ? true : undefined;
}

function isCommandName(value: string | undefined): value is CommandName {
  return value !== undefined && value in definitions;
}

function flag(
  name: string,
  kind: FlagKind,
  description: string,
  value?: string,
  short?: string
): FlagDefinition {
  return {name, short, kind, value, description};
}
