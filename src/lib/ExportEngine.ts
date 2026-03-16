import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

export class ExportEngine {
  private ffmpeg: FFmpeg | null = null;
  private readonly targetSampleRate = 48000;

  private getFileExtension(file: File): string {
    const nameExt = file.name.split('.').pop()?.toLowerCase();
    if (nameExt && /^[a-z0-9]+$/.test(nameExt)) return nameExt;

    const mimeMap: Record<string, string> = {
      'audio/wav': 'wav',
      'audio/x-wav': 'wav',
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/ogg': 'ogg',
      'audio/flac': 'flac',
      'audio/aac': 'aac',
      'audio/mp4': 'm4a',
      'audio/x-m4a': 'm4a',
      'audio/webm': 'webm',
      'audio/opus': 'opus',
    };

    return mimeMap[file.type] || 'wav';
  }

  private async safeDelete(ff: FFmpeg, path: string) {
    try {
      await ff.deleteFile(path);
    } catch {
      // Ignore if the file does not exist.
    }
  }

  private async writeFileSafe(ff: FFmpeg, path: string, data: Uint8Array) {
    await this.safeDelete(ff, path);
    await ff.writeFile(path, data);
  }

  private async detectMaxVolume(ff: FFmpeg, inputName: string): Promise<number | null> {
    let maxVolume: number | null = null;
    const handler = ({ message }: { message: string }) => {
      const match = message.match(/max_volume:\s*(-?[\d.]+)\s*dB/i);
      if (match) {
        const value = Number.parseFloat(match[1]);
        if (Number.isFinite(value)) {
          maxVolume = value;
        }
      }
    };

    ff.on('log', handler);
    try {
      await ff.exec(['-i', inputName, '-af', 'volumedetect', '-f', 'null', '-']);
    } finally {
      (ff as any).off?.('log', handler);
    }

    return maxVolume;
  }

  private async detectLoudnorm(
    ff: FFmpeg,
    inputName: string,
    lufs: number,
    truePeak: number,
    lra: number
  ) {
    let jsonBuffer = '';
    let isCollecting = false;
    let result: any = null;

    const handler = ({ message }: { message: string }) => {
      if (!isCollecting) {
        const start = message.indexOf('{');
        if (start !== -1) {
          isCollecting = true;
          jsonBuffer = message.slice(start);
        }
      } else {
        jsonBuffer += message;
      }

      if (isCollecting && jsonBuffer.includes('}')) {
        const end = jsonBuffer.lastIndexOf('}') + 1;
        const jsonText = jsonBuffer.slice(0, end);
        try {
          result = JSON.parse(jsonText);
        } catch {
          // ignore parse errors
        }
        isCollecting = false;
        jsonBuffer = '';
      }
    };

    ff.on('log', handler);
    try {
      await ff.exec([
        '-i',
        inputName,
        '-af',
        `loudnorm=I=${lufs}:TP=${truePeak}:LRA=${lra}:print_format=json`,
        '-f',
        'null',
        '-',
      ]);
    } finally {
      (ff as any).off?.('log', handler);
    }

    return result;
  }

  private buildLoudnormFilter(
    lufs: number,
    truePeak: number,
    lra: number,
    measured: any
  ) {
    if (!measured) return '';

    const measuredI = measured.input_i ?? measured.measured_I ?? measured.measured_i;
    const measuredTP = measured.input_tp ?? measured.measured_TP ?? measured.measured_tp;
    const measuredLRA = measured.input_lra ?? measured.measured_LRA ?? measured.measured_lra;
    const measuredThresh =
      measured.input_thresh ?? measured.measured_thresh ?? measured.measured_Thresh;
    const offset = measured.target_offset ?? measured.offset;

    if (
      [measuredI, measuredTP, measuredLRA, measuredThresh, offset].some(
        (value) => value === undefined || value === null
      )
    ) {
      return '';
    }

    return `,loudnorm=I=${lufs}:TP=${truePeak}:LRA=${lra}` +
      `:measured_I=${measuredI}:measured_TP=${measuredTP}` +
      `:measured_LRA=${measuredLRA}:measured_thresh=${measuredThresh}` +
      `:offset=${offset}:linear=true:print_format=summary`;
  }

