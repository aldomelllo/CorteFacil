import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPTION_PRESETS,
  buildAnalysisWindows,
  buildAssSubtitles,
  clampClipRange,
  deduplicateAndSortClips,
  formatDurationBadge,
  formatTimecode,
  generateLocalStructuredClips,
  getActiveCaptionAtTime,
  getActiveWordIndex,
  getOutputResolution,
  resolveHeadStyle,
  slugifyHeadForFilename,
} from './clipLogic';
import type { ClipItem } from '../types/clip';

test('CAPTION_PRESETS contains at most 5 curated presets', () => {
  assert.equal(CAPTION_PRESETS.length, 5);
  const ids = new Set(CAPTION_PRESETS.map((p) => p.id));
  assert.equal(ids.size, 5);
});

test('slugifyHeadForFilename generates safe MP4 and WebM filenames from Head', () => {
  assert.equal(
    slugifyHeadForFilename('O Erro Invisível que Trava Suas Vendas!', 'head_only', 1, 'vertical'),
    'o_erro_invisivel_que_trava_suas_vendas.mp4'
  );
  assert.equal(
    slugifyHeadForFilename('3 Passos de Retenção', 'index_head', 2, 'vertical', 'webm'),
    '02_3_passos_de_retencao.webm'
  );
  assert.equal(
    slugifyHeadForFilename('Aula Completa de Funil', 'head_format', 1, 'horizontal'),
    'aula_completa_de_funil_16x9.mp4'
  );
  assert.equal(
    slugifyHeadForFilename('   ', 'head_only', 4, 'vertical'),
    'corte_04.mp4'
  );
});

test('formatTimecode and formatDurationBadge format durations cleanly', () => {
  assert.equal(formatTimecode(0), '00:00');
  assert.equal(formatTimecode(65), '01:05');
  assert.equal(formatTimecode(3661), '01:01:01');
  assert.equal(formatDurationBadge(42), '42s');
  assert.equal(formatDurationBadge(600), '10 min');
  assert.equal(formatDurationBadge(95), '1m 35s');
});

test('clampClipRange enforces minimum duration and video bounds', () => {
  assert.deepEqual(clampClipRange(-5, 2, 60, 4), {
    startTime: 0,
    endTime: 4,
  });
  assert.deepEqual(clampClipRange(58, 70, 60, 4), {
    startTime: 56,
    endTime: 60,
  });
  assert.deepEqual(clampClipRange(10, 45, 120, 4), {
    startTime: 10,
    endTime: 45,
  });
});

test('getActiveCaptionAtTime and getActiveWordIndex locate active phrase and word', () => {
  const captions = [
    { id: 'c1', start: 10, end: 14, text: 'Primeiro segundo terceiro quarto' },
    { id: 'c2', start: 14.5, end: 18, text: 'Outra frase importante' },
  ];
  const active = getActiveCaptionAtTime(captions, 12.1);
  assert.ok(active);
  assert.equal(active.id, 'c1');
  assert.equal(getActiveWordIndex(active, 10.1), 0);
  assert.equal(getActiveWordIndex(active, 12.1), 2);
  assert.equal(getActiveCaptionAtTime(captions, 14.2), null);
});

test('resolveHeadStyle clamps fontSize and supports background removal', () => {
  const style = resolveHeadStyle({
    align: 'left',
    fontSize: 60,
    textColor: '#FBBF24',
    hasBackground: false,
  });
  assert.equal(style.align, 'left');
  assert.equal(style.fontSize, 38);
  assert.equal(style.textColor, '#FBBF24');
  assert.equal(style.hasBackground, false);
});

test('buildAssSubtitles generates valid ASS script with custom Head style and karaoke tags', () => {
  const clip: ClipItem = {
    id: 'clip-1',
    index: 1,
    head: 'Como Dobrar a Retenção',
    reason: 'Gancho forte no início',
    score: 95,
    format: 'vertical',
    startTime: 10,
    endTime: 25,
    captionPreset: 'destaque',
    showHeadOverlay: true,
    headStyle: {
      align: 'left',
      fontSize: 30,
      textColor: '#FBBF24',
      hasBackground: false,
      backgroundColor: '#090D16',
    },
    verticalFraming: 'crop',
    selected: true,
    captions: [
      { id: 's1', start: 10.5, end: 13.5, text: 'Olha esse detalhe' },
      { id: 's2', start: 30, end: 33, text: 'Fora do corte' },
    ],
  };

  const ass = buildAssSubtitles(clip, 720, 1280);
  assert.match(ass, /\[Script Info\]/);
  assert.match(ass, /PlayResX: 720/);
  assert.match(ass, /Style: HeadBanner,Liberation Sans,50,&H0024BFFB,&H0024BFFB,&H0005070C,&HFF000000,-1,0,0,0,100,100,0,0,1,3,2,7,/);
  assert.match(ass, /HeadBanner,,0,0,0,,Como Dobrar a Retenção/);
  assert.match(ass, /\{\\k\d+\}OLHA/);
  assert.ok(!ass.includes('Fora do corte'));
});

