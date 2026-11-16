import type {
  AnalysisSettings,
  CaptionPresetConfig,
  CaptionPresetId,
  CaptionSegment,
  ClipFormat,
  ClipItem,
  FilenamePreset,
  HeadStyleConfig,
} from '../types/clip';

export const DEFAULT_HEAD_STYLE: HeadStyleConfig = {
  align: 'center',
  fontSize: 24,
  textColor: '#FFFFFF',
  hasBackground: true,
  backgroundColor: '#090D16',
};

export function resolveHeadStyle(
  style?: Partial<HeadStyleConfig> | null
): HeadStyleConfig {
  const rawSize = Number(style?.fontSize ?? DEFAULT_HEAD_STYLE.fontSize);
  const fontSize = Number.isFinite(rawSize)
    ? Math.min(38, Math.max(16, Math.round(rawSize)))
    : DEFAULT_HEAD_STYLE.fontSize;

  const align =
    style?.align === 'left' || style?.align === 'right' || style?.align === 'center'
      ? style.align
      : DEFAULT_HEAD_STYLE.align;

  return {
    align,
    fontSize,
    textColor: style?.textColor || DEFAULT_HEAD_STYLE.textColor,
    hasBackground:
      typeof style?.hasBackground === 'boolean'
        ? style.hasBackground
        : DEFAULT_HEAD_STYLE.hasBackground,
    backgroundColor: style?.backgroundColor || DEFAULT_HEAD_STYLE.backgroundColor,
  };
}

/**
 * Exatamente 5 pré-definições básicas e profissionais de legenda.
 */
export const CAPTION_PRESETS: CaptionPresetConfig[] = [
  {
    id: 'classico',
    name: 'Clássico Limpo',
    description: 'Texto branco nítido com contorno escuro sutil.',
    fontFamily: 'Liberation Sans, DM Sans, sans-serif',
    primaryColor: '#FFFFFF',
    highlightColor: '#FFFFFF',
    backgroundColor: 'transparent',
    hasBox: false,
    uppercase: false,
    position: 'lower-center',
  },
  {
    id: 'destaque',
    name: 'Destaque Dinâmico',
    description: 'Palavra ativa iluminada em âmbar em tempo real.',
    fontFamily: 'Liberation Sans, Plus Jakarta Sans, sans-serif',
    primaryColor: '#FFFFFF',
    highlightColor: '#FBBF24',
    backgroundColor: 'transparent',
    hasBox: false,
    uppercase: true,
    position: 'lower-center',
  },
  {
    id: 'faixa',
    name: 'Faixa Sólida',
    description: 'Legenda em caixa escura de alto contraste para leitura fácil.',
    fontFamily: 'Liberation Sans, DM Sans, sans-serif',
    primaryColor: '#FFFFFF',
    highlightColor: '#FFFFFF',
    backgroundColor: 'rgba(15, 23, 42, 0.90)',
    hasBox: true,
    uppercase: false,
    position: 'bottom',
  },
  {
    id: 'minimalista',
    name: 'Minimalista Podcast',
    description: 'Discreta na base do vídeo, ideal para cortes longos.',
    fontFamily: 'DejaVu Sans, DM Sans, sans-serif',
    primaryColor: '#F1F5F9',
    highlightColor: '#E2E8F0',
    backgroundColor: 'transparent',
    hasBox: false,
    uppercase: false,
    position: 'bottom',
  },
  {
    id: 'impacto',
    name: 'Impacto Negrito',
    description: 'Tipografia forte com palavra-chave em verde vibrante.',
    fontFamily: 'Liberation Sans, Plus Jakarta Sans, sans-serif',
    primaryColor: '#FFFFFF',
    highlightColor: '#22C55E',
    backgroundColor: 'transparent',
    hasBox: false,
    uppercase: true,
    position: 'lower-center',
  },
];

export function getCaptionPreset(id: CaptionPresetId): CaptionPresetConfig {
  return CAPTION_PRESETS.find((p) => p.id === id) ?? CAPTION_PRESETS[0];
}