  async init() {
    if (this.ffmpeg) return;

    this.ffmpeg = new FFmpeg();

    this.ffmpeg.on('log', ({ message }) => {
      console.log('FFmpeg Log:', message);
    });

    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
    await this.ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
  }

  async transcode(
    input: Blob,
    format: 'mp3' | 'ogg',
    bitrateKbps: number
  ): Promise<Blob> {
    if (!this.ffmpeg) await this.init();
    const ff = this.ffmpeg!;

    await this.writeFileSafe(ff, 'export_input.wav', new Uint8Array(await input.arrayBuffer()));
    const outputName = `export_output.${format}`;
    await this.safeDelete(ff, outputName);

    const codecArgs =
      format === 'mp3'
        ? ['-codec:a', 'libmp3lame']
        : ['-codec:a', 'libvorbis'];

    await ff.exec([
      '-y',
      '-i',
      'export_input.wav',
      ...codecArgs,
      '-b:a',
      `${bitrateKbps}k`,
      outputName,
    ]);

    const data = await ff.readFile(outputName);
    const mime = format === 'mp3' ? 'audio/mpeg' : 'audio/ogg';
    // @ts-ignore
    return new Blob([data], { type: mime });
  }

  async exportSeamlessLoop(
    file: File,
    crossfadeDuration: number,
    targetDuration?: number,
    sourceDuration?: number,
    useSampleAccurateTrim: boolean = false,
    normalizeOptions?:
      | { mode: 'peak'; peakDb: number }
      | { mode: 'lufs'; lufs: number; truePeak: number; lra: number }
    ,
    crossfadeCurve: string = 'tri',
    loopStart?: number,
    loopEnd?: number
  ): Promise<Blob> {
    if (!this.ffmpeg) await this.init();
    const ff = this.ffmpeg!;

    const inputExt = this.getFileExtension(file);
    const inputName = `input.${inputExt}`;

    await this.writeFileSafe(ff, inputName, await fetchFile(file));
    await this.safeDelete(ff, 'output_loop.wav');

    let normalizeFilter = '';
    if (normalizeOptions?.mode === 'peak') {
      const maxVolume = await this.detectMaxVolume(ff, inputName);
      if (maxVolume !== null) {
        const gain = normalizeOptions.peakDb - maxVolume;
        if (Number.isFinite(gain) && Math.abs(gain) > 0.0001) {
          normalizeFilter = `,volume=${gain}dB`;
        }
      }
    }

    if (normalizeOptions?.mode === 'lufs') {
      const measured = await this.detectLoudnorm(
        ff,
        inputName,
        normalizeOptions.lufs,
        normalizeOptions.truePeak,
        normalizeOptions.lra
      );
      normalizeFilter = this.buildLoudnormFilter(
        normalizeOptions.lufs,
        normalizeOptions.truePeak,
        normalizeOptions.lra,
        measured
      );
    }

    const quantizeSamples = (value: number) =>
      Math.round(value * this.targetSampleRate);
    const loopStartSamples =
      typeof loopStart === 'number' ? quantizeSamples(loopStart) : null;
    const loopEndSamples =
      typeof loopEnd === 'number' ? quantizeSamples(loopEnd) : null;
    const snappedLoopStart =
      loopStartSamples !== null ? loopStartSamples / this.targetSampleRate : loopStart;
    const snappedLoopEnd =
      loopEndSamples !== null ? loopEndSamples / this.targetSampleRate : loopEnd;

    const hasLoopRange =
      typeof snappedLoopStart === 'number' &&
      typeof snappedLoopEnd === 'number' &&
      snappedLoopEnd > snappedLoopStart;

    const shouldLoopInput =
      !hasLoopRange &&
      typeof targetDuration === 'number' &&
      typeof sourceDuration === 'number' &&
      targetDuration + crossfadeDuration > sourceDuration;

    const inputArgs = shouldLoopInput
      ? ['-stream_loop', '-1', '-i', inputName]
      : ['-i', inputName];

    let baseChain: string;
    const targetSamplesExact =
      typeof targetDuration === 'number'
        ? Math.round(targetDuration * this.targetSampleRate)
        : null;
    const loopRangeDuration =
      hasLoopRange && loopStartSamples !== null && loopEndSamples !== null
        ? (loopEndSamples - loopStartSamples) / this.targetSampleRate
        : null;
    const loopTrim = hasLoopRange
      ? `,atrim=start_sample=${loopStartSamples}:end_sample=${loopEndSamples},asetpts=PTS-STARTPTS`
      : '';
    if (typeof targetDuration === 'number') {
      if (useSampleAccurateTrim) {
        const targetSamples = Math.round((targetDuration + crossfadeDuration) * this.targetSampleRate);
        const loopSamples =
          loopRangeDuration !== null
            ? Math.round(loopRangeDuration * this.targetSampleRate)
            : null;
        const loopExtend =
          loopSamples && loopRangeDuration && targetDuration + crossfadeDuration > loopRangeDuration
            ? `,aloop=loop=-1:size=${loopSamples}`
            : '';
        baseChain =
          `[0:a]aresample=${this.targetSampleRate},aformat=sample_fmts=s16:channel_layouts=stereo${normalizeFilter}` +
          `${loopTrim}${loopExtend},atrim=start_sample=0:end_sample=${targetSamples},asetpts=PTS-STARTPTS[base];`;
      } else {
        const loopSamples =
          loopRangeDuration !== null
            ? Math.round(loopRangeDuration * this.targetSampleRate)
            : null;
        const loopExtend =
          loopSamples && loopRangeDuration && targetDuration + crossfadeDuration > loopRangeDuration
            ? `,aloop=loop=-1:size=${loopSamples}`
            : '';
        baseChain =
          `[0:a]aresample=${this.targetSampleRate},aformat=sample_fmts=s16:channel_layouts=stereo${normalizeFilter}` +
          `${loopTrim}${loopExtend},atrim=start=0:end=${targetDuration + crossfadeDuration},asetpts=PTS-STARTPTS[base];`;
      }
    } else {
      baseChain =
        `[0:a]aresample=${this.targetSampleRate},aformat=sample_fmts=s16:channel_layouts=stereo${normalizeFilter}` +
        `${loopTrim}[base];`;
    }

    const finalTrim =
      useSampleAccurateTrim && targetSamplesExact !== null
        ? `,atrim=start_sample=0:end_sample=${targetSamplesExact},asetpts=PTS-STARTPTS`
        : '';

    if (crossfadeDuration <= 0) {
      const finalChain = finalTrim
        ? `${baseChain}[base]${finalTrim}`
        : `${baseChain}[base]anull`;
      await ff.exec(['-y', ...inputArgs, '-filter_complex', finalChain, 'output_loop.wav']);
    } else {
      await ff.exec([
        '-y',
        ...inputArgs,
        '-filter_complex',
        baseChain +
          `[base]asplit=2[a][b];` +
          `[a]atrim=start=0:end=${crossfadeDuration}[start];` +
          `[b]atrim=start=${crossfadeDuration}[main];` +
          `[main][start]acrossfade=d=${crossfadeDuration}:c1=${crossfadeCurve}:c2=${crossfadeCurve}${finalTrim}`,
        'output_loop.wav',
      ]);
    }

    const data = await ff.readFile('output_loop.wav');
    // @ts-ignore
    return new Blob([data], { type: 'audio/wav' });
  }

