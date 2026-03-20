/**
 * Audio preview engine for seamless loop playback.
 */
export class AudioEngine {
  private context: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private isPlaying = false;
  private schedulerId: number | null = null;
  private scheduledSources: Array<{ source: AudioBufferSourceNode; gain: GainNode }> = [];
  private nextStartTime = 0;

  constructor() {
    if (typeof window !== "undefined") {
      this.context = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }

  async decode(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
    if (!this.context) throw new Error("AudioContext not initialized");
    this.buffer = await this.context.decodeAudioData(arrayBuffer);
    return this.buffer;
  }

  private createSegmentBuffer(start: number, end: number): AudioBuffer | null {
    if (!this.context || !this.buffer) return null;
    const safeStart = Math.max(0, Math.min(start, this.buffer.duration));
    const safeEnd = Math.max(safeStart, Math.min(end, this.buffer.duration));
    const segmentDuration = safeEnd - safeStart;
    if (segmentDuration <= 0.05) return null;

    const sampleRate = this.buffer.sampleRate;
    const startSample = Math.floor(safeStart * sampleRate);
    const endSample = Math.floor(safeEnd * sampleRate);
    const length = Math.max(1, endSample - startSample);
    const segment = this.context.createBuffer(
      this.buffer.numberOfChannels,
      length,
      sampleRate
    );

    for (let c = 0; c < this.buffer.numberOfChannels; c++) {
      const channelData = this.buffer.getChannelData(c);
      segment.getChannelData(c).set(channelData.slice(startSample, endSample));
    }

    return segment;
  }

  playSeamlessLoop(crossfadeDuration: number = 2.0, start?: number, end?: number) {
    if (!this.context || !this.buffer) return;
    if (this.context.state === "suspended") {
      void this.context.resume();
    }

    this.stop();
    this.isPlaying = true;

    const hasRange =
      typeof start === "number" &&
      typeof end === "number" &&
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      end > start;

    const playBuffer = hasRange ? this.createSegmentBuffer(start, end) || this.buffer : this.buffer;
    const duration = playBuffer.duration;
    const effectiveDuration = duration - crossfadeDuration;

    if (effectiveDuration <= 0) {
      console.warn("Crossfade duration is longer than audio duration.");
      this.isPlaying = false;
      return;
    }

    const scheduleSource = (startTime: number) => {
      if (!this.context || !this.isPlaying) return;

      const source = this.context.createBufferSource();
      source.buffer = playBuffer;

      const gain = this.context.createGain();
      source.connect(gain);
      gain.connect(this.context.destination);

      if (crossfadeDuration > 0) {
        const fadeInDuration = Math.min(0.1, crossfadeDuration);
        const fadeOutStart = startTime + effectiveDuration;

        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(1, startTime + fadeInDuration);
        gain.gain.setValueAtTime(1, fadeOutStart);
        gain.gain.linearRampToValueAtTime(0, fadeOutStart + crossfadeDuration);
      } else {
        gain.gain.setValueAtTime(1, startTime);
      }

      source.onended = () => {
        this.scheduledSources = this.scheduledSources.filter((entry) => entry.source !== source);
        source.disconnect();
        gain.disconnect();
      };

      source.start(startTime);
      source.stop(startTime + duration);
      this.scheduledSources.push({ source, gain });
    };

    const scheduleAheadTime = Math.max(0.25, Math.min(1, effectiveDuration));
    const schedulerIntervalMs = Math.max(50, Math.min(250, effectiveDuration * 250));
    this.nextStartTime = this.context.currentTime;

    const pumpScheduler = () => {
      if (!this.context || !this.isPlaying) return;
      while (this.nextStartTime < this.context.currentTime + scheduleAheadTime) {
        scheduleSource(this.nextStartTime);
        this.nextStartTime += effectiveDuration;
      }
    };

    pumpScheduler();
    this.schedulerId = window.setInterval(pumpScheduler, schedulerIntervalMs);
  }

  stop() {
    this.isPlaying = false;

    if (this.schedulerId !== null) {
      window.clearInterval(this.schedulerId);
      this.schedulerId = null;
    }

    for (const { source, gain } of this.scheduledSources) {
      try {
        source.stop();
      } catch {}
      source.disconnect();
      gain.disconnect();
    }

    this.scheduledSources = [];
  }
}
