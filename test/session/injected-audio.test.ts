import {runInNewContext} from 'node:vm';
import {describe, expect, it, vi} from 'vitest';

import {injectedAudioSource} from '../../src/session/injected-source.js';

class MockTrack {
  kind = 'audio';
  readyState = 'live';
  stop() {
    this.readyState = 'ended';
  }
  clone() {
    return new MockTrack();
  }
}

class MockMediaStream {
  constructor(private tracks: MockTrack[] = []) {}
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio');
  }
  getVideoTracks() {
    return [];
  }
}

function makeAudioContext() {
  const destination = {stream: new MockMediaStream([new MockTrack()])};
  const speakerDestination = {kind: 'speaker'};
  const contexts: MockAudioContext[] = [];
  const sources: Array<ReturnType<typeof createSource>> = [];
  const gains: Array<{connect: ReturnType<typeof vi.fn>}> = [];
  const nativeMediaStreamSources: Array<{
    mediaStream: MockMediaStream;
    connect: ReturnType<typeof vi.fn>;
  }> = [];

  function createSource(context: MockAudioContext) {
    return {
      context,
      buffer: undefined as unknown,
      onended: undefined as (() => void) | undefined,
      connect: vi.fn(),
      start: vi.fn(function (this: {onended?: () => void}) {
        this.onended?.();
      }),
    };
  }

  class MockAudioContext {
    currentTime = 1;
    state = 'running';
    destination = speakerDestination;
    constructor() {
      contexts.push(this);
    }
    createMediaStreamDestination = () => destination;
    createBufferSource = () => {
      const source = createSource(this);
      sources.push(source);
      return source;
    };
    createGain = () => {
      const gain = {connect: vi.fn()};
      gains.push(gain);
      return gain;
    };
    createMediaStreamSource(stream: MockMediaStream) {
      const source = {mediaStream: stream, connect: vi.fn()};
      nativeMediaStreamSources.push(source);
      return source;
    }
    createBuffer = (channels: number, length: number, sampleRate: number) => {
      const channelData = Array.from(
        {length: channels},
        () => new Float32Array(length)
      );
      return {
        length,
        numberOfChannels: channels,
        sampleRate,
        getChannelData: (channel: number) => channelData[channel],
      };
    };
    resume = vi.fn(async () => {
      this.state = 'running';
    });
    decodeAudioData = vi.fn().mockResolvedValue({
      duration: 0.25,
      length: 3,
      sampleRate: 16_000,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array([0, 0.5, 0]),
    });
  }

  return {
    contexts,
    sources,
    gains,
    nativeMediaStreamSources,
    speakerDestination,
    AudioContext: MockAudioContext,
  };
}

async function installAudio(
  schedule: (callback: () => void, delayMs?: number) => unknown = (
    callback
  ) => {
    callback();
    return 0;
  }
) {
  class MockRecognition {
    startedWith?: MockTrack;
    private listeners = new Map<string, Array<() => void>>();
    start(track?: MockTrack) {
      this.startedWith = track;
    }
    addEventListener(type: string, listener: () => void) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }
  }
  const nativeGetUserMedia = vi.fn().mockResolvedValue(new MockMediaStream());
  const stepFrame = vi.fn();
  const audioContext = makeAudioContext();
  const window = {
    AudioContext: audioContext.AudioContext,
    SpeechRecognition: MockRecognition,
    xb: {core: {stepFrame}},
  } as Record<string, unknown>;
  const navigator = {mediaDevices: {getUserMedia: nativeGetUserMedia}};
  runInNewContext(await injectedAudioSource(), {
    window,
    navigator,
    MediaStream: MockMediaStream,
    atob: (value: string) => Buffer.from(value, 'base64').toString('binary'),
    setTimeout: schedule,
  });
  return {
    audio: window.__xrblocksSyntheticAudio as {
      inject(input: object): Promise<Record<string, unknown>>;
      getState(): {activeConsumers: number};
      waitForConsumer(timeoutMs: number): Promise<{
        activeConsumers: number;
      }>;
    },
    navigator,
    nativeGetUserMedia,
    stepFrame,
    AudioContext: audioContext.AudioContext,
    contexts: audioContext.contexts,
    sources: audioContext.sources,
    gains: audioContext.gains,
    nativeMediaStreamSources: audioContext.nativeMediaStreamSources,
    speakerDestination: audioContext.speakerDestination,
    Recognition: window.SpeechRecognition as typeof MockRecognition,
  };
}

describe('injected synthetic microphone', () => {
  it('requires an active consumer', async () => {
    const {audio} = await installAudio();

    await expect(
      audio.inject({base64: Buffer.from('wav').toString('base64')})
    ).rejects.toThrow('requires an active microphone');
  });

  it('resolves readiness when getUserMedia has an active consumer', async () => {
    const {audio, navigator} = await installAudio();
    await navigator.mediaDevices.getUserMedia({audio: true});

    await expect(audio.waitForConsumer(100)).resolves.toMatchObject({
      activeConsumers: 1,
    });
  });

  it('rejects readiness when no consumer becomes active', async () => {
    const {audio} = await installAudio(setTimeout);

    await expect(audio.waitForConsumer(5)).rejects.toThrow(
      'No microphone or speech recognition consumer became active within 5 ms.'
    );
  });

  it('injects audio, reports metadata, and steps a zero-time frame', async () => {
    const {audio, navigator, stepFrame} = await installAudio();
    await navigator.mediaDevices.getUserMedia({audio: true});

    await expect(
      audio.inject({
        source: 'file',
        base64: Buffer.from('wav').toString('base64'),
      })
    ).resolves.toEqual({
      completed: true,
      source: 'file',
      durationMs: 250,
      sampleRate: 16_000,
      channels: 1,
      frameStepped: true,
    });
    expect(stepFrame).toHaveBeenCalledWith(0);
  });

  it('injects into a Web Audio consumer in its own context', async () => {
    const {audio, navigator, AudioContext, sources} = await installAudio();
    const stream = await navigator.mediaDevices.getUserMedia({audio: true});
    const consumerContext = new AudioContext();
    const consumerInput = consumerContext.createMediaStreamSource(stream);

    await audio.inject({
      source: 'file',
      base64: Buffer.from('wav').toString('base64'),
    });

    const consumerSource = sources.find(
      (source) => source.context === consumerContext
    );
    expect(consumerInput.mediaStream).toBe(stream);
    expect(consumerSource?.connect).toHaveBeenCalledWith(consumerInput);
    expect(consumerSource?.start).toHaveBeenCalledOnce();
  });

  it('uses the native media stream source for non-synthetic streams', async () => {
    const {AudioContext, nativeMediaStreamSources} = await installAudio();
    const context = new AudioContext();
    const nativeStream = new MockMediaStream([new MockTrack()]);

    const source = context.createMediaStreamSource(nativeStream);

    expect(source).toBe(nativeMediaStreamSources[0]);
  });

  it('uses the synthetic track for SpeechRecognition.start()', async () => {
    const {audio, Recognition} = await installAudio();
    const recognition = new Recognition();

    recognition.start();

    expect(recognition.startedWith).toBeInstanceOf(MockTrack);
    expect(audio.getState().activeConsumers).toBe(1);
  });

  it('optionally monitors injected audio through speaker output', async () => {
    const {audio, navigator, sources, speakerDestination} =
      await installAudio();
    await navigator.mediaDevices.getUserMedia({audio: true});

    await audio.inject({
      source: 'text',
      monitor: true,
      base64: Buffer.from('wav').toString('base64'),
    });

    expect(sources[0].connect).toHaveBeenCalledWith(speakerDestination);
  });
});
