const DEVTOOLS_METADATA_KEY = 'xrblocksDevtools';

function devtoolsMetadata(object) {
  const metadata = object?.userData?.[DEVTOOLS_METADATA_KEY];
  return metadata && typeof metadata === 'object' ? metadata : undefined;
}

function resolveRuntimeObject(runtimeId) {
  if (typeof runtimeId !== 'string' || runtimeId.length === 0) {
    throw new Error('Runtime object ID must be a non-empty string.');
  }
  let match;
  findSceneRoot(getCore())?.traverse?.((object) => {
    if (!match && object?.uuid === runtimeId) match = object;
  });
  if (!match) throw new Error('Scene object is stale or unavailable: ' + runtimeId);
  return match;
}

function findObjectsByTag(tag) {
  if (typeof tag !== 'string' || tag.length === 0) {
    throw new Error('Devtools tag must be a non-empty string.');
  }
  const matches = [];
  findSceneRoot(getCore())?.traverse?.((object) => {
    if (devtoolsMetadata(object)?.tag === tag) {
      matches.push(serializeTargetIdentity(object));
    }
  });
  return matches;
}

function serializeTargetIdentity(object) {
  return {
    ...objectIdentity(object),
    tag: devtoolsMetadata(object)?.tag,
  };
}

function resolveTaggedTarget(tag, runtimeId) {
  if (runtimeId !== undefined) {
    const object = resolveRuntimeObject(runtimeId);
    if (devtoolsMetadata(object)?.tag !== tag) {
      throw new Error('Tagged target ID does not match tag: ' + tag);
    }
    return object;
  }
  const matches = findObjectsByTag(tag);
  if (matches.length === 0) throw new Error('Tagged target not found: ' + tag);
  if (matches.length > 1) throw new Error('Tagged target is ambiguous: ' + tag);
  return resolveRuntimeObject(matches[0].id);
}

function serializeDeclaredState(object) {
  const state = devtoolsMetadata(object)?.state;
  if (!state || typeof state !== 'object') return undefined;
  return serializeDevtoolsValue(state, 'userData.xrblocksDevtools.state', new Set());
}

function serializeDevtoolsValue(value, path, ancestors) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Declared state is not finite: ' + path);
    return value;
  }
  if (typeof value === 'undefined') {
    throw new Error('Declared state is undefined: ' + path);
  }
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new Error('Declared state is not serializable: ' + path);
  }
  if (ancestors.has(value)) throw new Error('Declared state contains a cycle: ' + path);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item, index) =>
        serializeDevtoolsValue(item, path + '[' + index + ']', ancestors)
      );
    }
    const result = {};
    for (const key of Object.keys(value)) {
      result[key] = serializeDevtoolsValue(value[key], path + '.' + key, ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}