export function slugifyHeadForFilename(
  head: string,
  preset: FilenamePreset = 'head_only',
  index = 1,
  format: ClipFormat = 'vertical',
  extension: 'mp4' | 'webm' = 'mp4'
): string {
  const normalized = (head || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 64)
    .replace(/^_+|_+$/g, '');

  const base = normalized || `corte_${String(index).padStart(2, '0')}`;
  const paddedIndex = String(index).padStart(2, '0');
  const formatTag = format === 'vertical' ? '9x16' : '16x9';

  switch (preset) {
    case 'index_head':
      return `${paddedIndex}_${base}.${extension}`;
    case 'head_format':
      return `${base}_${formatTag}.${extension}`;
    case 'head_only':
    default:
      return `${base}.${extension}`;
  }
}

export function formatTimecode(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;

  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(
      2,
      '0'
    )}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatDurationBadge(seconds: number): string {
  const safe = Math.max(1, Math.round(seconds));
  if (safe < 60) {
    return `${safe}s`;
  }
  const mins = Math.floor(safe / 60);
  const rem = safe % 60;
  return rem === 0 ? `${mins} min` : `${mins}m ${String(rem).padStart(2, '0')}s`;
}

export function clampClipRange(
  startTime: number,
  endTime: number,
  videoDuration: number,
  minDuration = 4
): { startTime: number; endTime: number } {
  const maxDur = Math.max(minDuration, videoDuration);
  let s = Math.max(0, Math.min(startTime, maxDur - minDuration));
  let e = Math.min(maxDur, Math.max(endTime, s + minDuration));

  if (e - s < minDuration) {
    e = Math.min(maxDur, s + minDuration);
    if (e - s < minDuration) {
      s = Math.max(0, e - minDuration);
    }
  }

  return {
    startTime: Number(s.toFixed(2)),
    endTime: Number(e.toFixed(2)),
  };
}

export function getActiveCaptionAtTime(
  captions: CaptionSegment[],
  currentSourceTime: number
): CaptionSegment | null {
  for (const seg of captions) {
    if (currentSourceTime >= seg.start && currentSourceTime <= seg.end) {
      return seg;
    }
  }
  return null;
}

export function getActiveWordIndex(
  segment: CaptionSegment,
  currentSourceTime: number
): number {
  const words = segment.text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return 0;

  const duration = Math.max(0.2, segment.end - segment.start);
  const elapsed = Math.max(0, Math.min(duration, currentSourceTime - segment.start));
  const progress = elapsed / duration;
  return Math.min(words.length - 1, Math.floor(progress * words.length));
}

export interface AnalysisWindow {
  index: number;
  start: number;
  end: number;
}

/**
 * Divide vídeos longos (ex.: 29 min = 1740s) em janelas de análise para cobrir 100% do conteúdo.
 */
export function buildAnalysisWindows(
  durationSeconds: number,
  windowSeconds = 600,
  overlapSeconds = 15
): AnalysisWindow[] {
  const safeDuration = Math.max(10, durationSeconds);
  if (safeDuration <= windowSeconds + 60) {
    return [{ index: 0, start: 0, end: Number(safeDuration.toFixed(2)) }];
  }

  const windows: AnalysisWindow[] = [];
  let cursor = 0;
  let idx = 0;
  while (cursor < safeDuration) {
    const end = Math.min(safeDuration, cursor + windowSeconds);
    windows.push({
      index: idx,
      start: Number(cursor.toFixed(2)),
      end: Number(end.toFixed(2)),
    });
    if (end >= safeDuration) break;
    cursor = end - overlapSeconds;
    idx++;
  }
  return windows;
}

/**
 * Remove cortes duplicados ou com sobreposição excessiva dentro do mesmo formato,
 * evitando que dois clipes repitam o mesmo trecho do vídeo.
 */
export function deduplicateAndSortClips(clips: ClipItem[]): ClipItem[] {
  const byFormat: Record<ClipFormat, ClipItem[]> = {
    vertical: [],
    horizontal: [],
  };

  const sortedByScore = [...clips].sort((a, b) => b.score - a.score);

  for (const candidate of sortedByScore) {
    const existingList = byFormat[candidate.format];
    const candDur = Math.max(1, candidate.endTime - candidate.startTime);

    const overlapsHeavily = existingList.some((kept) => {
      const overlapStart = Math.max(kept.startTime, candidate.startTime);
      const overlapEnd = Math.min(kept.endTime, candidate.endTime);
      const overlap = Math.max(0, overlapEnd - overlapStart);
      const keptDur = Math.max(1, kept.endTime - kept.startTime);
      const ratio = overlap / Math.min(candDur, keptDur);
      return ratio > 0.45 || Math.abs(kept.startTime - candidate.startTime) < 6;
    });

    if (!overlapsHeavily) {
      existingList.push(candidate);
    }
  }

  const verticals = byFormat.vertical.sort((a, b) => a.startTime - b.startTime);
  const horizontals = byFormat.horizontal.sort((a, b) => a.startTime - b.startTime);

  return [...verticals, ...horizontals].map((clip, i) => ({
    ...clip,
    index: i + 1,
  }));
}