test('buildAnalysisWindows splits a 29-minute video into full-coverage windows', () => {
  const windows = buildAnalysisWindows(29 * 60, 600, 15);
  assert.equal(windows.length, 3);
  assert.equal(windows[0].start, 0);
  assert.equal(windows[2].end, 29 * 60);
});

test('deduplicateAndSortClips eliminates duplicate/overlapping clips of same format', () => {
  const base: ClipItem = {
    id: 'a',
    index: 1,
    head: 'Gancho A',
    reason: 'Bom',
    score: 95,
    format: 'vertical',
    startTime: 100,
    endTime: 145,
    captionPreset: 'destaque',
    showHeadOverlay: true,
    verticalFraming: 'crop',
    captions: [],
    selected: true,
  };
  const duplicate: ClipItem = {
    ...base,
    id: 'b',
    score: 82,
    startTime: 103,
    endTime: 142,
    head: 'Gancho B repetido',
  };
  const distinct: ClipItem = {
    ...base,
    id: 'c',
    score: 88,
    startTime: 300,
    endTime: 345,
    head: 'Gancho C distinto',
  };

  const res = deduplicateAndSortClips([duplicate, base, distinct]);
  assert.equal(res.length, 2);
  assert.equal(res[0].id, 'a');
  assert.equal(res[1].id, 'c');
});

test('generateLocalStructuredClips scales a 29-minute video to many short vertical and 3 horizontal cuts', () => {
  const clips = generateLocalStructuredClips({
    duration: 29 * 60, // 29 min video
    fileName: 'aula_funil_vendas.mp4',
    energyPeaks: [45, 320, 780],
    settings: {
      scope: 'both',
      shortTargetSeconds: 45,
      longTargetMinutes: 10,
      defaultPreset: 'destaque',
      verticalFraming: 'crop',
      showHeadOverlay: true,
      analysisMode: 'local_offline',
    },
  });

  const verticals = clips.filter((c) => c.format === 'vertical');
  const horizontals = clips.filter((c) => c.format === 'horizontal');
  assert.ok(verticals.length >= 8, `Expected >= 8 vertical cuts for 29-min video, got ${verticals.length}`);
  assert.equal(horizontals.length, 3);
  assert.equal(Math.round(horizontals[0].endTime - horizontals[0].startTime), 600);
});

test('getOutputResolution preserves 4K, 1080p and 720p source quality', () => {
  assert.deepEqual(getOutputResolution('horizontal', 3840, 2160), {
    width: 3840,
    height: 2160,
  });
  assert.deepEqual(getOutputResolution('vertical', 3840, 2160), {
    width: 2160,
    height: 3840,
  });
  assert.deepEqual(getOutputResolution('horizontal', 1920, 1080), {
    width: 1920,
    height: 1080,
  });
  assert.deepEqual(getOutputResolution('vertical', 1920, 1080), {
    width: 1080,
    height: 1920,
  });
  assert.deepEqual(getOutputResolution('vertical', 1280, 720), {
    width: 720,
    height: 1280,
  });
});

test('buildAssSubtitles scales fonts proportionally for 4K exports', () => {
  const clip: ClipItem = {
    id: 'clip-4k',
    index: 1,
    head: 'Segredo em 4K',
    reason: 'Teste 4K',
    score: 95,
    format: 'vertical',
    startTime: 0,
    endTime: 20,
    captionPreset: 'destaque',
    showHeadOverlay: true,
    headStyle: {
      align: 'center',
      fontSize: 24,
      textColor: '#FFFFFF',
      hasBackground: true,
      backgroundColor: '#090D16',
    },
    verticalFraming: 'crop',
    selected: true,
    captions: [{ id: 'c1', start: 1, end: 5, text: 'Legenda visível em 4K' }],
  };

  const ass4k = buildAssSubtitles(clip, 2160, 3840);
  assert.match(ass4k, /PlayResX: 2160/);
  assert.match(ass4k, /PlayResY: 3840/);
  assert.match(ass4k, /Style: MainCaption,Liberation Sans,150,/);
  assert.match(ass4k, /Style: HeadBanner,Liberation Sans,119,/);
});

test('generateLocalStructuredClips supports 3-minute (180s) vertical cuts cleanly', () => {
  const clips = generateLocalStructuredClips({
    duration: 29 * 60,
    fileName: 'podcast_4k.mp4',
    settings: {
      scope: 'vertical',
      shortTargetSeconds: 180,
      longTargetMinutes: 10,
      defaultPreset: 'destaque',
      verticalFraming: 'crop',
      showHeadOverlay: true,
      analysisMode: 'ai_full',
    },
  });

  const verticals = clips.filter((c) => c.format === 'vertical');
  assert.ok(verticals.length >= 5, `Expected >= 5 3-min clips, got ${verticals.length}`);
  assert.equal(Math.round(verticals[0].endTime - verticals[0].startTime), 180);
});