  async combineAndLoop(
    files: File[],
    crossfadeDuration: number,
    targetDuration?: number,
    sourceDurations?: number[],
    useSampleAccurateTrim: boolean = false,
    normalizeOptions?:
      | { mode: 'peak'; peakDb: number }
      | { mode: 'lufs'; lufs: number; truePeak: number; lra: number }
    ,
    crossfadeCurve: string = 'tri',
    loopRanges?: Array<{ start: number; end: number } | null>
  ): Promise<Blob> {
    if (!this.ffmpeg) await this.init();
    const ff = this.ffmpeg!;

    if (files.length === 0) throw new Error('No files selected');

    const inputNames: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const ext = this.getFileExtension(files[i]);
      const name = `in_${i}.${ext}`;
      inputNames.push(name);
      await this.writeFileSafe(ff, name, await fetchFile(files[i]));
    }

    if (files.length === 1) {
      return this.exportSeamlessLoop(
        files[0],
        crossfadeDuration,
        targetDuration,
        sourceDurations?.[0],
        useSampleAccurateTrim,
        normalizeOptions,
        crossfadeCurve,
        loopRanges?.[0]?.start,
        loopRanges?.[0]?.end
      );
    }

    let targetLengths: number[] | null = null;
    let shouldLoopInputs = false;

