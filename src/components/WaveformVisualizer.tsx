"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { Play, Pause, RotateCcw, Repeat } from "lucide-react";

interface WaveformVisualizerProps {
  file: File | null;
  onReady?: (wavesurfer: WaveSurfer) => void;
  showRawLoopOption?: boolean;
  rawLoopLabel?: string;
  showLoopRange?: boolean;
  loopStart?: number;
  loopEnd?: number;
  onLoopChange?: (start: number, end: number) => void;
  onDuration?: (duration: number) => void;
  autoPlayToken?: number;
  autoPlayRaw?: boolean;
}

export default function WaveformVisualizer({
  file,
  onReady,
  showRawLoopOption = false,
  rawLoopLabel = "Loop",
  showLoopRange = false,
  loopStart,
  loopEnd,
  onLoopChange,
  onDuration,
  autoPlayToken,
  autoPlayRaw = false,
}: WaveformVisualizerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const rawContextRef = useRef<AudioContext | null>(null);
  const rawBufferRef = useRef<AudioBuffer | null>(null);
  const rawSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const rawSampleRateRef = useRef<number | null>(null);
  const loopStateRef = useRef({
    enabled: false,
    start: 0,
    end: 0,
    duration: 0,
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRawLooping, setIsRawLooping] = useState(false);
  const [isRawLoopEnabled, setIsRawLoopEnabled] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const startRawLoopAtRef = useRef<(seekTime?: number) => void>(() => {});

  const stopRawSource = useCallback(() => {
    if (rawSourceRef.current) {
      try {
        rawSourceRef.current.stop();
      } catch {}
      rawSourceRef.current.disconnect();
      rawSourceRef.current = null;
    }
  }, []);

  const stopRawLoop = useCallback(() => {
    stopRawSource();
    setIsRawLooping(false);
    setIsPlaying(false);
    wavesurferRef.current?.pause();
  }, [stopRawSource]);

  useEffect(() => {
    if (!containerRef.current || !file) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "#1f2937",
      progressColor: "#22d3a6",
      cursorColor: "#e6e9ef",
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      height: 140,
      normalize: true,
    });

    const url = URL.createObjectURL(file);

    ws.on("error", (err) => {
      if (err.name === "AbortError") {
        console.log("WaveSurfer load aborted (expected during cleanup)");
      } else {
        console.error("WaveSurfer error:", err);
      }
    });

    ws.load(url).catch((err) => {
      if (err.name === "AbortError") {
        // Ignore abort errors during cleanup
      } else {
        console.error("WaveSurfer load error:", err);
      }
    });

    ws.on("ready", () => {
      setDuration(ws.getDuration());
      setCurrentTime(0);
      onDuration?.(ws.getDuration());
      onReady?.(ws);
    });

    ws.on("play", () => setIsPlaying(true));
    ws.on("pause", () => setIsPlaying(false));
    ws.on("timeupdate", (time) => {
      setCurrentTime(time);
      const state = loopStateRef.current;
      if (state.enabled) {
        const start = state.start;
        const end = state.end;
        if (end > start && time >= end) {
          ws.setTime(start);
          ws.play();
        }
      }
    });

    ws.on("interaction", () => {
      if (!rawSourceRef.current) return;
      startRawLoopAtRef.current(ws.getCurrentTime());
    });

    wavesurferRef.current = ws;

    return () => {
      if (wavesurferRef.current) {
        const wsToDestroy = wavesurferRef.current;
        wavesurferRef.current = null;

        setTimeout(() => {
          try {
            wsToDestroy.unAll();
            wsToDestroy.destroy();
          } catch (e) {}
        }, 0);
      }
      URL.revokeObjectURL(url);
    };
  }, [file, onReady]);

  const setWaveSurferMuted = useCallback((muted: boolean) => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    const anyWs = ws as any;
    if (typeof anyWs.setMuted === "function") {
      anyWs.setMuted(muted);
    } else if (typeof anyWs.setVolume === "function") {
      anyWs.setVolume(muted ? 0 : 1);
    }
  }, []);

  const quantizeTime = useCallback((value: number, sampleRate: number | null) => {
    if (!Number.isFinite(value) || !sampleRate) return value;
    const samples = Math.round(value * sampleRate);
    return samples / sampleRate;
  }, []);

  const startRawLoopAt = useCallback(async (seekTime?: number) => {
    if (!file) return;
    if (!rawContextRef.current) {
      rawContextRef.current = new AudioContext();
    }
    const ctx = rawContextRef.current;
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    if (!rawBufferRef.current) {
      const buffer = await file.arrayBuffer();
      rawBufferRef.current = await ctx.decodeAudioData(buffer);
    }
    const buffer = rawBufferRef.current;
    if (!buffer) return;
    rawSampleRateRef.current = buffer.sampleRate;

    const loopStartValue = typeof loopStart === "number" ? loopStart : 0;
    const loopEndValue = typeof loopEnd === "number" ? loopEnd : buffer.duration;
    const safeLoopStart = Math.max(0, Math.min(loopStartValue, buffer.duration));
    const minLoopEnd = safeLoopStart + 1 / buffer.sampleRate;
    const safeLoopEnd = Math.max(minLoopEnd, Math.min(loopEndValue, buffer.duration));

    const requestedTime =
      typeof seekTime === "number"
        ? seekTime
        : wavesurferRef.current?.getCurrentTime() ?? safeLoopStart;
    const clampedTime = Math.max(
      safeLoopStart,
      Math.min(requestedTime, safeLoopEnd - 1 / buffer.sampleRate)
    );
    const quantizedTime = quantizeTime(clampedTime, buffer.sampleRate);
    const quantizedStart = quantizeTime(safeLoopStart, buffer.sampleRate);
    const quantizedEnd = quantizeTime(safeLoopEnd, buffer.sampleRate);

    stopRawSource();

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = Math.max(0, Math.min(quantizedStart, buffer.duration));
    source.loopEnd = Math.max(
      source.loopStart + 1 / buffer.sampleRate,
      Math.min(quantizedEnd, buffer.duration)
    );
    source.connect(ctx.destination);
    setWaveSurferMuted(true);
    wavesurferRef.current?.setTime(quantizedTime);
    wavesurferRef.current?.play();
    source.start(0, quantizedTime);
    rawSourceRef.current = source;
    setIsRawLooping(true);
    setIsPlaying(true);
  }, [file, loopStart, loopEnd, quantizeTime, setWaveSurferMuted, stopRawSource]);

  useEffect(() => {
    startRawLoopAtRef.current = startRawLoopAt;
  }, [startRawLoopAt]);

  useEffect(() => {
    return () => {
      stopRawLoop();
      if (rawContextRef.current) {
        rawContextRef.current.close();
        rawContextRef.current = null;
      }
      rawBufferRef.current = null;
    };
  }, [stopRawLoop]);

  useEffect(() => {
    loopStateRef.current = {
      enabled: isRawLoopEnabled,
      start: typeof loopStart === "number" ? loopStart : 0,
      end: typeof loopEnd === "number" ? loopEnd : duration,
      duration,
    };
  }, [isRawLoopEnabled, loopStart, loopEnd, duration]);

  useEffect(() => {
    if (!autoPlayToken) return;
    if (autoPlayRaw) {
      setIsRawLoopEnabled(true);
      startRawLoopAt(loopStart);
      return;
    }
    wavesurferRef.current?.play();
  }, [autoPlayToken, autoPlayRaw, loopStart, startRawLoopAt]);

  const togglePlay = () => {
    if (showRawLoopOption && isRawLoopEnabled) {
      if (isRawLooping) {
        stopRawLoop();
      } else {
        startRawLoopAt(wavesurferRef.current?.getCurrentTime());
      }
      return;
    }
    wavesurferRef.current?.playPause();
  };

  const stop = () => {
    stopRawLoop();
    wavesurferRef.current?.stop();
    setCurrentTime(0);
  };

  useEffect(() => {
    stopRawLoop();
    rawBufferRef.current = null;
    rawSampleRateRef.current = null;
  }, [file, stopRawLoop]);


  const toggleRawLoop = () => {
    if (isRawLooping) {
      stopRawLoop();
    }
    setIsRawLoopEnabled((prev) => {
      const next = !prev;
      if (!next) {
        setWaveSurferMuted(false);
      }
      return next;
    });
  };

  const clampLoop = (startValue: number, endValue: number) => {
    const minGap = 0.05;
    let start = Math.max(0, Math.min(startValue, duration));
    let end = Math.max(0, Math.min(endValue, duration));
    const sr = rawSampleRateRef.current;
    if (sr) {
      start = quantizeTime(start, sr);
      end = quantizeTime(end, sr);
    }
    if (end - start < minGap) {
      if (start + minGap <= duration) {
        end = start + minGap;
      } else if (end - minGap >= 0) {
        start = end - minGap;
      }
    }
    onLoopChange?.(start, end);
  };

  const formatTime = (value: number) => {
    if (!Number.isFinite(value)) return "0:00.00";
    const totalSeconds = Math.max(0, value);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const centiseconds = Math.floor((totalSeconds - Math.floor(totalSeconds)) * 100);
    return `${minutes}:${seconds.toString().padStart(2, "0")}.${centiseconds
      .toString()
      .padStart(2, "0")}`;
  };

  const loopStartValue = typeof loopStart === "number" ? loopStart : 0;
  const loopEndValue = typeof loopEnd === "number" ? loopEnd : duration;
  const safeLoopStart = Math.max(0, Math.min(loopStartValue, duration || 0));
  const safeLoopEnd = Math.max(safeLoopStart, Math.min(loopEndValue, duration || 0));
  const startPct = duration > 0 ? (safeLoopStart / duration) * 100 : 0;
  const endPct = duration > 0 ? (safeLoopEnd / duration) * 100 : 0;

  return (
    <div className="w-full space-y-4">
      <div className="waveform-shell">
        <div
          ref={containerRef}
          className="w-full rounded-xl border border-white/10 bg-[rgba(255,255,255,0.02)] px-3 py-4"
        />
        {showLoopRange && duration > 0 && (
          <div
            className="loop-range-bar"
            style={
              {
                "--loop-start": `${startPct}%`,
                "--loop-end": `${endPct}%`,
              } as React.CSSProperties
            }
          />
        )}
      </div>
      <div className="flex items-center justify-between text-xs text-white/60">
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>

      {showLoopRange && duration > 0 && (
        <div className="loop-controls">
          <div className="loop-row">
            <div className="loop-field">
              <span className="loop-label">Loop start</span>
              <input
                type="number"
                step="0.01"
                min={0}
                max={duration}
                value={loopStart ?? 0}
                onChange={(e) => clampLoop(Number(e.target.value), loopEnd ?? duration)}
                className="loop-input"
              />
              <button
                type="button"
                onClick={() => clampLoop(currentTime, loopEnd ?? duration)}
                className="loop-set"
              >
                Set
              </button>
            </div>
            <div className="loop-field">
              <span className="loop-label">Loop end</span>
              <input
                type="number"
                step="0.01"
                min={0}
                max={duration}
                value={loopEnd ?? duration}
                onChange={(e) => clampLoop(loopStart ?? 0, Number(e.target.value))}
                className="loop-input"
              />
              <button
                type="button"
                onClick={() => clampLoop(loopStart ?? 0, currentTime)}
                className="loop-set"
              >
                Set
              </button>
            </div>
          </div>
          <div className="loop-sliders">
            <input
              type="range"
              min={0}
              max={duration}
              step={0.01}
              value={loopStart ?? 0}
              onChange={(e) => clampLoop(Number(e.target.value), loopEnd ?? duration)}
              className="w-full accent-app"
            />
            <input
              type="range"
              min={0}
              max={duration}
              step={0.01}
              value={loopEnd ?? duration}
              onChange={(e) => clampLoop(loopStart ?? 0, Number(e.target.value))}
              className="w-full accent-app"
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-center gap-3">
        <button
          onClick={stop}
          className="rounded-full border border-white/10 bg-white/5 p-3 text-white/70 transition hover:bg-white/10"
          title="Stop"
        >
          <RotateCcw className="h-4 w-4" />
        </button>

        <button
          onClick={togglePlay}
          className="rounded-full border border-[rgba(34,211,166,0.6)] bg-[rgba(34,211,166,0.2)] p-4 text-white transition hover:bg-[rgba(34,211,166,0.35)]"
          title="Play"
        >
          {isPlaying ? (
            <Pause className="h-5 w-5" />
          ) : (
            <Play className="h-5 w-5 translate-x-[1px]" />
          )}
        </button>

        {showRawLoopOption && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleRawLoop();
            }}
            className={`rounded-full border px-3 py-3 transition ${
              isRawLoopEnabled
                ? "border-[rgba(56,189,248,0.7)] bg-[rgba(56,189,248,0.15)] text-[rgb(56,189,248)]"
                : "border-white/10 bg-white/5 text-white/60"
            }`}
            title={isRawLoopEnabled ? "Raw loop on" : "Raw loop off"}
          >
            <Repeat className={`h-4 w-4 ${isRawLoopEnabled ? "animate-pulse" : ""}`} />
            <span className="ml-1 text-[10px] font-semibold">
              {rawLoopLabel} {isRawLoopEnabled ? "ON" : "OFF"}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