/**
 * Gera sugestões de cortes estruturados localmente (modo offline) escalando
 * proporcionalmente à duração real do vídeo.
 * IMPORTANTE: nunca inventa falas falsas nas legendas quando não houve transcrição por IA.
 */
export function generateLocalStructuredClips(params: {
  duration: number;
  fileName: string;
  settings: AnalysisSettings;
  energyPeaks?: number[];
}): ClipItem[] {
  const { duration, fileName, settings, energyPeaks = [] } = params;
  const safeDuration = Math.max(10, duration);
  const cleanTitle = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim();

  const clips: ClipItem[] = [];
  let indexCounter = 1;

  const wantShort = settings.scope === 'vertical' || settings.scope === 'both';
  const wantLong = settings.scope === 'horizontal' || settings.scope === 'both';

  if (wantShort) {
    const targetLen = Math.min(
      settings.shortTargetSeconds,
      Math.max(12, Math.floor(safeDuration * 0.75))
    );
    const maxNonOverlapping = Math.max(
      1,
      Math.floor(safeDuration / Math.max(20, targetLen * 1.1))
    );
    const desiredCount = Math.min(
      12,
      maxNonOverlapping,
      Math.max(1, Math.round(safeDuration / Math.max(120, targetLen * 1.4)))
    );

    const anchors: number[] = [];
    for (const peak of energyPeaks) {
      if (
        peak + 6 < safeDuration &&
        anchors.every((a) => Math.abs(a - peak) >= targetLen * 1.2)
      ) {
        anchors.push(peak);
      }
      if (anchors.length >= desiredCount) break;
    }

    if (anchors.length < desiredCount) {
      const slot = safeDuration / desiredCount;
      for (let i = 0; i < desiredCount; i++) {
        const cand = Math.floor(i * slot + slot * 0.15);
        if (
          cand + 6 < safeDuration &&
          anchors.every((a) => Math.abs(a - cand) >= Math.min(targetLen, slot * 0.6))
        ) {
          anchors.push(cand);
        }
      }
    }

    anchors.sort((a, b) => a - b);

    const viralShortTemplates = [
      'O erro silencioso que trava seu resultado',
      'Ninguém te conta essa virada de chave',
      'O momento exato em que tudo muda',
      'Pare de fazer isso antes de continuar',
      'A verdade por trás desse resultado',
      'O segredo que poucos aplicam hoje',
      'Como destravar isso em poucos minutos',
      'O detalhe invisível que muda o jogo',
      'Por que a maioria falha nessa etapa',
      'O ponto que mudou todo o cenário',
      'Não pule essa parte do raciocínio',
      'O que fazer quando tudo trava',
    ];

    anchors.slice(0, desiredCount).forEach((anchor, i) => {
      const range = clampClipRange(anchor, anchor + targetLen, safeDuration, 4);
      const head = viralShortTemplates[i % viralShortTemplates.length];
      const id = `local-v-${indexCounter}`;
      clips.push({
        id,
        index: indexCounter,
        head,
        reason: energyPeaks.includes(anchor)
          ? 'Pico de dinâmica vocal detectado offline (use IA Viral para transcrição fiel).'
          : 'Trecho distribuído offline (use IA Viral para transcrição fiel da fala).',
        score: Math.max(80, 96 - i),
        format: 'vertical',
        startTime: range.startTime,
        endTime: range.endTime,
        captionPreset: settings.defaultPreset,
        showHeadOverlay: settings.showHeadOverlay,
        headStyle: { ...DEFAULT_HEAD_STYLE },
        verticalFraming: settings.verticalFraming,
        captions: [],
        selected: i < 4,
      });
      indexCounter++;
    });
  }

  if (wantLong) {
    const targetLongSecs = Math.min(safeDuration, settings.longTargetMinutes * 60);
    const chapterCount =
      safeDuration > targetLongSecs * 1.2
        ? Math.min(4, Math.ceil(safeDuration / targetLongSecs))
        : 1;

    for (let i = 0; i < chapterCount; i++) {
      const start = Number(((i * safeDuration) / chapterCount).toFixed(2));
      const end = Number(Math.min(safeDuration, start + targetLongSecs).toFixed(2));
      const range = clampClipRange(start, end, safeDuration, 4);
      const head =
        chapterCount === 1
          ? `A conversa completa — ${cleanTitle || 'Bloco principal'}`
          : `Parte ${i + 1}: O ponto central de ${cleanTitle || 'cada etapa'}`;
      const id = `local-h-${indexCounter}`;

      clips.push({
        id,
        index: indexCounter,
        head: head.slice(0, 62),
        reason: `Bloco horizontal contínuo (${formatDurationBadge(range.endTime - range.startTime)}).`,
        score: 91 - i * 2,
        format: 'horizontal',
        startTime: range.startTime,
        endTime: range.endTime,
        captionPreset:
          settings.defaultPreset === 'destaque' ? 'minimalista' : settings.defaultPreset,
        showHeadOverlay: false,
        headStyle: { ...DEFAULT_HEAD_STYLE },
        verticalFraming: 'fit',
        captions: [],
        selected: i === 0,
      });
      indexCounter++;
    }
  }

  return deduplicateAndSortClips(clips);
}

function formatAssTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const cs = Math.floor((safe - Math.floor(safe)) * 100);
  return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(
    2,
    '0'
  )}.${String(cs).padStart(2, '0')}`;
}

function hexToAssColor(hex: string, alphaHex = '00'): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return `&H${alphaHex}FFFFFF`;
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  return `&H${alphaHex}${b}${g}${r}`.toUpperCase();
}

function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\r?\n/g, '\\N');
}

export function buildAssSubtitles(
  clip: ClipItem,
  outWidth: number,
  outHeight: number
): string {
  const preset = getCaptionPreset(clip.captionPreset);
  const isVertical = clip.format === 'vertical';
  const baseWidth = isVertical ? 720 : 1280;
  const scale = Math.max(1, outWidth / baseWidth);

  const baseFontSize = isVertical
    ? preset.id === 'impacto'
      ? 54
      : preset.id === 'destaque'
      ? 50
      : preset.id === 'minimalista'
      ? 38
      : 44
    : preset.id === 'impacto'
    ? 44
    : preset.id === 'minimalista'
    ? 34
    : 40;
  const fontSize = Math.round(baseFontSize * scale);

  const baseMarginV = isVertical
    ? preset.position === 'lower-center'
      ? 260
      : 160
    : preset.position === 'lower-center'
    ? 110
    : 56;
  const marginV = Math.round(baseMarginV * scale);
  const sideMargin = Math.round(48 * scale);

  const primaryAss = hexToAssColor(preset.primaryColor, '00');
  const highlightAss = hexToAssColor(preset.highlightColor, '00');
  const outlineAss = '&H00090D16';
  const boxAss = '&H280F172A';

  const borderStyle = preset.hasBox ? 3 : 1;
  const baseOutlineWidth = preset.hasBox
    ? 14
    : preset.id === 'impacto'
    ? 4
    : preset.id === 'minimalista'
    ? 2
    : 3;
  const outlineWidth = Math.round(baseOutlineWidth * scale);
  const shadow = preset.hasBox ? 0 : Math.round(2 * scale);
  const backColour = preset.hasBox ? boxAss : '&H80000000';
  const boldFlag = preset.id === 'minimalista' ? 0 : -1;

  const isKaraoke = preset.id === 'destaque' || preset.id === 'impacto';
  const stylePrimary = isKaraoke ? highlightAss : primaryAss;
  const styleSecondary = primaryAss;

  // Resolve Head styling for ASS top overlay scaled to output resolution (720p, 1080p, 4K)
  const headStyle = resolveHeadStyle(clip.headStyle);
  const headFontSize = Math.round(headStyle.fontSize * (isVertical ? 1.65 : 1.35) * scale);
  const headMarginV = Math.round((isVertical ? 130 : 40) * scale);
  const headPrimaryAss = hexToAssColor(headStyle.textColor, '00');
  const headAlignment =
    headStyle.align === 'left' ? 7 : headStyle.align === 'right' ? 9 : 8;
  const headBorderStyle = headStyle.hasBackground ? 3 : 1;
  const headOutlineColour = headStyle.hasBackground
    ? hexToAssColor(headStyle.backgroundColor, '18')
    : '&H0005070C';
  const headBackColour = headStyle.hasBackground
    ? hexToAssColor(headStyle.backgroundColor, '18')
    : '&HFF000000';
  const headOutline = Math.round((headStyle.hasBackground ? 12 : 3) * scale);
  const headShadow = headStyle.hasBackground ? 0 : Math.round(2 * scale);

  const lines: string[] = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${outWidth}`,
    `PlayResY: ${outHeight}`,
    'WrapStyle: 1',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: MainCaption,Liberation Sans,${fontSize},${stylePrimary},${styleSecondary},${outlineAss},${backColour},${boldFlag},0,0,0,100,100,0,0,${borderStyle},${outlineWidth},${shadow},2,${sideMargin},${sideMargin},${marginV},1`,
    `Style: HeadBanner,Liberation Sans,${headFontSize},${headPrimaryAss},${headPrimaryAss},${headOutlineColour},${headBackColour},-1,0,0,0,100,100,0,0,${headBorderStyle},${headOutline},${headShadow},${headAlignment},${sideMargin},${sideMargin},${headMarginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const clipDuration = Math.max(1, clip.endTime - clip.startTime);

  if (clip.showHeadOverlay && clip.head.trim().length > 0) {
    lines.push(
      `Dialogue: 1,${formatAssTime(0)},${formatAssTime(
        clipDuration
      )},HeadBanner,,0,0,0,,${escapeAssText(clip.head.trim())}`
    );
  }

  for (const seg of clip.captions) {
    const segStart = Number(seg.start);
    const segEnd = Number(seg.end);
    if (!Number.isFinite(segStart) || !Number.isFinite(segEnd)) continue;

    const relStart = segStart - clip.startTime;
    const relEnd = segEnd - clip.startTime;
    if (relEnd <= 0 || relStart >= clipDuration) continue;

    const clampedStart = Math.max(0, relStart);
    const clampedEnd = Math.min(clipDuration, relEnd);
    if (clampedEnd - clampedStart < 0.1) continue;

    const rawText = preset.uppercase ? seg.text.toUpperCase() : seg.text;

    let dialogueText = escapeAssText(rawText);
    if (isKaraoke) {
      const words = rawText.trim().split(/\s+/).filter(Boolean);
      const totalCs = Math.max(10, Math.round((clampedEnd - clampedStart) * 100));
      const perWordCs = Math.max(5, Math.floor(totalCs / Math.max(1, words.length)));
      dialogueText = words
        .map((w) => `{\\k${perWordCs}}${escapeAssText(w)}`)
        .join(' ');
    }

    lines.push(
      `Dialogue: 0,${formatAssTime(clampedStart)},${formatAssTime(
        clampedEnd
      )},MainCaption,,0,0,0,,${dialogueText}`
    );
  }

  return lines.join('\n');
}

function toEvenDimension(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

export function getOutputResolution(
  format: ClipFormat,
  sourceWidth = 1280,
  sourceHeight = 720
): {
  width: number;
  height: number;
} {
  const sw = toEvenDimension(Math.max(320, Number(sourceWidth) || 1280));
  const sh = toEvenDimension(Math.max(320, Number(sourceHeight) || 720));

  if (format === 'vertical') {
    const targetHeight = Math.max(1280, Math.max(sw, sh));
    const targetWidth = toEvenDimension((targetHeight * 9) / 16);
    return { width: targetWidth, height: toEvenDimension(targetHeight) };
  }

  if (sw >= sh) {
    const targetWidth = Math.max(1280, sw);
    const targetHeight =
      sw === targetWidth ? sh : toEvenDimension((targetWidth * 9) / 16);
    return { width: targetWidth, height: targetHeight };
  }

  const targetWidth = Math.max(1280, sh);
  const targetHeight = toEvenDimension((targetWidth * 9) / 16);
  return { width: targetWidth, height: targetHeight };
}