    if (
      typeof targetDuration === 'number' &&
      sourceDurations &&
      sourceDurations.length === files.length
    ) {
      const sum = sourceDurations.reduce((acc, value) => acc + value, 0);
      const desiredSum =
        targetDuration + crossfadeDuration * (files.length - 1) + crossfadeDuration;
      const ratio = desiredSum / sum;
      targetLengths = sourceDurations.map((value) => value * ratio);
      shouldLoopInputs = ratio > 1;
    }

    const filterParts: string[] = [];
    const normalizeFilters: string[] = [];

    if (normalizeOptions?.mode === 'peak') {
      for (let i = 0; i < inputNames.length; i++) {
        const maxVolume = await this.detectMaxVolume(ff, inputNames[i]);
        if (maxVolume !== null) {
          const gain = normalizeOptions.peakDb - maxVolume;
          if (Number.isFinite(gain) && Math.abs(gain) > 0.0001) {
            normalizeFilters.push(`,volume=${gain}dB`);
          } else {
            normalizeFilters.push('');
          }
        } else {
          normalizeFilters.push('');
        }
      }
    } else if (normalizeOptions?.mode === 'lufs') {
      for (let i = 0; i < inputNames.length; i++) {
        const measured = await this.detectLoudnorm(
          ff,
          inputNames[i],
          normalizeOptions.lufs,
          normalizeOptions.truePeak,
          normalizeOptions.lra
        );
        normalizeFilters.push(
          this.buildLoudnormFilter(
            normalizeOptions.lufs,
            normalizeOptions.truePeak,
            normalizeOptions.lra,
            measured
          )
        );
      }
    } else {
      for (let i = 0; i < inputNames.length; i++) {
        normalizeFilters.push('');
      }
    }

