import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ClipItem } from '../src/types/clip';
import { buildAssSubtitles, getOutputResolution } from '../src/utils/clipLogic';

const execFileAsync = promisify(execFile);

export interface VideoProbe {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

function parseFps(raw?: string): number {
  if (!raw) return 30;
  const parts = raw.split('/');
  let fps = 30;
  if (parts.length === 2) {
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    if (Number.isFinite(num) && Number.isFinite(den) && den > 0) {
      fps = num / den;
    }
  } else {
    fps = Number(raw);
  }
  if (!Number.isFinite(fps) || fps <= 0) return 30;
  return Math.min(60, Math.max(24, Math.round(fps)));
}

export async function probeVideo(filePath: string): Promise<VideoProbe> {
  let stdout = '';
  try {
    const res = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);
    stdout = res.stdout;
  } catch (err) {
    const stderr =
      err && typeof err === 'object' && 'stderr' in err
        ? String((err as { stderr?: unknown }).stderr ?? '').trim()
        : '';
    throw new Error(
      stderr
        ? `Não foi possível ler o arquivo de vídeo (${stderr.split('\n')[0]}). Tente reenviar o arquivo.`
        : 'Não foi possível ler os metadados do arquivo de vídeo. Verifique se o envio foi concluído e tente novamente.'
    );
  }

  const parsed = JSON.parse(stdout || '{}');
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const videoStream = streams.find((s: { codec_type?: string }) => s.codec_type === 'video');
  const audioStream = streams.find((s: { codec_type?: string }) => s.codec_type === 'audio');

  if (!videoStream) {
    throw new Error('O arquivo enviado não possui trilha de vídeo válida.');
  }

  const rawDuration = Number(parsed.format?.duration ?? videoStream?.duration ?? 0);
  const duration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 60;

  return {
    duration,
    width: Number(videoStream?.width ?? 1280),
    height: Number(videoStream?.height ?? 720),
    fps: parseFps(videoStream?.r_frame_rate ?? videoStream?.avg_frame_rate),
    hasAudio: Boolean(audioStream),
  };
}

/**
 * Gera um vídeo exemplo MP4 real (90s, 1280x720) caso ainda não exista em disco.
 */
export async function ensureDemoVideo(demoPath: string): Promise<void> {
  try {
    const stat = await fs.stat(demoPath);
    if (stat.size > 50_000) return;
  } catch {
    // file does not exist yet
  }

  await fs.mkdir(path.dirname(demoPath), { recursive: true });

  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x0F172A:s=1280x720:d=90:r=24',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=220:sample_rate=44100:duration=90',
      '-vf',
      "drawbox=x=240:y=60:w=800:h=600:color=0x1E293B@0.95:t=fill,drawbox=x=440:y=160:w=400:h=240:color=0x312E81@0.95:t=fill,drawbox=x=440:y=160:w=400:h=6:color=0x6366F1:t=fill,drawtext=text='ESTUDIO CORTEFACIL':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=220,drawtext=text='Podcast Estrategia':fontcolor=0xCBD5E1:fontsize=22:x=(w-text_w)/2:y=265,drawtext=text='%{pts\\:hms}':fontcolor=0xA5B4FC:fontsize=34:x=(w-text_w)/2:y=320",
      '-af',
      'volume=0.04',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '26',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-shortest',
      '-movflags',
      '+faststart',
      demoPath,
    ],
    { timeout: 60_000 }
  );
}

/**
 * Extrai apenas o áudio comprimido (16kHz mono 24kbps MP3) cobrindo 100% da duração do vídeo.
 * Um vídeo de 29 minutos gera apenas ~5.2 MB de MP3.
 */
export async function extractAudioTrack(
  videoPath: string,
  outAudioPath: string
): Promise<void> {
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-i',
      videoPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-b:a',
      '24k',
      '-f',
      'mp3',
      outAudioPath,
    ],
    { timeout: 300_000 }
  );
}

/**
 * Recorta uma janela de áudio (ex.: 10 minutos) com timestamps reiniciados em 0s
 * para análise precisa em blocos pelo Gemini em vídeos longos.
 */
