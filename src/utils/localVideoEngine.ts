import type { ClipItem, FilenamePreset } from '../types/clip';
import {
  getActiveCaptionAtTime,
  getActiveWordIndex,
  getCaptionPreset,
  getOutputResolution,
  resolveHeadStyle,
  slugifyHeadForFilename,
} from './clipLogic';

export interface LocalVideoProbe {
  mediaUrl: string;
  duration: number;
  width: number;
  height: number;
}

export function probeLocalVideoFile(file: File): Promise<LocalVideoProbe> {
  return new Promise((resolve, reject) => {
    const mediaUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = mediaUrl;

    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
    };

    video.onloadedmetadata = () => {
      const duration =
        Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 60;
      const width = video.videoWidth || 1280;
      const height = video.videoHeight || 720;
      cleanup();
      resolve({ mediaUrl, duration, width, height });
    };

    video.onerror = () => {
      URL.revokeObjectURL(mediaUrl);
      cleanup();
      reject(
        new Error('Não foi possível ler este arquivo de vídeo localmente neste navegador.')
      );
    };
  });
}

/**
 * Em MediaRecorder com canvas.captureStream(), codecs WebM (VP8/VP9 + Opus) são os únicos
 * que garantem faixa de vídeo + áudio estáveis no Chromium/Firefox sem gerar arquivo só com áudio.
 */
export function getSupportedRecorderFormat(): {
  mimeType: string;
  extension: 'webm';
} {
  if (typeof MediaRecorder === 'undefined') {
    return { mimeType: 'video/webm', extension: 'webm' };
  }

  const candidates: Array<{ mimeType: string; extension: 'webm' }> = [
    { mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' },
    { mimeType: 'video/webm', extension: 'webm' },
  ];

  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mimeType)) {
      return c;
    }
  }
  return { mimeType: '', extension: 'webm' };
}

/**
 * Analisa picos de energia de áudio localmente via Web Audio API (sem enviar vídeo para servidor).
 * Para arquivos muito grandes (>150MB), retorna [] rapidamente para evitar estouro de memória no browser.
 */
export async function detectLocalAudioPeaks(file: File): Promise<number[]> {
  if (file.size > 150 * 1024 * 1024) {
    return [];
  }
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return [];

    const ctx = new AudioCtx();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const duration = audioBuffer.duration;
    await ctx.close();

    const windowSize = Math.floor(sampleRate * 5);
    const scores: Array<{ time: number; rms: number }> = [];
    for (let offset = 0; offset + windowSize < channelData.length; offset += windowSize) {
      let sum = 0;
      const step = 32;
      let count = 0;
      for (let i = offset; i < offset + windowSize; i += step) {
        const v = channelData[i];
        sum += v * v;
        count++;
      }
      const rms = Math.sqrt(sum / Math.max(1, count));
      scores.push({ time: offset / sampleRate, rms });
    }

    scores.sort((a, b) => b.rms - a.rms);
    const picked: number[] = [];
    for (const item of scores) {
      if (item.time > duration - 8) continue;
      if (picked.every((t) => Math.abs(t - item.time) >= Math.min(25, duration * 0.12))) {
        picked.push(Math.max(0, Math.floor(item.time)));
      }
      if (picked.length >= 12) break;
    }
    return picked.sort((a, b) => a - b);
  } catch {
    return [];
  }
}

function wrapCanvasLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawFrameOverlays(
  ctx: CanvasRenderingContext2D,
  clip: ClipItem,
  sourceTime: number,
  outW: number,
  outH: number
) {
  const isVertical = clip.format === 'vertical';

  if (clip.showHeadOverlay && clip.head.trim()) {
    const headStyle = resolveHeadStyle(clip.headStyle);
    const headFontSize = Math.round(headStyle.fontSize * (isVertical ? 1.4 : 1.2));
    ctx.font = `700 ${headFontSize}px "Plus Jakarta Sans", "Liberation Sans", sans-serif`;
    const maxHeadWidth = outW * 0.84;
    const headLines = wrapCanvasLines(ctx, clip.head.trim(), maxHeadWidth);
    const lineHeight = headFontSize * 1.25;
    const boxPadX = 24;
    const boxPadY = 14;
    const maxLineW = Math.max(...headLines.map((l) => ctx.measureText(l).width), 80);
    const boxW = Math.min(outW - 48, maxLineW + boxPadX * 2);
    const boxH = headLines.length * lineHeight + boxPadY * 2;
    const boxX =
      headStyle.align === 'left'
        ? 36
        : headStyle.align === 'right'
        ? outW - boxW - 36
        : (outW - boxW) / 2;
    const boxY = isVertical ? 96 : 36;

    ctx.save();
    if (headStyle.hasBackground) {
      ctx.fillStyle = `${headStyle.backgroundColor}E6`;
      drawRoundedRect(ctx, boxX, boxY, boxW, boxH, 14);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.fillStyle = headStyle.textColor;
    ctx.textAlign = headStyle.align;
    ctx.textBaseline = 'top';
    const textAnchorX =
      headStyle.align === 'left'
        ? boxX + (headStyle.hasBackground ? boxPadX : 4)
        : headStyle.align === 'right'
        ? boxX + boxW - (headStyle.hasBackground ? boxPadX : 4)
        : boxX + boxW / 2;

    headLines.forEach((line, idx) => {
      const y = boxY + (headStyle.hasBackground ? boxPadY : 4) + idx * lineHeight;
      if (!headStyle.hasBackground) {
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(5, 7, 12, 0.96)';
        ctx.lineWidth = 6;
        ctx.strokeText(line, textAnchorX, y);
      }
      ctx.fillText(line, textAnchorX, y);
    });
    ctx.restore();
  }

  const activeCaption = getActiveCaptionAtTime(clip.captions, sourceTime);
  if (!activeCaption) return;

  const preset = getCaptionPreset(clip.captionPreset);
  const rawText = preset.uppercase
    ? activeCaption.text.toUpperCase()
    : activeCaption.text;

  const fontSize = isVertical
    ? preset.id === 'impacto'
      ? 46
      : preset.id === 'destaque'
      ? 42
      : preset.id === 'minimalista'
      ? 32
      : 38
    : preset.id === 'impacto'
    ? 38
    : preset.id === 'minimalista'
    ? 28
    : 34;

  const weight = preset.id === 'minimalista' ? '500' : '800';
  ctx.font = `${weight} ${fontSize}px ${preset.fontFamily}`;
  const maxWidth = outW * 0.86;
  const lines = wrapCanvasLines(ctx, rawText, maxWidth);
  const lineHeight = fontSize * 1.25;
  const totalTextHeight = lines.length * lineHeight;

  const bottomMargin = isVertical
    ? preset.position === 'lower-center'
      ? 220
      : 120
    : preset.position === 'lower-center'
    ? 96
    : 48;

  const baseY = outH - bottomMargin - totalTextHeight;

  ctx.save();
  ctx.textBaseline = 'top';

  if (preset.hasBox) {
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width), 80);
    const padX = 22;
    const padY = 12;
    const bgW = Math.min(outW - 40, widest + padX * 2);
    const bgH = totalTextHeight + padY * 2;
    ctx.fillStyle = preset.backgroundColor;
    drawRoundedRect(ctx, (outW - bgW) / 2, baseY - padY, bgW, bgH, 10);
    ctx.fill();
  }

  const isKaraoke = preset.id === 'destaque' || preset.id === 'impacto';
  const activeWordIdx = isKaraoke ? getActiveWordIndex(activeCaption, sourceTime) : -1;

  let globalWordIdx = 0;
  lines.forEach((line, lIdx) => {
    const y = baseY + lIdx * lineHeight;
    const words = line.split(/\s+/).filter(Boolean);
    const spaceWidth = ctx.measureText(' ').width;
    const lineWidth =
      words.reduce((acc, w) => acc + ctx.measureText(w).width, 0) +
      Math.max(0, words.length - 1) * spaceWidth;
    let cursorX = (outW - lineWidth) / 2;

    ctx.textAlign = 'left';
    for (const word of words) {
      const highlighted = isKaraoke && globalWordIdx <= activeWordIdx;
      const color = highlighted ? preset.highlightColor : preset.primaryColor;

      if (!preset.hasBox) {
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(5, 7, 12, 0.96)';
        ctx.lineWidth = preset.id === 'minimalista' ? 5 : 8;
        ctx.strokeText(word, cursorX, y);
      }

      ctx.fillStyle = color;
      ctx.fillText(word, cursorX, y);
      cursorX += ctx.measureText(word).width + spaceWidth;
      globalWordIdx++;
    }
  });

  ctx.restore();
}