    for (let i = 0; i < files.length; i++) {
      const loopRange = loopRanges?.[i];
      const loopStartSamples =
        loopRange ? Math.round(loopRange.start * this.targetSampleRate) : null;
      const loopEndSamples =
        loopRange ? Math.round(loopRange.end * this.targetSampleRate) : null;
      const snappedLoopStart =
        loopStartSamples !== null ? loopStartSamples / this.targetSampleRate : loopRange?.start;
      const snappedLoopEnd =
        loopEndSamples !== null ? loopEndSamples / this.targetSampleRate : loopRange?.end;
      const loopRangeDuration =
        loopRange &&
        loopStartSamples !== null &&
        loopEndSamples !== null &&
        loopEndSamples > loopStartSamples
          ? (loopEndSamples - loopStartSamples) / this.targetSampleRate
          : null;
      const loopSamples =
        loopRangeDuration !== null
          ? Math.round(loopRangeDuration * this.targetSampleRate)
          : null;
      const loopTrim =
        loopRange &&
        loopStartSamples !== null &&
        loopEndSamples !== null &&
        loopEndSamples > loopStartSamples
          ? `,atrim=start_sample=${loopStartSamples}:end_sample=${loopEndSamples},asetpts=PTS-STARTPTS`
          : '';
      const base =
        `[${i}:a]aresample=${this.targetSampleRate},` +
        `aformat=sample_fmts=s16:channel_layouts=stereo${normalizeFilters[i]}`;
      if (targetLengths) {
        const loopExtend =
          loopSamples && targetLengths[i] > loopRangeDuration!
            ? `,aloop=loop=-1:size=${loopSamples}`
            : '';
        if (useSampleAccurateTrim) {
          const targetSamples = Math.round(targetLengths[i] * this.targetSampleRate);
          filterParts.push(
            `${base}${loopTrim}${loopExtend},atrim=start_sample=0:end_sample=${targetSamples},asetpts=PTS-STARTPTS[a${i}]`
          );
        } else {
          filterParts.push(
            `${base}${loopTrim}${loopExtend},atrim=start=0:end=${targetLengths[i]},asetpts=PTS-STARTPTS[a${i}]`
          );
        }
      } else {
        filterParts.push(`${base}${loopTrim}[a${i}]`);
      }
    }

    if (crossfadeDuration <= 0) {
      const concatInputs = files.map((_, i) => `[a${i}]`).join('');
      filterParts.push(`${concatInputs}concat=n=${files.length}:v=0:a=1[combined]`);
    } else {
      let lastLabel = '[a0]';
      for (let i = 1; i < files.length; i++) {
        const nextLabel = `[c${i}]`;
        filterParts.push(
          `${lastLabel}[a${i}]acrossfade=d=${crossfadeDuration}:c1=${crossfadeCurve}:c2=${crossfadeCurve}${
            i === files.length - 1 ? '[combined]' : nextLabel
          }`
        );
        lastLabel = nextLabel;
      }
    }

    const filter = filterParts.join(';');
    const inputs = inputNames.flatMap((name, index) => {
      const loopRange = loopRanges?.[index];
      const allowStreamLoop = shouldLoopInputs && !(loopRange && loopRange.end > loopRange.start);
      return allowStreamLoop ? ['-stream_loop', '-1', '-i', name] : ['-i', name];
    });

    await this.safeDelete(ff, 'temp_combined.wav');
    await ff.exec(['-y', ...inputs, '-filter_complex', filter, '-map', '[combined]', 'temp_combined.wav']);

    await this.safeDelete(ff, 'final_output.wav');
    const finalTargetSamples =
      useSampleAccurateTrim && typeof targetDuration === 'number'
        ? Math.round(targetDuration * this.targetSampleRate)
        : null;
    const finalTrim = finalTargetSamples !== null
      ? `,atrim=start_sample=0:end_sample=${finalTargetSamples},asetpts=PTS-STARTPTS`
      : '';
    if (crossfadeDuration <= 0) {
      const finalChain = finalTrim ? `[0:a]${finalTrim}` : `[0:a]anull`;
      await ff.exec(['-y', '-i', 'temp_combined.wav', '-filter_complex', finalChain, 'final_output.wav']);
    } else {
      await ff.exec([
        '-y',
        '-i',
        'temp_combined.wav',
        '-filter_complex',
        `asplit=2[a][b];` +
          `[a]atrim=start=0:end=${crossfadeDuration}[start];` +
          `[b]atrim=start=${crossfadeDuration}[main];` +
          `[main][start]acrossfade=d=${crossfadeDuration}:c1=${crossfadeCurve}:c2=${crossfadeCurve}${finalTrim}`,
        'final_output.wav',
      ]);
    }

    const data = await ff.readFile('final_output.wav');
    // @ts-ignore
    return new Blob([data], { type: 'audio/wav' });
  }
}
