import { GoogleGenAI, Type } from '@google/genai';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AnalysisSettings, ClipItem, VideoProject } from '../src/types/clip';
import {
  DEFAULT_HEAD_STYLE,
  buildAnalysisWindows,
  deduplicateAndSortClips,
} from '../src/utils/clipLogic';
import {
  extractAudioTrack,
  extractCompactVideo,
  probeVideo,
  splitAudioWindow,
} from './videoEngine';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY não configurada no ambiente do servidor.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function callWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1400
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
      }
    }
  }
  throw lastErr;
}

interface RawCandidateClip {
  head?: string;
  reason?: string;
  score?: number;
  startTime?: number;
  endTime?: number;
}

interface RawPass1Analysis {
  overallTopic?: string;
  shortClips?: RawCandidateClip[];
  longClips?: RawCandidateClip[];
}

interface RawPass2Transcription {
  refinedStartSec?: number;
  refinedEndSec?: number;
  refinedHead?: string;
  captions?: Array<{
    start?: number;
    end?: number;
    text?: string;
  }>;
}

function normalizeCandidateClips(
  rawList: RawCandidateClip[] | undefined,
  format: 'vertical' | 'horizontal',
  windowOffset: number,
  windowDuration: number,
  totalVideoDuration: number,
  settings: AnalysisSettings,
  idPrefix: string
): ClipItem[] {
  if (!Array.isArray(rawList)) return [];

  return rawList
    .map((item, idx): ClipItem | null => {
      const localStart = Math.max(
        0,
        Math.min(Number(item.startTime ?? 0), Math.max(0, windowDuration - 6))
      );
      const localEnd = Math.min(
        windowDuration,
        Math.max(localStart + 6, Number(item.endTime ?? localStart + 35))
      );

      const startTime = Math.max(
        0,
        Math.min(windowOffset + localStart, Math.max(0, totalVideoDuration - 6))
      );
      const endTime = Math.min(
        totalVideoDuration,
        Math.max(startTime + 6, windowOffset + localEnd)
      );

      const cleanHead = String(item.head ?? '')
        .replace(/[#*_"`]/g, '')
        .trim();

      return {
        id: `${idPrefix}-${format}-${idx}-${Date.now()}`,
        index: idx + 1,
        head: cleanHead || 'O ponto que mudou tudo nesse trecho',
        reason: String(
          item.reason ?? 'Gancho com ideia completa e alto potencial de retenção.'
        ).trim(),
        score: Math.min(99, Math.max(72, Math.round(Number(item.score ?? 89)))),
        format,
        startTime: Number(startTime.toFixed(2)),
        endTime: Number(endTime.toFixed(2)),
        captionPreset:
          format === 'horizontal' && settings.defaultPreset === 'destaque'
            ? 'minimalista'
            : settings.defaultPreset,
        showHeadOverlay: format === 'horizontal' ? false : settings.showHeadOverlay,
        headStyle: { ...DEFAULT_HEAD_STYLE },
        verticalFraming: format === 'horizontal' ? 'fit' : settings.verticalFraming,
        captions: [],
        selected: true,
      };
    })
    .filter((x): x is ClipItem => Boolean(x));
}

async function fileToMediaPart(
  ai: GoogleGenAI,
  mediaPath: string,
  mimeType: string
): Promise<
  | { inlineData: { data: string; mimeType: string } }
  | { fileData: { fileUri: string; mimeType: string } }
> {
  const stat = await fs.stat(mediaPath);
  if (stat.size <= 12 * 1024 * 1024) {
    const buf = await fs.readFile(mediaPath);
    return {
      inlineData: {
        data: buf.toString('base64'),
        mimeType,
      },
    };
  }

  const uploaded = await ai.files.upload({
    file: mediaPath,
    config: { mimeType },
  });
  let fileInfo = uploaded;
  while (fileInfo.state === 'PROCESSING') {
    await new Promise((r) => setTimeout(r, 2000));
    fileInfo = await ai.files.get({ name: fileInfo.name! });
  }
  if (!fileInfo.uri) {
    throw new Error('Falha ao processar a mídia na API de arquivos.');
  }
  return {
    fileData: {
      fileUri: fileInfo.uri,
      mimeType,
    },
  };
}

export async function analyzeAudioBufferWithGemini(params: {
  audioBuffer: Buffer;
  mimeType: string;
  duration: number;
  settings: AnalysisSettings;
}): Promise<{ overallTopic: string; clips: ClipItem[] }> {
  const { audioBuffer, mimeType, duration, settings } = params;
  const ai = getGeminiClient();

  const mediaPart = {
    inlineData: {
      data: audioBuffer.toString('base64'),
      mimeType,
    },
  };

  const pass1 = await runPass1Discovery({
    ai,
    mediaPart,
    windowIndex: 0,
    totalWindows: 1,
    windowOffset: 0,
    windowDuration: duration,
    totalVideoDuration: duration,
    settings,
  });

  return {
    overallTopic: pass1.overallTopic,
    clips: deduplicateAndSortClips(pass1.clips),
  };
}

export interface AnalyzeVideoProgress {
  step: string;
  progress: number;
}

export async function analyzeVideoWithGemini(
  sourcePath: string,
  settings: AnalysisSettings,
  workDir: string,
  onProgress?: (info: AnalyzeVideoProgress) => void
): Promise<{ overallTopic: string; clips: ClipItem[] }> {
  const probe = await probeVideo(sourcePath);
  await fs.mkdir(workDir, { recursive: true });

  const ai = getGeminiClient();
  const windows = buildAnalysisWindows(probe.duration, 600, 15);

  onProgress?.({
    step: 'Extraindo trilha completa de áudio para análise fiel...',
    progress: 12,
  });

  let fullMediaPath = path.join(workDir, 'analysis_audio.mp3');
  let mimeType = 'audio/mp3';

  if (probe.hasAudio) {
    await extractAudioTrack(sourcePath, fullMediaPath);
  } else {
    fullMediaPath = path.join(workDir, 'analysis_video.mp4');
    mimeType = 'video/mp4';
    await extractCompactVideo(sourcePath, fullMediaPath);
  }

  // PASSO 1: Descoberta de trechos completos e ganchos virais por janela de 10 min
  const candidateClips: ClipItem[] = [];
  const topics: string[] = [];

  if (windows.length === 1 || !probe.hasAudio) {
    onProgress?.({
      step: 'Analisando o conteúdo para encontrar os melhores momentos completos...',
      progress: 30,
    });
    const mediaPart = await fileToMediaPart(ai, fullMediaPath, mimeType);
    const single = await runPass1Discovery({
      ai,
      mediaPart,
      windowIndex: 0,
      totalWindows: 1,
      windowOffset: 0,
      windowDuration: probe.duration,
      totalVideoDuration: probe.duration,
      settings,
    });
    if (single.overallTopic) topics.push(single.overallTopic);
    candidateClips.push(...single.clips);
  } else {
    const concurrency = 3;
    for (let i = 0; i < windows.length; i += concurrency) {
      const batch = windows.slice(i, i + concurrency);
      onProgress?.({
        step: `Mapeando momentos completos no vídeo (bloco ${i + 1} a ${Math.min(
          windows.length,
          i + concurrency
        )} de ${windows.length})...`,
        progress: 22 + Math.round((i / windows.length) * 28),
      });

      const batchResults = await Promise.all(
        batch.map(async (win) => {
          const winDur = Math.max(10, win.end - win.start);
          const winAudioPath = path.join(workDir, `window_${win.index}.mp3`);
          await splitAudioWindow(fullMediaPath, win.start, winDur, winAudioPath);
          const mediaPart = await fileToMediaPart(ai, winAudioPath, 'audio/mp3');
          return runPass1Discovery({
            ai,
            mediaPart,
            windowIndex: win.index,
            totalWindows: windows.length,
            windowOffset: win.start,
            windowDuration: winDur,
            totalVideoDuration: probe.duration,
            settings,
          });
        })
      );

      for (const res of batchResults) {
        if (res.overallTopic) topics.push(res.overallTopic);
        candidateClips.push(...res.clips);
      }
    }
  }

  const dedupedCandidates = deduplicateAndSortClips(candidateClips);

  // PASSO 2: Para vídeos com áudio, extrai exatamente o áudio de cada corte (com margem)
  // para transcrever PALAVRA POR PALAVRA o que realmente é falado e ajustar início/fim sem cortar explicações.
  let finalClips = dedupedCandidates;

  if (probe.hasAudio && dedupedCandidates.length > 0) {
    const refinedList: ClipItem[] = new Array(dedupedCandidates.length);
    const concurrency = 2;

    for (let i = 0; i < dedupedCandidates.length; i += concurrency) {
      const batchIndices = dedupedCandidates
        .slice(i, i + concurrency)
        .map((_, offset) => i + offset);

      onProgress?.({
        step: `Transcrevendo áudio real e refinando limites (${Math.min(
          dedupedCandidates.length,
          i + concurrency
        )}/${dedupedCandidates.length})...`,
        progress: 52 + Math.round((i / dedupedCandidates.length) * 44),
      });

      await Promise.all(
        batchIndices.map(async (idx) => {
          const clip = dedupedCandidates[idx];
          try {
            refinedList[idx] = await refineAndTranscribeSingleClip({
              ai,
              clip,
              fullAudioPath: fullMediaPath,
              totalVideoDuration: probe.duration,
              workDir,
            });
          } catch (err) {
            console.warn(`[pass2 fallback clip ${clip.id}]`, err);
            refinedList[idx] = clip;
          }
        })
      );
    }

    finalClips = deduplicateAndSortClips(refinedList);
  }

  onProgress?.({
    step: 'Finalizando lista de cortes com legendas sincronizadas...',
    progress: 99,
  });

  return {
    overallTopic: topics[0] || 'Cortes virais e blocos completos identificados',
    clips: finalClips,
  };
}

/**
 * Transcreve literalmente as falas de uma lista de cortes pré-definidos (ex.: picos locais)
 * usando o áudio extraído localmente do vídeo.
 */
export async function transcribeClipsBatch(
  sourcePath: string,
  clips: ClipItem[],
  workDir: string,
  onProgress?: (info: AnalyzeVideoProgress) => void
): Promise<ClipItem[]> {
  if (clips.length === 0) return clips;
  const probe = await probeVideo(sourcePath);
  if (!probe.hasAudio) return clips;

  await fs.mkdir(workDir, { recursive: true });
  const ai = getGeminiClient();
  const fullAudioPath = path.join(workDir, 'local_peaks_audio.mp3');

  onProgress?.({
    step: 'Extraindo áudio para transcrição literal das legendas...',
    progress: 20,
  });
  await extractAudioTrack(sourcePath, fullAudioPath);

  const out: ClipItem[] = new Array(clips.length);
  const concurrency = 2;
  for (let i = 0; i < clips.length; i += concurrency) {
    const batchIndices = clips
      .slice(i, i + concurrency)
      .map((_, offset) => i + offset);

    onProgress?.({
      step: `Transcrevendo legendas fiéis (${Math.min(
        clips.length,
        i + concurrency
      )}/${clips.length})...`,
      progress: 25 + Math.round((i / clips.length) * 70),
    });

    await Promise.all(
      batchIndices.map(async (idx) => {
        const clip = clips[idx];
        try {
          const captions = await transcribeExactRange({
            ai,
            clipId: clip.id,
            fullAudioPath,
            startSec: clip.startTime,
            endSec: clip.endTime,
            workDir,
          });
          out[idx] = { ...clip, captions };
        } catch (err) {
          console.warn(`[transcribeClipsBatch fallback ${clip.id}]`, err);
          out[idx] = clip;
        }
      })
    );
  }

  return out;
}

/**
 * PASSO 1: Mapeia trechos completos dentro da janela sem cortar explicações ao meio.
 */
async function runPass1Discovery(params: {
  ai: GoogleGenAI;
  mediaPart:
    | { inlineData: { data: string; mimeType: string } }
    | { fileData: { fileUri: string; mimeType: string } };
  windowIndex: number;
  totalWindows: number;
  windowOffset: number;
  windowDuration: number;
  totalVideoDuration: number;
  settings: AnalysisSettings;
}): Promise<{ overallTopic: string; clips: ClipItem[] }> {
  const {
    ai,
    mediaPart,
    windowIndex,
    totalWindows,
    windowOffset,
    windowDuration,
    totalVideoDuration,
    settings,
  } = params;

  const targetLongSecs = Math.min(
    Math.round(windowDuration),
    settings.longTargetMinutes * 60
  );

  const wantShort = settings.scope === 'vertical' || settings.scope === 'both';
  const wantLong = settings.scope === 'horizontal' || settings.scope === 'both';

  const shortTarget = Math.min(
    settings.shortTargetSeconds,
    Math.max(15, Math.floor(windowDuration * 0.7))
  );
  const shortMaxRange = Math.min(
    Math.round(windowDuration),
    Math.max(shortTarget + 25, Math.round(shortTarget * 1.2))
  );
  const maxPossibleInWin = Math.max(
    1,
    Math.floor(windowDuration / Math.max(25, shortTarget))
  );
  const expectedShortMin = Math.min(maxPossibleInWin, windowDuration >= 360 ? 3 : 2);
  const expectedShortMax = Math.min(maxPossibleInWin, windowDuration >= 360 ? 5 : 4);

  const prompt = `
Você é o editor-chefe de retenção de um grande canal de cortes.
Você está analisando ${
    totalWindows > 1
      ? `a Parte ${windowIndex + 1} de ${totalWindows} de um vídeo longo`
      : 'este vídeo completo'
  }.
Duração exata DESTE áudio enviado: ${windowDuration.toFixed(1)} segundos (0.0s até ${windowDuration.toFixed(1)}s).

REGRAS CRÍTICAS DE SELEÇÃO DE CONTEÚDO (NÃO CORTAR FALTANDO INFORMAÇÃO):
1. Cada corte PRECISA conter uma ideia COMPLETA: Gancho inicial + Explicação/História inteira + Conclusão clara.
2. NUNCA termine um corte no meio de uma frase, antes do exemplo terminar ou faltando a resposta principal da pergunta! Se o orador precisar de ${shortTarget}s a ${shortMaxRange}s para concluir o raciocínio, inclua até o final da conclusão.
3. Todos os timestamps (startTime e endTime) DEVEM estar entre 0 e ${windowDuration.toFixed(1)} segundos relativos a ESTE áudio.
4. Para cada corte, crie uma "head" viral (4 a 8 palavras, sem emojis/hashtags) com loop aberto que desperte curiosidade fiel ao assunto falado naquele trecho.
${
  wantShort
    ? `5. Selecione de ${expectedShortMin} a ${expectedShortMax} "shortClips" (9:16), mirando ~${shortTarget}s (aceitando entre ${Math.max(
        18,
        shortTarget - 15
      )}s e ${shortMaxRange}s para garantir começo, meio e fim completos) sem sobreposição.`
    : '5. Deixe "shortClips" vazio [].'
}
${
  wantLong
    ? `6. Selecione 1 a 2 "longClips" (16:9), blocos temáticos completos próximos a ${targetLongSecs}s.`
    : '6. Deixe "longClips" vazio [].'
}
`.trim();

  const candidateSchema = {
    type: Type.OBJECT,
    properties: {
      head: {
        type: Type.STRING,
        description: 'Head viral de 4 a 8 palavras fiel ao assunto real deste trecho',
      },
      reason: {
        type: Type.STRING,
        description: 'Resumo de 1 frase do argumento completo contido no corte',
      },
      score: {
        type: Type.INTEGER,
        description: 'Potencial de retenção de 72 a 99',
      },
      startTime: {
        type: Type.NUMBER,
        description: `Início exato da frase de gancho em segundos (0 a ${windowDuration.toFixed(1)})`,
      },
      endTime: {
        type: Type.NUMBER,
        description: `Fim após a conclusão completa do raciocínio em segundos (0 a ${windowDuration.toFixed(1)})`,
      },
    },
    required: ['head', 'reason', 'score', 'startTime', 'endTime'],
  };

  const response = await callWithRetry(() =>
    ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [mediaPart, { text: prompt }],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            overallTopic: { type: Type.STRING },
            shortClips: { type: Type.ARRAY, items: candidateSchema },
            longClips: { type: Type.ARRAY, items: candidateSchema },
          },
          required: ['overallTopic', 'shortClips', 'longClips'],
        },
      },
    })
  );

  const rawText = (response.text ?? '{}').trim();
  const parsed = JSON.parse(rawText) as RawPass1Analysis;
  const idPrefix = `w${windowIndex}`;

  const shortItems = wantShort
    ? normalizeCandidateClips(
        parsed.shortClips,
        'vertical',
        windowOffset,
        windowDuration,
        totalVideoDuration,
        settings,
        idPrefix
      )
    : [];

  const longItems = wantLong
    ? normalizeCandidateClips(
        parsed.longClips,
        'horizontal',
        windowOffset,
        windowDuration,
        totalVideoDuration,
        settings,
        idPrefix
      )
    : [];

  return {
    overallTopic: String(parsed.overallTopic ?? 'Análise concluída').trim(),
    clips: [...shortItems, ...longItems],
  };
}