export async function splitAudioWindow(
  audioPath: string,
  startSec: number,
  durationSec: number,
  outPath: string
): Promise<void> {
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-ss',
      String(Math.max(0, startSec)),
      '-t',
      String(Math.max(1, durationSec)),
      '-i',
      audioPath,
      '-ac',
      '1',
      '-ar',
      '16000',
      '-b:a',
      '24k',
      '-f',
      'mp3',
      outPath,
    ],
    { timeout: 120_000 }
  );
}

/**
 * Extrai versão leve de vídeo caso o arquivo original não tenha trilha de áudio.
 */
export async function extractCompactVideo(
  videoPath: string,
  outVideoPath: string
): Promise<void> {
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-i',
      videoPath,
      '-vf',
      'scale=640:-2,fps=2',
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '32',
      '-pix_fmt',
      'yuv420p',
      outVideoPath,
    ],
    { timeout: 240_000 }
  );
}

export interface RenderClipOptions {
  sourcePath: string;
  clip: ClipItem;
  outputPath: string;
  workDir: string;
  onProgress?: (pct: number) => void;
}

/**
 * Renderiza um corte real em MP4 preservando a resolução original da fonte (4K -> 4K, 1080p -> 1080p)
 * e taxa de quadros CFR sincronizada com vídeo, áudio e legendas ASS proporcionais.
 */
export async function renderClipToMp4({
  sourcePath,
  clip,
  outputPath,
  workDir,
  onProgress,
}: RenderClipOptions): Promise<void> {
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const sourceProbe = await probeVideo(sourcePath);
  const { width, height } = getOutputResolution(
    clip.format,
    sourceProbe.width,
    sourceProbe.height
  );
  const targetFps = sourceProbe.fps || 30;

  const assContent = buildAssSubtitles(clip, width, height);
  const assFilename = `subtitles_${clip.id.replace(/[^a-zA-Z0-9_-]/g, '')}.ass`;
  const assPath = path.join(workDir, assFilename);
  await fs.writeFile(assPath, assContent, 'utf8');

  const safeStart = Math.max(0, Number(clip.startTime) || 0);
  const duration = Math.max(1, Number(clip.endTime - safeStart) || 1);

  let videoFilterChain: string;
  if (clip.format === 'vertical') {
    if (clip.verticalFraming === 'fit') {
      videoFilterChain = [
        `[0:v:0]split=2[bg][fg]`,
        `[bg]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,gblur=sigma=14,scale=${width}:${height},setsar=1[bgb]`,
        `[fg]scale=${width}:-2:force_original_aspect_ratio=decrease[fgc]`,
        `[bgb][fgc]overlay=(W-w)/2:(H-h)/2,ass=${assFilename}[vout]`,
      ].join(';');
    } else {
      videoFilterChain = `[0:v:0]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,ass=${assFilename}[vout]`;
    }
  } else {
    videoFilterChain = `[0:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=#090D16,setsar=1,ass=${assFilename}[vout]`;
  }

  const args = [
    '-y',
    '-fflags',
    '+genpts',
    '-ss',
    safeStart.toFixed(3),
    '-i',
    sourcePath,
    '-t',
    duration.toFixed(3),
    '-avoid_negative_ts',
    'make_zero',
    '-filter_complex',
    videoFilterChain,
    '-map',
    '[vout]',
    '-map',
    '0:a:0?',
    '-r',
    String(targetFps),
    '-vsync',
    'cfr',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-threads',
    '4',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ac',
    '2',
    '-ar',
    '44100',
    '-movflags',
    '+faststart',
    outputPath,
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', args, { cwd: workDir });
    let stderrBuf = '';

    child.stderr.on('data', (chunk: Buffer) => {
      const str = chunk.toString();
      stderrBuf += str;
      const match = /time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/.exec(str);
      if (match && onProgress) {
        const currentSecs =
          Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        const pct = Math.min(95, Math.max(5, Math.round((currentSecs / duration) * 100)));
        onProgress(pct);
      }
    });

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) {
        onProgress?.(100);
        resolve();
      } else {
        reject(new Error(`FFmpeg saiu com código ${code}: ${stderrBuf.slice(-500)}`));
      }
    });
  });
}