function drawVideoFrameToCanvas(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  clip: ClipItem,
  outW: number,
  outH: number
) {
  ctx.fillStyle = '#05070C';
  ctx.fillRect(0, 0, outW, outH);

  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;

  if (clip.format === 'vertical') {
    if (clip.verticalFraming === 'fit') {
      const bgScale = Math.max(outW / vw, outH / vh);
      const bgW = vw * bgScale;
      const bgH = vh * bgScale;
      ctx.save();
      ctx.filter = 'blur(18px) brightness(0.45)';
      ctx.drawImage(video, (outW - bgW) / 2, (outH - bgH) / 2, bgW, bgH);
      ctx.restore();

      const fgScale = Math.min(outW / vw, outH / vh);
      const fgW = vw * fgScale;
      const fgH = vh * fgScale;
      ctx.drawImage(video, (outW - fgW) / 2, (outH - fgH) / 2, fgW, fgH);
    } else {
      const scale = Math.max(outW / vw, outH / vh);
      const drawW = vw * scale;
      const drawH = vh * scale;
      ctx.drawImage(video, (outW - drawW) / 2, (outH - drawH) / 2, drawW, drawH);
    }
  } else {
    const scale = Math.min(outW / vw, outH / vh);
    const drawW = vw * scale;
    const drawH = vh * scale;
    ctx.drawImage(video, (outW - drawW) / 2, (outH - drawH) / 2, drawW, drawH);
  }

  drawFrameOverlays(ctx, clip, video.currentTime, outW, outH);
}

export interface LocalRenderResult {
  blob: Blob;
  blobUrl: string;
  outputFilename: string;
  mimeType: string;
}

type VideoWithVfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

/**
 * Renderiza o corte 100% localmente no navegador (WebM VP8/Opus via requestVideoFrameCallback),
 * garantindo faixa de vídeo ativa no frame 0 e evitando quadros repetidos ou gravações sem vídeo.
 */
