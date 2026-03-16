/**
 * 音声処理を管理する基本エンジン
 */
export class AudioEngine {
  private context: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private isPlaying: boolean = false;
  private nextTimeoutId: any = null;

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

  /**
   * シームレスループのプレビュー
   * クロスフェードを用いて繋ぎ目を滑らかにする
   */
  playSeamlessLoop(crossfadeDuration: number = 2.0, start?: number, end?: number) {
    if (!this.context || !this.buffer) return;

    this.stop();
    this.isPlaying = true;

    const hasRange =
      typeof start === "number" &&
      typeof end === "number" &&
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      end > start;

    const playBuffer = hasRange ? this.createSegmentBuffer(start!, end!) || this.buffer : this.buffer;
    const duration = playBuffer.duration;
    // ループ実効長 = 全体長 - クロスフェード長
    const effectiveDuration = duration - crossfadeDuration;

    if (effectiveDuration <= 0) {
      console.warn("Crossfade duration is longer than audio duration.");
      return;
    }

    const play = () => {
      if (!this.context || !playBuffer || !this.isPlaying) return;

      const source = this.context.createBufferSource();
      source.buffer = playBuffer;
      
      const gain = this.context.createGain();
      
      source.connect(gain);
      gain.connect(this.context.destination);

      const now = this.context.currentTime;

      // クロスフェードのスケジューリング
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + (crossfadeDuration > 0.1 ? 0.1 : crossfadeDuration)); // 開始時のプチノイズ防止
      
      // 次のループ開始の少し前にフェードアウトを開始するのではなく、
      // 次の音が重なり始めるタイミング（effectiveDuration）で現在の音をフェードアウトさせる
      const fadeOutStart = now + effectiveDuration;
      gain.gain.setValueAtTime(1, fadeOutStart);
      gain.gain.linearRampToValueAtTime(0, fadeOutStart + crossfadeDuration);

      source.start(now);
      source.stop(now + effectiveDuration + crossfadeDuration);

      this.sourceNode = source;

      // 次のループをスケジュール
      this.nextTimeoutId = setTimeout(() => {
        if (this.isPlaying) {
          play();
        }
      }, effectiveDuration * 1000);
    };

    play();
  }

  stop() {
    this.isPlaying = false;
    
    if (this.nextTimeoutId) {
      clearTimeout(this.nextTimeoutId);
      this.nextTimeoutId = null;
    }

    if (this.sourceNode) {
      try {
        this.sourceNode.stop();
      } catch (e) {}
      this.sourceNode = null;
    }
  }
}