/**
 * Transcreve literalmente um recorte exato [startSec, endSec] (reiniciado em 0.0s),
 * usando JSON estruturado e fallback para gemini-3.5-transcribe caso necessário.
 */
async function transcribeExactRange(params: {
  ai: GoogleGenAI;
  clipId: string;
  fullAudioPath: string;
  startSec: number;
  endSec: number;
  workDir: string;
}): Promise<ClipItem['captions']> {
  const { ai, clipId, fullAudioPath, startSec, endSec, workDir } = params;
  const subChunks: Array<{ start: number; end: number; idx: number }> = [];
  let cursor = startSec;
  let chunkIdx = 0;

  while (cursor < endSec) {
    const end = Math.min(endSec, cursor + 180);
    if (end - cursor >= 1.5) {
      subChunks.push({ start: cursor, end, idx: chunkIdx++ });
    }
    cursor = end;
  }

  const results = await Promise.all(
    subChunks.map(async (sub) => {
      const dur = Math.max(2, sub.end - sub.start);
      const subPath = path.join(workDir, `exact_${clipId}_${sub.idx}.mp3`);
      await splitAudioWindow(fullAudioPath, sub.start, dur, subPath);
      const mediaPart = await fileToMediaPart(ai, subPath, 'audio/mp3');

      const prompt = `
Transcreva LITERALMENTE palavra por palavra o que é falado neste áudio de ${dur.toFixed(
        1
      )} segundos (0.0s até ${dur.toFixed(1)}s), no idioma falado (Português do Brasil).
Divida em blocos curtos (3 a 6 palavras por bloco) com tempos exatos "start" e "end" em segundos entre 0 e ${dur.toFixed(
        1
      )}.
PROIBIDO inventar ou resumir o que não foi literalmente dito neste áudio.
`.trim();

      try {
        const response = await callWithRetry(() =>
          ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: { parts: [mediaPart, { text: prompt }] },
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  captions: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        start: { type: Type.NUMBER },
                        end: { type: Type.NUMBER },
                        text: { type: Type.STRING },
                      },
                      required: ['start', 'end', 'text'],
                    },
                  },
                },
                required: ['captions'],
              },
            },
          })
        );

        const parsed = JSON.parse((response.text ?? '{}').trim()) as {
          captions?: Array<{ start?: number; end?: number; text?: string }>;
        };

        const mapped = (Array.isArray(parsed.captions) ? parsed.captions : [])
          .map((c, cIdx) => {
            const text = String(c.text ?? '').trim();
            if (!text) return null;
            const cs = Math.max(
              sub.start,
              Math.min(sub.end - 0.25, sub.start + Number(c.start ?? 0))
            );
            const ce = Math.min(
              sub.end,
              Math.max(cs + 0.3, sub.start + Number(c.end ?? 2))
            );
            return {
              id: `${clipId}-ecap-${sub.idx}-${cIdx}`,
              start: Number(cs.toFixed(2)),
              end: Number(ce.toFixed(2)),
              text,
            };
          })
          .filter((x): x is NonNullable<typeof x> => Boolean(x));

        if (mapped.length > 0) return mapped;
      } catch (err) {
        console.warn(`[transcribeExactRange JSON fallback ${clipId}]`, err);
      }

      // Fallback dedicado com gemini-3.5-transcribe
      try {
        const asrRes = await callWithRetry(() =>
          ai.models.generateContent({
            model: 'gemini-3.5-transcribe',
            contents: {
              parts: [
                mediaPart,
                {
                  text: 'Transcreva literalmente em português tudo o que é falado neste áudio.',
                },
              ],
            },
          })
        );
        const rawTranscript = (asrRes.text ?? '').trim();
        if (!rawTranscript) return [];

        const words = rawTranscript.split(/\s+/).filter(Boolean);
        const phrases: string[] = [];
        for (let w = 0; w < words.length; w += 5) {
          phrases.push(words.slice(w, w + 5).join(' '));
        }
        const step = dur / Math.max(1, phrases.length);
        return phrases.map((phrase, pIdx) => ({
          id: `${clipId}-asr-${sub.idx}-${pIdx}`,
          start: Number((sub.start + pIdx * step).toFixed(2)),
          end: Number(
            Math.min(sub.end, sub.start + (pIdx + 1) * step - 0.05).toFixed(2)
          ),
          text: phrase,
        }));
      } catch (asrErr) {
        console.warn(`[gemini-3.5-transcribe fallback ${clipId}]`, asrErr);
        return [];
      }
    })
  );

  return results.flat().sort((a, b) => a.start - b.start);
}