export async function renderClipLocally(params: {
  mediaUrl: string;
  clip: ClipItem;
  filenamePreset: FilenamePreset;
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
}): Promise<LocalRenderResult> {
  const { mediaUrl, clip, filenamePreset, onProgress, signal } = params;
  const { width: outW, height: outH } = getOutputResolution(clip.format);
  const { mimeType, extension } = getSupportedRecorderFormat();
  const outputFilename = slugifyHeadForFilename(
    clip.head,
    filenamePreset,
    clip.index,
    clip.format,
    extension
  );

  const video = document.createElement('video') as VideoWithVfc;
  video.src = mediaUrl;
  video.crossOrigin = 'anonymous';
  video.playsInline = true;
  video.preload = 'auto';

  await new Promise<void>((resolve, reject) => {
    const onErr = () =>
      reject(new Error('Falha ao carregar o vídeo para renderização local.'));
    if (video.readyState >= 2) {
      resolve();
      return;
    }
    video.onloadeddata = () => resolve();
    video.onerror = onErr;
  });

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Contexto gráfico 2D indisponível neste navegador.');
  }

  video.currentTime = Math.max(0, clip.startTime);
  await new Promise<void>((resolve) => {
    if (!video.seeking && video.readyState >= 2) {
      resolve();
      return;
    }
    const handleSeeked = () => {
      video.removeEventListener('seeked', handleSeeked);
      resolve();
    };
    video.addEventListener('seeked', handleSeeked);
  });

  // Garante que o frame inicial já esteja desenhado antes de iniciar a gravação
  drawVideoFrameToCanvas(ctx, video, clip, outW, outH);

  const canvasStream = canvas.captureStream(30);
  let audioCtx: AudioContext | null = null;

  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) {
      audioCtx = new AudioCtx();
      const source = audioCtx.createMediaElementSource(video);
      const dest = audioCtx.createMediaStreamDestination();
      source.connect(dest);
      dest.stream.getAudioTracks().forEach((track) => {
        canvasStream.addTrack(track);
      });
    }
  } catch {
    // Vídeo sem trilha de áudio: segue apenas com vídeo
  }

  const recorderOptions: MediaRecorderOptions = mimeType
    ? { mimeType, videoBitsPerSecond: 3_500_000 }
    : { videoBitsPerSecond: 3_500_000 };
  const recorder = new MediaRecorder(canvasStream, recorderOptions);
  const chunks: BlobPart[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  const clipDuration = Math.max(1, clip.endTime - clip.startTime);

  return new Promise<LocalRenderResult>((resolve, reject) => {
    let rafId = 0;
    let vfcId = 0;
    let finished = false;
    let lastDrawnTime = -1;

    const safetyTimeout = window.setTimeout(() => {
      if (!finished && recorder.state === 'recording') {
        recorder.stop();
      }
    }, Math.max(20_000, (clipDuration + 20) * 1000));

    const cleanup = () => {
      window.clearTimeout(safetyTimeout);
      if (rafId) cancelAnimationFrame(rafId);
      if (vfcId && video.cancelVideoFrameCallback) {
        video.cancelVideoFrameCallback(vfcId);
      }
      video.pause();
      canvasStream.getTracks().forEach((t) => t.stop());
      if (audioCtx) {
        void audioCtx.close().catch(() => {});
      }
      video.removeAttribute('src');
      video.load();
    };

    if (signal) {
      signal.addEventListener('abort', () => {
        if (!finished) {
          finished = true;
          if (recorder.state !== 'inactive') recorder.stop();
          cleanup();
          reject(new Error('Renderização cancelada.'));
        }
      });
    }

    recorder.onstop = () => {
      if (finished) return;
      finished = true;
      const finalMime = recorder.mimeType || mimeType || 'video/webm';
      const blob = new Blob(chunks, { type: finalMime });
      const blobUrl = URL.createObjectURL(blob);
      onProgress?.(100);
      cleanup();
      resolve({
        blob,
        blobUrl,
        outputFilename,
        mimeType: finalMime,
      });
    };

    recorder.onerror = () => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(new Error('Erro durante a gravação local do vídeo.'));
    };

    const checkEndAndDraw = () => {
      if (finished) return;
      const nowTime = video.currentTime;

      if (!video.seeking && video.readyState >= 2 && nowTime >= lastDrawnTime) {
        drawVideoFrameToCanvas(ctx, video, clip, outW, outH);
        lastDrawnTime = nowTime;
      }

      const pct = Math.min(
        98,
        Math.max(2, Math.round(((nowTime - clip.startTime) / clipDuration) * 100))
      );
      onProgress?.(pct);

      if (nowTime >= clip.endTime - 0.04 || video.ended) {
        if (recorder.state === 'recording') {
          recorder.stop();
        }
        return;
      }

      if (video.requestVideoFrameCallback) {
        vfcId = video.requestVideoFrameCallback(checkEndAndDraw);
      } else {
        rafId = requestAnimationFrame(checkEndAndDraw);
      }
    };

    recorder.start(250);
    void video
      .play()
      .then(() => {
        if (video.requestVideoFrameCallback) {
          vfcId = video.requestVideoFrameCallback(checkEndAndDraw);
        } else {
          rafId = requestAnimationFrame(checkEndAndDraw);
        }
      })
      .catch((err) => {
        if (!finished) {
          finished = true;
          cleanup();
          reject(
            new Error(
              err instanceof Error
                ? err.message
                : 'Não foi possível iniciar a reprodução local.'
            )
          );
        }
      });
  });
}
