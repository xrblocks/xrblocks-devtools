(() => {
  if (window.__xrblocksSyntheticAudio) return;

  const NativeAudioContext = window.AudioContext || window.webkitAudioContext;
  if (!NativeAudioContext) {
    window.__xrblocksSyntheticAudio = {
      available: false,
      inject() {
        throw new Error('Web Audio is unavailable in this browser.');
      },
    };
    return;
  }

  const context = new NativeAudioContext();
  const destination = context.createMediaStreamDestination();
  const activeTracks = new Set();
  const speechTracks = new WeakMap();
  let injectionActive = false;

  function createSyntheticTrack() {
    const sourceTrack = destination.stream.getAudioTracks()[0];
    const track = sourceTrack.clone();
    const nativeStop = track.stop.bind(track);
    let stopped = false;
    track.stop = () => {
      if (stopped) return;
      stopped = true;
      activeTracks.delete(track);
      nativeStop();
    };
    activeTracks.add(track);
    return track;
  }

  function combineTracks(audioTrack, videoStream) {
    return new MediaStream([
      audioTrack,
      ...(videoStream?.getVideoTracks() || []),
    ]);
  }

  const nativeGetUserMedia = navigator.mediaDevices?.getUserMedia?.bind(
    navigator.mediaDevices
  );
  if (nativeGetUserMedia) {
    navigator.mediaDevices.getUserMedia = async (constraints = {}) => {
      if (!constraints.audio) return nativeGetUserMedia(constraints);
      const audioTrack = createSyntheticTrack();
      try {
        const videoStream = constraints.video
          ? await nativeGetUserMedia({video: constraints.video})
          : undefined;
        return combineTracks(audioTrack, videoStream);
      } catch (error) {
        audioTrack.stop();
        throw error;
      }
    };
  }

  function patchSpeechRecognition(Recognition) {
    if (!Recognition?.prototype || Recognition.prototype.__xrblocksPatched)
      return;
    const nativeStart = Recognition.prototype.start;
    const releaseTrack = (recognition) => {
      const track = speechTracks.get(recognition);
      if (!track) return;
      speechTracks.delete(recognition);
      track.stop();
    };
    Recognition.prototype.start = function (...args) {
      if (args.length > 0) return nativeStart.apply(this, args);
      releaseTrack(this);
      const track = createSyntheticTrack();
      speechTracks.set(this, track);
      this.addEventListener('end', () => releaseTrack(this), {once: true});
      this.addEventListener('error', () => releaseTrack(this), {once: true});
      try {
        return nativeStart.call(this, track);
      } catch (error) {
        releaseTrack(this);
        throw error;
      }
    };
    Object.defineProperty(Recognition.prototype, '__xrblocksPatched', {
      value: true,
    });
  }

  patchSpeechRecognition(window.SpeechRecognition);
  patchSpeechRecognition(window.webkitSpeechRecognition);

  function decodeBase64(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function hasAudibleSamples(buffer) {
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const samples = buffer.getChannelData(channel);
      for (let index = 0; index < samples.length; index += 1) {
        if (Math.abs(samples[index]) > 0.00001) return true;
      }
    }
    return false;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getState() {
    return {
      activeConsumers: activeTracks.size,
      injectionActive,
      contextState: context.state,
    };
  }

  async function waitForConsumer(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (activeTracks.size === 0) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new Error(
          `No microphone or speech recognition consumer became active within ${timeoutMs} ms.`
        );
      }
      await wait(Math.min(25, remainingMs));
    }
    return getState();
  }

  async function inject({base64, source, monitor = false}) {
    if (injectionActive) {
      throw new Error('Audio injection is already in progress.');
    }
    if (activeTracks.size === 0) {
      throw new Error(
        'Audio injection requires an active microphone or speech recognition consumer.'
      );
    }
    injectionActive = true;
    try {
      const bytes = decodeBase64(base64);
      const audioBuffer = await context.decodeAudioData(bytes.buffer);
      const durationMs = audioBuffer.duration * 1000;
      if (!Number.isFinite(durationMs) || durationMs <= 0) {
        throw new Error('WAV audio must have a finite, non-zero duration.');
      }
      if (durationMs > 60_000) {
        throw new Error('WAV audio must not exceed 60 seconds.');
      }
      if (!hasAudibleSamples(audioBuffer)) {
        throw new Error('WAV audio must contain non-silent samples.');
      }
      await context.resume();
      if (context.state !== 'running') {
        throw new Error('The synthetic microphone audio context is suspended.');
      }

      const bufferSource = context.createBufferSource();
      bufferSource.buffer = audioBuffer;
      bufferSource.connect(destination);
      if (monitor) bufferSource.connect(context.destination);
      const ended = new Promise((resolve) => {
        bufferSource.onended = resolve;
      });
      bufferSource.start(context.currentTime + 0.1);
      await ended;
      await wait(500);
      window.xb?.core?.stepFrame?.(0);

      return {
        completed: true,
        source,
        durationMs: Math.round(durationMs),
        sampleRate: audioBuffer.sampleRate,
        channels: audioBuffer.numberOfChannels,
        frameStepped: true,
      };
    } finally {
      injectionActive = false;
    }
  }

  window.__xrblocksSyntheticAudio = {
    available: true,
    inject,
    getState,
    waitForConsumer,
  };
})();
