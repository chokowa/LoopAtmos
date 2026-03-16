"use client";

import { useState, useRef, useEffect } from "react";
import {
  Music,
  Download,
  Play,
  Square,
  Loader2,
  Info,
  FileAudio,
  Layers,
  Activity,
  ChevronRight,
  Monitor,
} from "lucide-react";
import WaveformVisualizer from "@/components/WaveformVisualizer";
import CombinedFileList from "@/components/CombinedFileList";
import { AudioEngine } from "@/lib/AudioEngine";
import { ExportEngine } from "@/lib/ExportEngine";

interface AudioFileItem {
  id: string;
  file: File;
}

interface LoopCandidate {
  start: number;
  end: number;
  score: number;
}

const createAudioContext = () => {
  const ctx = window.AudioContext || (window as any).webkitAudioContext;
  return new ctx();
};

export default function Home() {
  const [mainFile, setMainFile] = useState<File | null>(null);
  const [combinedFiles, setCombinedFiles] = useState<AudioFileItem[]>([]);
  const [crossfadeDuration, setCrossfadeDuration] = useState(2.0);
  const [crossfadeCurve, setCrossfadeCurve] = useState<"tri" | "qsin" | "exp">("tri");
  const [targetDuration, setTargetDuration] = useState<string>("");
  const [useSampleAccurateTrim, setUseSampleAccurateTrim] = useState(false);
  const [normalizeMode, setNormalizeMode] = useState<"off" | "peak" | "lufs">("off");
  const [normalizePeakDb, setNormalizePeakDb] = useState<string>("-1.0");
  const [normalizeLufs, setNormalizeLufs] = useState<string>("-16.0");
  const [normalizeTruePeak, setNormalizeTruePeak] = useState<string>("-1.0");
  const [exportWav, setExportWav] = useState(true);
  const [exportMp3, setExportMp3] = useState(false);
  const [exportOgg, setExportOgg] = useState(false);
  const [exportBitrate, setExportBitrate] = useState<string>("192");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSeamlessPlaying, setIsSeamlessPlaying] = useState(false);
  const [activeTab, setActiveTab] = useState<"single" | "combine">("single");
  const [generatedFile, setGeneratedFile] = useState<File | null>(null);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [singleLoopRange, setSingleLoopRange] = useState<{ start: number; end: number } | null>(null);
  const [layerLoopRanges, setLayerLoopRanges] = useState<Record<string, { start: number; end: number }>>({});
  const [singleCandidates, setSingleCandidates] = useState<LoopCandidate[]>([]);
  const [layerCandidates, setLayerCandidates] = useState<Record<string, LoopCandidate[]>>({});
  const [detectingSingle, setDetectingSingle] = useState(false);
  const [detectingLayer, setDetectingLayer] = useState<Record<string, boolean>>({});
  const [singlePreviewToken, setSinglePreviewToken] = useState(0);
  const [layerPreviewTokens, setLayerPreviewTokens] = useState<Record<string, number>>({});
  const [renderError, setRenderError] = useState<string | null>(null);
  const [previewSource, setPreviewSource] = useState<"source" | "rendered">("source");

  const audioEngine = useRef<AudioEngine | null>(null);
  const exportEngine = useRef<ExportEngine | null>(null);

  useEffect(() => {
    audioEngine.current = new AudioEngine();
    exportEngine.current = new ExportEngine();
  }, []);

  useEffect(() => {
    if (activeTab === "combine") {
      if (combinedFiles.length === 0) {
        setActiveLayerId(null);
        return;
      }

      if (!activeLayerId || !combinedFiles.some((file) => file.id === activeLayerId)) {
        setActiveLayerId(combinedFiles[0].id);
      }
    }
  }, [activeTab, combinedFiles, activeLayerId]);

  useEffect(() => {
    if (previewSource === "rendered" && !generatedFile) {
      setPreviewSource("source");
    }
  }, [previewSource, generatedFile]);

  const handleMainFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setMainFile(selectedFile);
      audioEngine.current?.stop();
      setIsSeamlessPlaying(false);
      setGeneratedFile(null);
      setSingleLoopRange(null);
    }
  };

  const addToList = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files || []).map((file) => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
    }));
    setCombinedFiles((prev) => [...prev, ...newFiles]);
    setGeneratedFile(null);
  };

  const removeFromList = (id: string) => {
    setCombinedFiles((prev) => prev.filter((item) => item.id !== id));
    if (activeLayerId === id) {
      setActiveLayerId(null);
      audioEngine.current?.stop();
      setIsSeamlessPlaying(false);
    }
    setLayerLoopRanges((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setGeneratedFile(null);
  };

  const reorderList = (newFiles: AudioFileItem[]) => {
    setCombinedFiles(newFiles);
    setGeneratedFile(null);
  };

  const toggleSeamlessPreview = async () => {
    if (previewSource === "rendered" && !generatedFile) return;
    if (previewSource === "source") {
      if (activeTab === "single" && !mainFile) return;
      if (activeTab === "combine" && combinedFiles.length === 0) return;
    }
    if (!audioEngine.current) return;

    if (isSeamlessPlaying) {
      audioEngine.current.stop();
      setIsSeamlessPlaying(false);
    } else {
      setIsProcessing(true);
      try {
        if (previewSource === "rendered" && generatedFile) {
          const arrayBuffer = await generatedFile.arrayBuffer();
          await audioEngine.current.decode(arrayBuffer);
          audioEngine.current.playSeamlessLoop(crossfadeDuration);
          setIsSeamlessPlaying(true);
          return;
        }

        if (activeTab === "single" && mainFile) {
          const arrayBuffer = await mainFile.arrayBuffer();
          await audioEngine.current.decode(arrayBuffer);
          audioEngine.current.playSeamlessLoop(
            crossfadeDuration,
            singleLoopRange?.start,
            singleLoopRange?.end
          );
          setIsSeamlessPlaying(true);
        } else {
          const selected = combinedFiles.find((file) => file.id === activeLayerId);
          const previewFile = selected ? selected.file : combinedFiles[0]?.file;
          if (previewFile) {
            const loopRange = selected ? layerLoopRanges[selected.id] : null;
            const arrayBuffer = await previewFile.arrayBuffer();
            await audioEngine.current.decode(arrayBuffer);
            audioEngine.current.playSeamlessLoop(
              crossfadeDuration,
              loopRange?.start,
              loopRange?.end
            );
            setIsSeamlessPlaying(true);
          }
        }
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const parseTargetDuration = () => {
    const value = Number.parseFloat(targetDuration);
    if (!Number.isFinite(value)) return null;
    return value > 0 ? value : null;
  };

  const getAudioDuration = async (file: File) => {
    const ctx = createAudioContext();
    try {
      const buffer = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(buffer);
      return decoded.duration;
    } finally {
      await ctx.close();
    }
  };

  const computeLoopCandidates = async (file: File, overlap: number, count: number) => {
    const ctx = createAudioContext();
    try {
      const buffer = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(buffer);
      const { sampleRate, length, numberOfChannels, duration } = decoded;
      if (duration < 0.5) return [] as LoopCandidate[];

      const channelData: Float32Array[] = [];
      for (let c = 0; c < numberOfChannels; c++) {
        channelData.push(decoded.getChannelData(c));
      }

      const blockSize = 1024;
      const hop = 1024;
      const env: number[] = [];
      for (let i = 0; i + blockSize <= length; i += hop) {
        let sum = 0;
        for (let j = 0; j < blockSize; j++) {
          let sample = 0;
          for (let c = 0; c < numberOfChannels; c++) {
            sample += channelData[c][i + j];
          }
          sample /= numberOfChannels;
          sum += sample * sample;
        }
        env.push(Math.sqrt(sum / blockSize));
      }

      const blockDuration = hop / sampleRate;
      const searchSeconds = Math.min(4, duration / 3);
      const windowSeconds = Math.min(1.2, Math.max(0.2, overlap));
      const windowBlocks = Math.max(6, Math.round(windowSeconds / blockDuration));
      const startMax = Math.min(env.length - windowBlocks - 1, Math.round(searchSeconds / blockDuration));
      const endMin = Math.max(0, env.length - windowBlocks - Math.round(searchSeconds / blockDuration));
      const endMax = env.length - windowBlocks - 1;
      const stepBlocks = Math.max(1, Math.round(0.03 / blockDuration));

      const coarse: LoopCandidate[] = [];
      for (let s = 0; s <= startMax; s += stepBlocks) {
        for (let e = endMin; e <= endMax; e += stepBlocks) {
          let score = 0;
          for (let k = 0; k < windowBlocks; k++) {
            score += Math.abs(env[s + k] - env[e + k]);
          }
          const startTime = s * blockDuration;
          const endTime = e * blockDuration + windowSeconds;
          if (endTime <= startTime + 0.05) continue;
          coarse.push({ start: startTime, end: Math.min(endTime, duration), score });
        }
      }

      coarse.sort((a, b) => a.score - b.score);
      const shortlist = coarse.slice(0, Math.max(20, count * 5));

      const targetRate = 2000;
      const ds = Math.max(1, Math.floor(sampleRate / targetRate));
      const dsRate = sampleRate / ds;
      const mono = new Float32Array(Math.floor(length / ds));
      for (let i = 0, j = 0; i + ds <= length && j < mono.length; i += ds, j++) {
        let sum = 0;
        for (let c = 0; c < numberOfChannels; c++) {
          sum += channelData[c][i];
        }
        mono[j] = sum / numberOfChannels;
      }

      const windowSamples = Math.max(64, Math.floor(windowSeconds * dsRate));
      const refined = shortlist.map((candidate) => {
        const startSample = Math.min(mono.length - windowSamples - 1, Math.floor(candidate.start * dsRate));
        const endSample = Math.min(mono.length - windowSamples - 1, Math.floor((candidate.end - windowSeconds) * dsRate));
        let sumXY = 0;
        let sumX = 0;
        let sumY = 0;
        for (let k = 0; k < windowSamples; k++) {
          const x = mono[startSample + k];
          const y = mono[endSample + k];
          sumXY += x * y;
          sumX += x * x;
          sumY += y * y;
        }
        const denom = Math.sqrt(sumX * sumY) || 1;
        const corr = sumXY / denom;
        const boundaryPenalty =
          Math.abs(mono[startSample] - mono[endSample]) +
          Math.abs(mono[startSample + windowSamples - 1] - mono[endSample + windowSamples - 1]);
        const score = (1 - corr) + boundaryPenalty * 0.15;
        return { ...candidate, score };
      });

      refined.sort((a, b) => a.score - b.score);
      return refined.slice(0, count);
    } finally {
      await ctx.close();
    }
  };

  const handleRender = async () => {
    if (!exportEngine.current) return;

    setRenderError(null);
    setIsProcessing(true);
    try {
      let blob: Blob;
      let filename: string;

      const requestedDuration = parseTargetDuration();
      const targetSeconds = requestedDuration ?? undefined;
      const requestedPeak = Number.parseFloat(normalizePeakDb);
      const requestedLufs = Number.parseFloat(normalizeLufs);
      const requestedTruePeak = Number.parseFloat(normalizeTruePeak);

      let normalizeOptions:
        | { mode: "peak"; peakDb: number }
        | { mode: "lufs"; lufs: number; truePeak: number; lra: number }
        | undefined;

      if (normalizeMode === "peak") {
        if (!Number.isFinite(requestedPeak)) {
          throw new Error("Target peak must be a valid number.");
        }
        normalizeOptions = { mode: "peak", peakDb: requestedPeak };
      }

      if (normalizeMode === "lufs") {
        if (!Number.isFinite(requestedLufs) || !Number.isFinite(requestedTruePeak)) {
          throw new Error("Target LUFS and true peak must be valid numbers.");
        }
        normalizeOptions = {
          mode: "lufs",
          lufs: requestedLufs,
          truePeak: requestedTruePeak,
          lra: 11,
        };
      }

      if (activeTab === "single" && mainFile) {
        let sourceDuration: number | undefined;
        if (targetSeconds) {
          sourceDuration = await getAudioDuration(mainFile);
          if (targetSeconds <= 0) {
            throw new Error("Target duration must be greater than 0.");
          }
        }
        if (singleLoopRange && singleLoopRange.end > singleLoopRange.start) {
          sourceDuration = singleLoopRange.end - singleLoopRange.start;
        }
        if (sourceDuration !== undefined && crossfadeDuration >= sourceDuration) {
          throw new Error("Overlap duration must be shorter than the loop range.");
        }

        blob = await exportEngine.current.exportSeamlessLoop(
          mainFile,
          crossfadeDuration,
          targetSeconds,
          sourceDuration,
          useSampleAccurateTrim,
          normalizeOptions,
          crossfadeCurve,
          singleLoopRange?.start,
          singleLoopRange?.end
        );
        filename = `loop_${mainFile.name.replace(/\.[^/.]+$/, "")}.wav`;
      } else if (activeTab === "combine" && combinedFiles.length > 0) {
        let sourceDurations: number[] | undefined;
        if (targetSeconds) {
          sourceDurations = await Promise.all(
            combinedFiles.map((item) => getAudioDuration(item.file))
          );
          if (targetSeconds <= 0) {
            throw new Error("Target duration must be greater than 0.");
          }
        }
        if (sourceDurations) {
          sourceDurations = sourceDurations.map((value, index) => {
            const loopRange = layerLoopRanges[combinedFiles[index].id];
            if (loopRange && loopRange.end > loopRange.start) {
              return loopRange.end - loopRange.start;
            }
            return value;
          });
        }
        const loopRanges = combinedFiles.map((file) => layerLoopRanges[file.id] ?? null);
        if (sourceDurations) {
          const minLength = Math.min(...sourceDurations);
          if (crossfadeDuration >= minLength) {
            throw new Error("Overlap duration must be shorter than every loop range.");
          }
        }

        blob = await exportEngine.current.combineAndLoop(
          combinedFiles.map((f) => f.file),
          crossfadeDuration,
          targetSeconds,
          sourceDurations,
          useSampleAccurateTrim,
          normalizeOptions,
          crossfadeCurve,
          loopRanges
        );
        filename = "combined_loop.wav";
      } else {
        setIsProcessing(false);
        return;
      }

      const newFile = new File([blob], filename, { type: "audio/wav" });
      setGeneratedFile(newFile);
    } catch (err: any) {
      console.error(err);
      const message = err?.message || "Unknown error";
      setRenderError(message);
      alert(`Render failed: ${message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExport = async () => {
    if (!generatedFile) return;

    if (!exportEngine.current) return;
    const selected = [exportWav, exportMp3, exportOgg].some(Boolean);
    if (!selected) {
      setRenderError("Select at least one export format.");
      return;
    }

    setRenderError(null);
    setIsProcessing(true);
    try {
      const baseName = generatedFile.name.replace(/\.[^/.]+$/, "");
      const bitrateKbps = Number.parseInt(exportBitrate, 10);

      if (exportWav) {
        const url = URL.createObjectURL(generatedFile);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${baseName}.wav`;
        a.click();
        URL.revokeObjectURL(url);
      }

      if (exportMp3) {
        const mp3 = await exportEngine.current.transcode(generatedFile, "mp3", bitrateKbps);
        const url = URL.createObjectURL(mp3);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${baseName}.mp3`;
        a.click();
        URL.revokeObjectURL(url);
      }

      if (exportOgg) {
        const ogg = await exportEngine.current.transcode(generatedFile, "ogg", bitrateKbps);
        const url = URL.createObjectURL(ogg);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${baseName}.ogg`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err: any) {
      const message = err?.message || "Export failed.";
      setRenderError(message);
      alert(`Export failed: ${message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const hasSource = activeTab === "single" ? !!mainFile : combinedFiles.length > 0;
  const hasPreviewTarget = previewSource === "rendered" ? !!generatedFile : hasSource;
  const activeLayer = combinedFiles.find((file) => file.id === activeLayerId) || null;

  return (
    <main className="min-h-screen bg-app text-app">
      <div className="app-shell">
        <header className="app-topbar">
          <div className="flex items-center gap-3">
            <div className="app-logo">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-app-dim">LoopAtoms</p>
              <h1 className="text-lg font-semibold tracking-tight">Atmos Editor</h1>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-3">
            <span className="chip">Engine v1.2</span>
            <span className="chip chip-accent">Project Ready</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden lg:flex items-center gap-2">
              <select
                value={previewSource}
                onChange={(e) => setPreviewSource(e.target.value as "source" | "rendered")}
                className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 outline-none focus:border-[rgba(34,211,166,0.6)]"
              >
                <option value="source">Active Clip (pre-render)</option>
                <option value="rendered" disabled={!generatedFile}>
                  Rendered Master
                </option>
              </select>
            </div>
            <button
              className="btn btn-ghost"
              onClick={toggleSeamlessPreview}
              disabled={isProcessing || !hasPreviewTarget}
            >
              {isProcessing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isSeamlessPlaying ? (
                <Square className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {isSeamlessPlaying ? "Stop Preview" : "Live Preview"}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleRender}
              disabled={isProcessing || !hasSource}
            >
              {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Render
            </button>
            <button
              className="btn btn-ghost"
              onClick={handleExport}
              disabled={isProcessing || !generatedFile}
            >
              <Download className="h-4 w-4" />
              Export
            </button>
          </div>
        </header>

        <div className="app-body">
          <aside className="panel panel-left">
            <div className="panel-header">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-app-accent" />
                <h2 className="text-sm font-semibold tracking-tight">Sources</h2>
              </div>
              <div className="panel-tabs">
                <button
                  onClick={() => setActiveTab("single")}
                  className={`tab ${activeTab === "single" ? "tab-active" : ""}`}
                >
                  Single
                </button>
                <button
                  onClick={() => setActiveTab("combine")}
                  className={`tab ${activeTab === "combine" ? "tab-active" : ""}`}
                >
                  Layers
                </button>
              </div>
            </div>

            <div className="panel-body space-y-5">
              {activeTab === "single" ? (
                !mainFile ? (
                  <label className="dropzone group relative overflow-hidden">
                    <input
                      type="file"
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      accept="audio/*"
                      onChange={handleMainFileChange}
                    />
                    <div className="dropzone-icon">
                      <Download className="h-5 w-5" />
                    </div>
                    <div className="space-y-1 text-center">
                      <p className="text-sm font-semibold">Drop source file</p>
                      <p className="text-xs text-app-dim">WAV, MP3, OGG, FLAC</p>
                    </div>
                  </label>
                ) : (
                  <div className="file-card file-card-elevated">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="file-icon">
                        <FileAudio className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p
                          className="text-sm font-semibold truncate file-card-title"
                          title={mainFile.name}
                        >
                          {mainFile.name}
                        </p>
                        <p className="text-xs text-app-dim">
                          {(mainFile.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                    </div>
                    <button className="btn btn-ghost shrink-0" onClick={() => setMainFile(null)}>
                      Change
                    </button>
                  </div>
                )
              ) : (
                <CombinedFileList
                  files={combinedFiles}
                  activeId={activeLayerId}
                  onSelect={setActiveLayerId}
                  onRemove={removeFromList}
                  onAdd={addToList}
                  onReorder={reorderList}
                />
              )}

              <div className="panel-note">
                <Info className="h-4 w-4 text-app-accent" />
                <p className="text-xs text-app-dim">
                  Crossfade keeps the loop seamless by blending the head and tail.
                  Layer mode merges files sequentially before looping.
                </p>
              </div>
            </div>
          </aside>

          <section className="panel panel-main">
            <div className="panel-header">
              <div className="flex items-center gap-2">
                <Monitor className="h-4 w-4 text-app-accent" />
                <h2 className="text-sm font-semibold tracking-tight">Timeline</h2>
              </div>
              <div className="flex items-center gap-2 text-xs text-app-dim">
                <span>{activeTab === "single" ? "Single" : "Layered"}</span>
                <ChevronRight className="h-3 w-3" />
                <span>{hasSource ? "Ready" : "Waiting for input"}</span>
              </div>
            </div>

            <div className="panel-body space-y-6">
              {activeTab === "single" && mainFile && (
                <div className="wave-card">
                  <div className="wave-card-header">
                    <div>
                      <p className="wave-card-kicker">Source</p>
                      <p className="wave-card-title" title={mainFile.name}>
                        {mainFile.name}
                      </p>
                    </div>
                    <span className="chip">{(mainFile.size / 1024 / 1024).toFixed(2)} MB</span>
                  </div>
                  <WaveformVisualizer
                    file={mainFile}
                    showRawLoopOption={true}
                    showLoopRange={true}
                    loopStart={singleLoopRange?.start}
                    loopEnd={singleLoopRange?.end}
                    onLoopChange={(start, end) => setSingleLoopRange({ start, end })}
                    onDuration={(duration) => {
                      if (!singleLoopRange) {
                        setSingleLoopRange({ start: 0, end: duration });
                      }
                    }}
                    autoPlayToken={singlePreviewToken}
                    autoPlayRaw={true}
                  />
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs uppercase tracking-[0.3em] text-app-dim">Auto Loop</p>
                      <button
                        className="btn btn-ghost"
                        onClick={async () => {
                          if (!mainFile) return;
                          setDetectingSingle(true);
                          const results = await computeLoopCandidates(mainFile, crossfadeDuration, 3);
                          setSingleCandidates(results);
                          setDetectingSingle(false);
                        }}
                        disabled={detectingSingle}
                      >
                        {detectingSingle ? "Analyzing..." : "Detect"}
                      </button>
                    </div>
                    {singleCandidates.length > 0 ? (
                      <div className="space-y-2">
                        {singleCandidates.map((candidate, index) => (
                          <div
                            key={`${candidate.start}-${candidate.end}-${index}`}
                            className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs"
                          >
                            <span className="text-white/70">
                              {candidate.start.toFixed(2)}s → {candidate.end.toFixed(2)}s
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                className="btn btn-ghost"
                                onClick={() => {
                                  setSingleLoopRange({ start: candidate.start, end: candidate.end });
                                  setSinglePreviewToken((t) => t + 1);
                                }}
                              >
                                Preview
                              </button>
                              <button
                                className="btn btn-primary"
                                onClick={() => setSingleLoopRange({ start: candidate.start, end: candidate.end })}
                              >
                                Use
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-app-dim">No candidates yet.</p>
                    )}
                  </div>
                </div>
              )}

              {activeTab === "combine" && combinedFiles.length > 0 && activeLayer && (
                <div className="wave-card">
                  <div className="wave-card-header">
                    <div>
                      <p className="wave-card-kicker">Layer Preview</p>
                      <p className="wave-card-title" title={activeLayer.file.name}>
                        {activeLayer.file.name}
                      </p>
                    </div>
                    <span className="chip">{combinedFiles.length} files</span>
                  </div>
                  <WaveformVisualizer
                    file={activeLayer.file}
                    showRawLoopOption={true}
                    showLoopRange={true}
                    loopStart={layerLoopRanges[activeLayer.id]?.start}
                    loopEnd={layerLoopRanges[activeLayer.id]?.end}
                    onLoopChange={(start, end) =>
                      setLayerLoopRanges((prev) => ({
                        ...prev,
                        [activeLayer.id]: { start, end },
                      }))
                    }
                    onDuration={(duration) => {
                      if (!layerLoopRanges[activeLayer.id]) {
                        setLayerLoopRanges((prev) => ({
                          ...prev,
                          [activeLayer.id]: { start: 0, end: duration },
                        }));
                      }
                    }}
                    autoPlayToken={layerPreviewTokens[activeLayer.id] ?? 0}
                    autoPlayRaw={true}
                  />
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs uppercase tracking-[0.3em] text-app-dim">Auto Loop</p>
                      <button
                        className="btn btn-ghost"
                        onClick={async () => {
                          if (!activeLayer) return;
                          setDetectingLayer((prev) => ({ ...prev, [activeLayer.id]: true }));
                          const results = await computeLoopCandidates(
                            activeLayer.file,
                            crossfadeDuration,
                            3
                          );
                          setLayerCandidates((prev) => ({ ...prev, [activeLayer.id]: results }));
                          setDetectingLayer((prev) => ({ ...prev, [activeLayer.id]: false }));
                        }}
                        disabled={detectingLayer[activeLayer.id]}
                      >
                        {detectingLayer[activeLayer.id] ? "Analyzing..." : "Detect"}
                      </button>
                    </div>
                    {(layerCandidates[activeLayer.id]?.length ?? 0) > 0 ? (
                      <div className="space-y-2">
                        {layerCandidates[activeLayer.id].map((candidate, index) => (
                          <div
                            key={`${candidate.start}-${candidate.end}-${index}`}
                            className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs"
                          >
                            <span className="text-white/70">
                              {candidate.start.toFixed(2)}s → {candidate.end.toFixed(2)}s
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                className="btn btn-ghost"
                                onClick={() => {
                                  setLayerLoopRanges((prev) => ({
                                    ...prev,
                                    [activeLayer.id]: { start: candidate.start, end: candidate.end },
                                  }));
                                  setLayerPreviewTokens((prev) => ({
                                    ...prev,
                                    [activeLayer.id]: (prev[activeLayer.id] ?? 0) + 1,
                                  }));
                                }}
                              >
                                Preview
                              </button>
                              <button
                                className="btn btn-primary"
                                onClick={() =>
                                  setLayerLoopRanges((prev) => ({
                                    ...prev,
                                    [activeLayer.id]: { start: candidate.start, end: candidate.end },
                                  }))
                                }
                              >
                                Use
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-app-dim">No candidates yet.</p>
                    )}
                  </div>
                </div>
              )}

              {!hasSource && (
                <div className="empty-state">
                  <p className="text-sm font-semibold">Add audio to begin</p>
                  <p className="text-xs text-app-dim">The timeline appears here after you select files.</p>
                </div>
              )}

              {generatedFile && hasSource && (
                <div className="wave-card">
                  <div className="wave-card-header">
                    <div>
                      <p className="wave-card-kicker">Master</p>
                      <p className="wave-card-title" title={generatedFile.name}>
                        {generatedFile.name}
                      </p>
                    </div>
                    <span className="chip chip-accent">Rendered</span>
                  </div>
                  <WaveformVisualizer
                    file={generatedFile}
                    showRawLoopOption={true}
                    rawLoopLabel="Loop"
                  />
                </div>
              )}
              {renderError && (
                <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-200">
                  {renderError}
                </div>
              )}
            </div>
          </section>

          <aside className="panel panel-right">
            <div className="panel-header">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-app-accent" />
                <h2 className="text-sm font-semibold tracking-tight">Inspector</h2>
              </div>
            </div>
            <div className="panel-body space-y-6">
              <div>
                <div className="flex items-end justify-between mb-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-app-dim">Crossfade</p>
                    <p className="text-xs text-app-dim">Overlap duration</p>
                  </div>
                  <p className="text-2xl font-semibold tabular-nums text-app-accent">
                    {crossfadeDuration.toFixed(1)}s
                  </p>
                </div>
                <input
                  type="range"
                  min="0"
                  max="10.0"
                  step="0.01"
                  value={crossfadeDuration}
                  onChange={(e) => setCrossfadeDuration(parseFloat(e.target.value))}
                  className="w-full accent-app cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-app-dim mt-2">
                  <span>0.0s</span>
                  <span>10.0s</span>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <select
                    value={crossfadeCurve}
                    onChange={(e) => setCrossfadeCurve(e.target.value as "tri" | "qsin" | "exp")}
                    className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 outline-none focus:border-[rgba(34,211,166,0.6)] glass-effect hover:border-white/20 transition-all"
                  >
                    <option value="tri">Linear</option>
                    <option value="qsin">Equal power</option>
                    <option value="exp">Exponential</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-end justify-between mb-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-app-dim">Total Duration</p>
                    <p className="text-xs text-app-dim">Leave empty for natural length</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={targetDuration}
                    onChange={(e) => setTargetDuration(e.target.value)}
                    placeholder="e.g. 180"
                    className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 outline-none focus:border-[rgba(34,211,166,0.6)] glass-effect hover:border-white/20 transition-all"
                  />
                  <span className="text-xs text-app-dim">sec</span>
                </div>
                <label className="mt-3 flex items-center gap-2 text-xs text-app-dim">
                  <input
                    type="checkbox"
                    checked={useSampleAccurateTrim}
                    onChange={(e) => setUseSampleAccurateTrim(e.target.checked)}
                    className="h-4 w-4 accent-app"
                  />
                  Sample-accurate trim
                </label>
              </div>

              <div>
                <div className="flex items-end justify-between mb-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-app-dim">Normalize</p>
                    <p className="text-xs text-app-dim">Per-clip loudness or peak</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={normalizeMode}
                    onChange={(e) => setNormalizeMode(e.target.value as "off" | "peak" | "lufs")}
                    className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 outline-none focus:border-[rgba(34,211,166,0.6)] glass-effect hover:border-white/20 transition-all"
                  >
                    <option value="off">Off</option>
                    <option value="peak">Peak (dBFS)</option>
                    <option value="lufs">LUFS (EBU R128)</option>
                  </select>
                </div>

                {normalizeMode === "peak" && (
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      type="number"
                      step="0.1"
                      value={normalizePeakDb}
                      onChange={(e) => setNormalizePeakDb(e.target.value)}
                      className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 outline-none focus:border-[rgba(34,211,166,0.6)] glass-effect hover:border-white/20 transition-all"
                    />
                    <span className="text-xs text-app-dim">dBFS</span>
                  </div>
                )}

                {normalizeMode === "lufs" && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step="0.1"
                        value={normalizeLufs}
                        onChange={(e) => setNormalizeLufs(e.target.value)}
                        className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 outline-none focus:border-[rgba(34,211,166,0.6)] glass-effect hover:border-white/20 transition-all"
                      />
                      <span className="text-xs text-app-dim">LUFS</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step="0.1"
                        value={normalizeTruePeak}
                        onChange={(e) => setNormalizeTruePeak(e.target.value)}
                        className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 outline-none focus:border-[rgba(34,211,166,0.6)] glass-effect hover:border-white/20 transition-all"
                      />
                      <span className="text-xs text-app-dim">dBTP</span>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-end justify-between mb-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-app-dim">Export Formats</p>
                    <p className="text-xs text-app-dim">Multiple outputs allowed</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-app-dim">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={exportWav}
                      onChange={(e) => setExportWav(e.target.checked)}
                      className="h-4 w-4 accent-app"
                    />
                    WAV
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={exportMp3}
                      onChange={(e) => setExportMp3(e.target.checked)}
                      className="h-4 w-4 accent-app"
                    />
                    MP3
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={exportOgg}
                      onChange={(e) => setExportOgg(e.target.checked)}
                      className="h-4 w-4 accent-app"
                    />
                    OGG
                  </label>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <select
                    value={exportBitrate}
                    onChange={(e) => setExportBitrate(e.target.value)}
                    className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 outline-none focus:border-[rgba(34,211,166,0.6)] glass-effect hover:border-white/20 transition-all"
                  >
                    <option value="96">96 kbps</option>
                    <option value="128">128 kbps</option>
                    <option value="192">192 kbps</option>
                    <option value="256">256 kbps</option>
                    <option value="320">320 kbps</option>
                  </select>
                  <span className="text-xs text-app-dim">CBR</span>
                </div>
              </div>

              <div className="panel-note">
                <Info className="h-4 w-4 text-app-accent" />
                <p className="text-xs text-app-dim">
                  Preview uses the selected source. Render generates a new master file.
                </p>
              </div>

              {generatedFile && (
                <div className="meta-card">
                  <div className="flex items-center justify-between text-xs text-app-dim">
                    <span>Format</span>
                    <span>WAV PCM</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-app-dim">
                    <span>Size</span>
                    <span>{(generatedFile.size / 1024 / 1024).toFixed(2)} MB</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-app-dim">
                    <span>Status</span>
                    <span className="text-app-accent">Verified</span>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>

        <footer className="app-footer">
          <div className="text-xs text-app-dim">Output: 48kHz stereo WAV, seamless crossfade</div>
          <div className="text-xs text-app-dim">Engine ready</div>
        </footer>
      </div>
    </main>
  );
}