/**
 * PASSO 2: Extrai o áudio exato deste corte (com +3s antes e +8s depois para completar ideias)
 * e gera transcrição LITERAL palavra por palavra + ajuste fino de início e fim.
 */
async function refineAndTranscribeSingleClip(params: {
  ai: GoogleGenAI;
  clip: ClipItem;
  fullAudioPath: string;
  totalVideoDuration: number;
  workDir: string;
}): Promise<ClipItem> {
  const { ai, clip, fullAudioPath, totalVideoDuration, workDir } = params;

  const clipSpan = clip.endTime - clip.startTime;

  // Para cortes curtos/médios até 4 min (cobrindo verticais de até 3 min + margem)
  if (clipSpan <= 240) {
    const sliceStart = Math.max(0, clip.startTime - 3);
    const sliceEnd = Math.min(totalVideoDuration, clip.endTime + 8);
    const sliceDur = Math.max(6, sliceEnd - sliceStart);
    const slicePath = path.join(workDir, `clip_${clip.id}.mp3`);

    await splitAudioWindow(fullAudioPath, sliceStart, sliceDur, slicePath);
    const mediaPart = await fileToMediaPart(ai, slicePath, 'audio/mp3');

    const expectedStartInSlice = Math.max(0, clip.startTime - sliceStart);
    const expectedEndInSlice = Math.min(sliceDur, clip.endTime - sliceStart);

    const prompt = `
Você é um transcritor de precisão e editor final de cortes.
Ouça ESTE áudio de ${sliceDur.toFixed(1)} segundos (vai de 0.0s até ${sliceDur.toFixed(1)}s).

TAREFAS OBRIGATÓRIAS:
1. REFINAR OS LIMITES SEM CORTAR INFORMAÇÕES:
   - Sugestão inicial está perto de ${expectedStartInSlice.toFixed(1)}s até ${expectedEndInSlice.toFixed(1)}s.
   - Defina "refinedStartSec" exatamente quando começa a primeira frase de gancho (sem cortar a primeira palavra).
   - Defina "refinedEndSec" SOMENTE DEPOIS que o orador terminar a frase/raciocínio conclusivo completo (se a explicação continuar até os segundos finais do áudio enviado, estenda "refinedEndSec" até o fim da conclusão!).
2. TRANSCRIÇÃO LITERAL E FIEL (CRÍTICO):
   - Transcreva LITERALMENTE palavra por palavra o que é falado em voz alta entre "refinedStartSec" e "refinedEndSec", no idioma falado (Português do Brasil).
   - Divida em blocos curtos (3 a 6 palavras por bloco) com tempos "start" e "end" EXATOS neste áudio (de 0.0s até ${sliceDur.toFixed(1)}s).
   - PROIBIDO inventar, resumir, reescrever ou colocar texto que NÃO foi literalmente dito neste áudio.
3. POLIR HEAD VIRAL:
   - Com base APENAS no que foi realmente dito neste corte, ajuste "refinedHead" (4 a 8 palavras, sem emojis/hashtags) para gerar máxima curiosidade e fidelidade ao conteúdo.
`.trim();

    const response = await callWithRetry(() =>
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts: [mediaPart, { text: prompt }] },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              refinedStartSec: { type: Type.NUMBER },
              refinedEndSec: { type: Type.NUMBER },
              refinedHead: { type: Type.STRING },
              captions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    start: { type: Type.NUMBER },
                    end: { type: Type.NUMBER },
                    text: { type: Type.STRING },
                  },
                  required: ['start', 'end', 'text'],
                },
              },
            },
            required: ['refinedStartSec', 'refinedEndSec', 'refinedHead', 'captions'],
          },
        },
      })
    );

    const parsed = JSON.parse((response.text ?? '{}').trim()) as RawPass2Transcription;

    const localStart = Math.max(
      0,
      Math.min(
        Number(parsed.refinedStartSec ?? expectedStartInSlice),
        Math.max(0, sliceDur - 6)
      )
    );
    const localEnd = Math.min(
      sliceDur,
      Math.max(localStart + 6, Number(parsed.refinedEndSec ?? expectedEndInSlice))
    );

    const finalStart = Number(
      Math.max(0, Math.min(sliceStart + localStart, totalVideoDuration - 6)).toFixed(2)
    );
    const finalEnd = Number(
      Math.min(totalVideoDuration, Math.max(finalStart + 6, sliceStart + localEnd)).toFixed(2)
    );

    let captions = (Array.isArray(parsed.captions) ? parsed.captions : [])
      .map((c, idx) => {
        const text = String(c.text ?? '').trim();
        if (!text) return null;
        const absStart = sliceStart + Number(c.start ?? localStart);
        const absEnd = sliceStart + Number(c.end ?? absStart + 2);
        const cs = Math.max(finalStart, Math.min(finalEnd - 0.25, absStart));
        const ce = Math.min(finalEnd, Math.max(cs + 0.3, absEnd));
        if (ce - cs < 0.2) return null;
        return {
          id: `${clip.id}-vcap-${idx}`,
          start: Number(cs.toFixed(2)),
          end: Number(ce.toFixed(2)),
          text,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));

    // Garantia adicional: se vier sem legendas válidas no intervalo final, transcreve o recorte exato [finalStart, finalEnd]
    if (captions.length === 0) {
      captions = await transcribeExactRange({
        ai,
        clipId: clip.id,
        fullAudioPath,
        startSec: finalStart,
        endSec: finalEnd,
        workDir,
      });
    }

    const cleanHead = String(parsed.refinedHead ?? clip.head)
      .replace(/[#*_"`]/g, '')
      .trim();

    return {
      ...clip,
      head: cleanHead || clip.head,
      startTime: finalStart,
      endTime: finalEnd,
      captions,
    };
  }

  // Para cortes horizontais longos (> 4 min, ex: 10 min), transcreve em sub-blocos exatos de 180s
  const allCaptions = await transcribeExactRange({
    ai,
    clipId: clip.id,
    fullAudioPath,
    startSec: clip.startTime,
    endSec: clip.endTime,
    workDir,
  });

  return {
    ...clip,
    captions: allCaptions,
  };
}

/**
 * Projeto exemplo vinculado ao MP4 real de 90s para testar reprodução, legenda e exportação MP4.
 */
export function buildDemoProject(
  projectId: string,
  mediaUrl: string,
  settings: AnalysisSettings
): VideoProject {
  const clips: ClipItem[] = [
    {
      id: 'demo-clip-1',
      index: 1,
      head: 'O erro invisível que derruba sua retenção',
      reason: 'Loop aberto nos primeiros 3 segundos que obriga quem vê a descobrir o motivo.',
      score: 97,
      format: 'vertical',
      startTime: 2,
      endTime: 26,
      captionPreset: settings.defaultPreset,
      showHeadOverlay: settings.showHeadOverlay,
      headStyle: { ...DEFAULT_HEAD_STYLE },
      verticalFraming: settings.verticalFraming,
      selected: true,
      captions: [
        { id: 'd1-1', start: 2.2, end: 5.8, text: 'A maioria tenta vender cedo demais' },
        { id: 'd1-2', start: 5.9, end: 9.5, text: 'antes de abrir um loop de curiosidade' },
        { id: 'd1-3', start: 9.6, end: 13.8, text: 'Quando você ajusta a primeira frase' },
        { id: 'd1-4', start: 13.9, end: 18.2, text: 'o tempo de atenção dobra na hora' },
        { id: 'd1-5', start: 18.3, end: 22.4, text: 'E o alcance orgânico dispara sem custo' },
        { id: 'd1-6', start: 22.5, end: 25.8, text: 'Teste essa abertura no próximo vídeo' },
      ],
    },
    {
      id: 'demo-clip-2',
      index: 2,
      head: 'Por que os primeiros 3 segundos decidem tudo',
      reason: 'Quebra de objeção direta com promessa prática para Reels e Shorts.',
      score: 94,
      format: 'vertical',
      startTime: 28,
      endTime: 54,
      captionPreset: settings.defaultPreset,
      showHeadOverlay: settings.showHeadOverlay,
      headStyle: { ...DEFAULT_HEAD_STYLE },
      verticalFraming: settings.verticalFraming,
      selected: true,
      captions: [
        { id: 'd2-1', start: 28.2, end: 32.0, text: 'Nos primeiros três segundos do corte' },
        { id: 'd2-2', start: 32.1, end: 36.4, text: 'quem assiste decide se fica ou pula' },
        { id: 'd2-3', start: 36.5, end: 41.0, text: 'Coloque uma head que gere tensão' },
        { id: 'd2-4', start: 41.1, end: 45.6, text: 'e use legenda dinâmica sincronizada' },
        { id: 'd2-5', start: 45.7, end: 50.2, text: 'Mesmo no mudo a pessoa entende' },
        { id: 'd2-6', start: 50.3, end: 53.8, text: 'e corre para ver o vídeo inteiro' },
      ],
    },
    {
      id: 'demo-clip-3',
      index: 3,
      head: 'Como transformar 1 vídeo longo em 12 cortes',
      reason: 'Revelação de processo com ganho concreto de escala.',
      score: 91,
      format: 'vertical',
      startTime: 56,
      endTime: 84,
      captionPreset: settings.defaultPreset,
      showHeadOverlay: settings.showHeadOverlay,
      headStyle: { ...DEFAULT_HEAD_STYLE },
      verticalFraming: settings.verticalFraming,
      selected: true,
      captions: [
        { id: 'd3-1', start: 56.2, end: 60.5, text: 'Você não precisa gravar todo dia' },
        { id: 'd3-2', start: 60.6, end: 65.0, text: 'Uma única conversa longa bem estruturada' },
        { id: 'd3-3', start: 65.1, end: 69.8, text: 'rende dezenas de cortes prontos' },
        { id: 'd3-4', start: 69.9, end: 74.5, text: 'Separe os picos de tensão do papo' },
        { id: 'd3-5', start: 74.6, end: 79.4, text: 'nomeie pela head viral e exporte' },
        { id: 'd3-6', start: 79.5, end: 83.8, text: 'Simples rápido e consistente' },
      ],
    },
    {
      id: 'demo-clip-4',
      index: 4,
      head: 'O método completo para prender atenção do início ao fim',
      reason: 'Corte horizontal contínuo ideal para YouTube (escala para 10 min em vídeos longos).',
      score: 95,
      format: 'horizontal',
      startTime: 0,
      endTime: 60,
      captionPreset: 'minimalista',
      showHeadOverlay: false,
      headStyle: { ...DEFAULT_HEAD_STYLE },
      verticalFraming: 'fit',
      selected: true,
      captions: [
        { id: 'd4-1', start: 1.0, end: 7.5, text: 'Bem-vindo ao trecho completo sobre retenção e funil de conteúdo.' },
        { id: 'd4-2', start: 8.0, end: 16.0, text: 'Primeiro analisamos por que a maioria dos vídeos perde audiência no início.' },
        { id: 'd4-3', start: 17.0, end: 26.0, text: 'Depois aplicamos a regra prática dos três segundos no gancho.' },
        { id: 'd4-4', start: 28.0, end: 42.0, text: 'Em seguida conectamos os cortes curtos verticais ao vídeo principal.' },
        { id: 'd4-5', start: 43.0, end: 58.0, text: 'E finalizamos organizando tudo para publicação semanal sem esforço.' },
      ],
    },
    {
      id: 'demo-clip-5',
      index: 5,
      head: 'Como escalar cortes diários sem gravar nada novo',
      reason: 'Segundo bloco horizontal temático com legendas discretas.',
      score: 89,
      format: 'horizontal',
      startTime: 45,
      endTime: 89,
      captionPreset: 'minimalista',
      showHeadOverlay: false,
      headStyle: { ...DEFAULT_HEAD_STYLE },
      verticalFraming: 'fit',
      selected: false,
      captions: [
        { id: 'd5-1', start: 46.0, end: 55.0, text: 'Agora vamos estruturar sua rotina de distribuição em lote.' },
        { id: 'd5-2', start: 56.0, end: 68.0, text: 'Selecione os melhores momentos verticais e horizontais de uma vez.' },
        { id: 'd5-3', start: 69.0, end: 87.0, text: 'Exporte todos os arquivos já nomeados pela head para publicar rápido.' },
      ],
    },
  ];

  const filteredClips = clips.filter((c) => {
    if (settings.scope === 'vertical') return c.format === 'vertical';
    if (settings.scope === 'horizontal') return c.format === 'horizontal';
    return true;
  });

  return {
    projectId,
    fileName: 'podcast_estrategia_digital_exemplo.mp4',
    mediaUrl,
    duration: 90,
    width: 1280,
    height: 720,
    isDemo: true,
    hasServerMedia: true,
    overallTopic: 'Ganchos de curiosidade, retenção e escala de cortes em lote',
    clips: filteredClips.map((c, idx) => ({ ...c, index: idx + 1 })),
  };
}
