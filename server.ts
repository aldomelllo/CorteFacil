import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import JSZip from 'jszip';
import { createServer as createViteServer } from 'vite';
import type {
  AnalysisSettings,
  ClipItem,
  RenderJobItem,
} from './src/types/clip';
import { slugifyHeadForFilename } from './src/utils/clipLogic';
import {
  analyzeAudioBufferWithGemini,
  analyzeVideoWithGemini,
  buildDemoProject,
  transcribeClipsBatch,
} from './server/geminiAnalyzer';
import {
  ensureDemoVideo,
  probeVideo,
  renderClipToMp4,
} from './server/videoEngine';

const PORT = Number(process.env.PORT || 3000);
const WORKSPACE_TMP = '/tmp/cortefacil';
const UPLOAD_DIR = path.join(WORKSPACE_TMP, 'uploads');
const RENDER_DIR = path.join(WORKSPACE_TMP, 'renders');
const DEMO_VIDEO_PATH = path.join(WORKSPACE_TMP, 'demo', 'demo_podcast.mp4');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(RENDER_DIR, { recursive: true });

interface StoredProject {
  projectId: string;
  filePath: string;
  fileName: string;
  mimeType: string;
}

interface PendingChunkUpload {
  uploadId: string;
  projectId: string;
  filePath: string;
  fileName: string;
  mimeType: string;
  expectedSize: number;
  totalChunks: number;
  receivedChunks: Set<number>;
  fh: fsp.FileHandle;
  lastActivityAt: number;
}

interface StoredBatch {
  batchId: string;
  batchDir: string;
  zipPath?: string;
  jobs: Array<RenderJobItem & { outputPath: string }>;
}

interface StoredAnalysisJob {
  analysisId: string;
  status: 'running' | 'done' | 'error';
  step: string;
  progress: number;
  result?: { overallTopic: string; clips: ClipItem[] };
  error?: string;
}

const projects = new Map<string, StoredProject>();
const pendingUploads = new Map<string, PendingChunkUpload>();
const analysisJobs = new Map<string, StoredAnalysisJob>();
const batches = new Map<string, StoredBatch>();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp4';
    const safeName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 2048 * 1024 * 1024, // 2 GB
  },
});

function inferMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.mkv') return 'video/x-matroska';
  return 'video/mp4';
}

const TEMP_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 horas

async function cleanupStaleTempFiles(): Promise<void> {
  const cutoff = Date.now() - TEMP_MAX_AGE_MS;
  for (const dir of [UPLOAD_DIR, RENDER_DIR]) {
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        try {
          const st = await fsp.stat(fullPath);
          if (st.mtimeMs < cutoff) {
            await fsp.rm(fullPath, { recursive: true, force: true });
          }
        } catch {
          // ignore individual cleanup errors
        }
      }
    } catch {
      // ignore missing directory
    }
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Inicializa projeto exemplo com vídeo MP4 real de 90s
  app.post('/api/demo', async (req, res) => {
    try {
      await ensureDemoVideo(DEMO_VIDEO_PATH);
      const settings: AnalysisSettings = req.body?.settings ?? {
        scope: 'both',
        shortTargetSeconds: 45,
        longTargetMinutes: 10,
        defaultPreset: 'destaque',
        verticalFraming: 'crop',
        showHeadOverlay: true,
        analysisMode: 'ai_full',
      };

      const projectId = 'demo';
      projects.set(projectId, {
        projectId,
        filePath: DEMO_VIDEO_PATH,
        fileName: 'podcast_estrategia_digital_exemplo.mp4',
        mimeType: 'video/mp4',
      });

      const project = buildDemoProject(
        projectId,
        `/api/media/${projectId}`,
        settings
      );
      res.json(project);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Erro ao criar vídeo exemplo.';
      res.status(500).json({ error: msg });
    }
  });

  // Upload em blocos posicionais e idempotentes (suporta arquivos 4K de 4GB+ mesmo com retries/paralelismo)
  app.post('/api/upload-init', async (req, res) => {
    try {
      const { fileName, mimeType, fileSize, totalChunks } = req.body as {
        fileName?: string;
        mimeType?: string;
        fileSize?: number;
        totalChunks?: number;
      };
      const cleanName = String(fileName || 'video.mp4');
      const ext = path.extname(cleanName) || '.mp4';
      const projectId = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const uploadId = `up_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const filePath = path.join(UPLOAD_DIR, `${projectId}${ext}`);

      const fh = await fsp.open(filePath, 'w+');

      pendingUploads.set(uploadId, {
        uploadId,
        projectId,
        filePath,
        fileName: cleanName,
        mimeType: mimeType || inferMimeType(filePath),
        expectedSize: Number(fileSize) > 0 ? Number(fileSize) : 0,
        totalChunks: Number(totalChunks) > 0 ? Number(totalChunks) : 0,
        receivedChunks: new Set<number>(),
        fh,
        lastActivityAt: Date.now(),
      });

      res.json({ uploadId, projectId });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Erro ao iniciar envio.';
      res.status(500).json({ error: msg });
    }
  });

  app.post(
    '/api/upload-chunk',
    express.raw({ type: 'application/octet-stream', limit: '16mb' }),
    async (req, res) => {
      try {
        const uploadId = String(req.query.uploadId || '');
        const pending = pendingUploads.get(uploadId);
        if (!pending) {
          return res.status(404).json({ error: 'Sessão de envio não encontrada.' });
        }
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          return res.status(400).json({ error: 'Bloco binário inválido ou vazio.' });
        }

        const chunkIndex = Number(req.query.chunkIndex);
        const offset = Number(req.query.offset);
        if (
          !Number.isInteger(chunkIndex) ||
          chunkIndex < 0 ||
          (pending.totalChunks > 0 && chunkIndex >= pending.totalChunks) ||
          !Number.isFinite(offset) ||
          offset < 0 ||
          (pending.expectedSize > 0 && offset + req.body.length > pending.expectedSize)
        ) {
          return res.status(400).json({ error: 'Índice ou offset do bloco inválido.' });
        }

        await pending.fh.write(req.body, 0, req.body.length, offset);
        pending.receivedChunks.add(chunkIndex);
        pending.lastActivityAt = Date.now();

        res.json({
          ok: true,
          chunkIndex,
          receivedCount: pending.receivedChunks.size,
        });
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : 'Erro ao gravar bloco do vídeo.';
        res.status(500).json({ error: msg });
      }
    }
  );

  app.post('/api/upload-abort', async (req, res) => {
    const { uploadId } = req.body as { uploadId?: string };
    const pending = uploadId ? pendingUploads.get(uploadId) : undefined;
    if (pending) {
      pendingUploads.delete(pending.uploadId);
      await pending.fh.close().catch(() => {});
      await fsp.unlink(pending.filePath).catch(() => {});
    }
    res.json({ ok: true });
  });

  app.post('/api/upload-complete', async (req, res) => {
    let pendingFilePath: string | null = null;
    try {
      const { uploadId } = req.body as { uploadId?: string };
      const pending = uploadId ? pendingUploads.get(uploadId) : undefined;
      if (!pending) {
        return res.status(404).json({ error: 'Envio não encontrado para finalização.' });
      }

      pendingFilePath = pending.filePath;
      pendingUploads.delete(pending.uploadId);
      await pending.fh.sync().catch(() => {});
      await pending.fh.close().catch(() => {});

      const stat = await fsp.stat(pending.filePath);
      if (
        pending.totalChunks > 0 &&
        pending.receivedChunks.size !== pending.totalChunks
      ) {
        await fsp.unlink(pending.filePath).catch(() => {});
        return res.status(400).json({
          error: `Upload incompleto: recebidos ${pending.receivedChunks.size} de ${pending.totalChunks} blocos. Tente novamente.`,
        });
      }
      if (pending.expectedSize > 0 && stat.size !== pending.expectedSize) {
        await fsp.unlink(pending.filePath).catch(() => {});
        return res.status(400).json({
          error: `Tamanho do arquivo divergente (${stat.size} de ${pending.expectedSize} bytes). Tente reenviar o vídeo.`,
        });
      }

      const probe = await probeVideo(pending.filePath);

      projects.set(pending.projectId, {
        projectId: pending.projectId,
        filePath: pending.filePath,
        fileName: pending.fileName,
        mimeType: pending.mimeType,
      });
      pendingFilePath = null;

      res.json({
        projectId: pending.projectId,
        fileName: pending.fileName,
        mediaUrl: `/api/media/${pending.projectId}`,
        duration: probe.duration,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
      });
    } catch (error) {
      if (pendingFilePath) {
        await fsp.unlink(pendingFilePath).catch(() => {});
      }
      const msg =
        error instanceof Error ? error.message : 'Falha ao ler metadados do vídeo.';
      res.status(500).json({ error: msg });
    }
  });

  // Upload direto (fallback para arquivos menores ou chamadas diretas)
  app.post('/api/upload', upload.single('video'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo de vídeo enviado.' });
      }

      const projectId = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const filePath = req.file.path;
      const probe = await probeVideo(filePath);

      projects.set(projectId, {
        projectId,
        filePath,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype || inferMimeType(filePath),
      });

      res.json({
        projectId,
        fileName: req.file.originalname,
        mediaUrl: `/api/media/${projectId}`,
        duration: probe.duration,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
      });
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : 'Falha ao processar o vídeo enviado.';
      res.status(500).json({ error: msg });
    }
  });

  // Inicia análise em 2 passes em background com progresso em tempo real (sem timeout em vídeos longos)
  app.post('/api/analyze-start', (req, res) => {
    const { projectId, settings } = req.body as {
      projectId?: string;
      settings?: AnalysisSettings;
    };

    if (!projectId || !projects.has(projectId)) {
      return res.status(404).json({ error: 'Projeto de vídeo não encontrado.' });
    }

    const project = projects.get(projectId)!;
    const safeSettings: AnalysisSettings = settings ?? {
      scope: 'both',
      shortTargetSeconds: 45,
      longTargetMinutes: 10,
      defaultPreset: 'destaque',
      verticalFraming: 'crop',
      showHeadOverlay: true,
      analysisMode: 'ai_full',
    };

    const analysisId = `an_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const job: StoredAnalysisJob = {
      analysisId,
      status: 'running',
      step: 'Iniciando leitura inteligente do vídeo...',
      progress: 5,
    };
    analysisJobs.set(analysisId, job);

    const workDir = path.join(WORKSPACE_TMP, 'analysis', projectId);
    void analyzeVideoWithGemini(project.filePath, safeSettings, workDir, (info) => {
      job.step = info.step;
      job.progress = info.progress;
    })
      .then((result) => {
        job.status = 'done';
        job.progress = 100;
        job.step = 'Concluído!';
        job.result = result;
      })
      .catch((err) => {
        console.error('[analyze-start error]', err);
        job.status = 'error';
        job.error =
          err instanceof Error ? err.message : 'Erro durante análise inteligente.';
      });

    res.json({ analysisId });
  });

  app.get('/api/analyze-status/:analysisId', (req, res) => {
    const job = analysisJobs.get(req.params.analysisId);
    if (!job) {
      return res.status(404).json({ error: 'Análise não encontrada.' });
    }
    res.json(job);
  });

  // Transcrição literal para cortes gerados por detecção local de picos
  app.post('/api/transcribe-clips', async (req, res) => {
    try {
      const { projectId, clips } = req.body as {
        projectId?: string;
        clips?: ClipItem[];
      };
      if (!projectId || !projects.has(projectId)) {
        return res.status(404).json({ error: 'Projeto de vídeo não encontrado.' });
      }
      if (!Array.isArray(clips) || clips.length === 0) {
        return res.json({ clips: [] });
      }
      const project = projects.get(projectId)!;
      const workDir = path.join(WORKSPACE_TMP, 'transcribe', projectId);
      const transcribed = await transcribeClipsBatch(project.filePath, clips, workDir);
      res.json({ clips: transcribed });
    } catch (error) {
      console.error('[transcribe-clips error]', error);
      const msg =
        error instanceof Error ? error.message : 'Erro ao transcrever legendas dos cortes.';
      res.status(500).json({ error: msg });
    }
  });

  // Análise síncrona (compatibilidade direta)
  app.post('/api/analyze', async (req, res) => {
    try {
      const { projectId, settings } = req.body as {
        projectId?: string;
        settings?: AnalysisSettings;
      };

      if (!projectId || !projects.has(projectId)) {
        return res.status(404).json({ error: 'Projeto de vídeo não encontrado.' });
      }

      const project = projects.get(projectId)!;
      const safeSettings: AnalysisSettings = settings ?? {
        scope: 'both',
        shortTargetSeconds: 45,
        longTargetMinutes: 10,
        defaultPreset: 'destaque',
        verticalFraming: 'crop',
        showHeadOverlay: true,
        analysisMode: 'ai_full',
      };

      const workDir = path.join(WORKSPACE_TMP, 'analysis', projectId);
      const result = await analyzeVideoWithGemini(
        project.filePath,
        safeSettings,
        workDir
      );

      res.json(result);
    } catch (error) {
      console.error('[analyze error]', error);
      const msg =
        error instanceof Error ? error.message : 'Erro durante análise inteligente.';
      res.status(500).json({ error: msg });
    }
  });

  // Análise por áudio compacto (fallback direto)
  const memoryAudioUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
  });

  app.post('/api/analyze-audio', memoryAudioUpload.single('audio'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum áudio compacto recebido.' });
      }
      const duration = Number(req.body?.duration ?? 60);
      const settings: AnalysisSettings = req.body?.settings
        ? JSON.parse(req.body.settings)
        : {
            scope: 'both',
            shortTargetSeconds: 45,
            longTargetMinutes: 10,
            defaultPreset: 'destaque',
            verticalFraming: 'crop',
            showHeadOverlay: true,
            analysisMode: 'ai_full',
          };

      const result = await analyzeAudioBufferWithGemini({
        audioBuffer: req.file.buffer,
        mimeType: req.file.mimetype || 'audio/wav',
        duration: Number.isFinite(duration) && duration > 0 ? duration : 60,
        settings,
      });

      res.json(result);
    } catch (error) {
      console.error('[analyze-audio error]', error);
      const msg =
        error instanceof Error ? error.message : 'Erro durante análise por áudio.';
      res.status(500).json({ error: msg });
    }
  });

  // Streaming com suporte a Range HTTP para scrubbing no player
  app.get('/api/media/:projectId', async (req, res) => {
    const { projectId } = req.params;
    let project = projects.get(projectId);

    if (!project && projectId === 'demo') {
      await ensureDemoVideo(DEMO_VIDEO_PATH);
      project = {
        projectId: 'demo',
        filePath: DEMO_VIDEO_PATH,
        fileName: 'podcast_estrategia_digital_exemplo.mp4',
        mimeType: 'video/mp4',
      };
      projects.set('demo', project);
    }

    if (!project || !fs.existsSync(project.filePath)) {
      return res.status(404).send('Vídeo não encontrado.');
    }

    const stat = fs.statSync(project.filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': project.mimeType,
      });
      fs.createReadStream(project.filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': project.mimeType,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(project.filePath).pipe(res);
    }
  });

  // Renderização individual ou em lote para MP4 (qualidade original) com legendas queimadas e nome pela Head Viral
  app.post('/api/render-batch', async (req, res) => {
    try {
      const { projectId, clips } = req.body as {
        projectId?: string;
        clips?: ClipItem[];
      };

      if (!projectId || !projects.has(projectId)) {
        return res.status(404).json({ error: 'Projeto não encontrado para renderização.' });
      }
      if (!Array.isArray(clips) || clips.length === 0) {
        return res.status(400).json({ error: 'Selecione ao menos um corte para renderizar.' });
      }

      const project = projects.get(projectId)!;
      const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const batchDir = path.join(RENDER_DIR, batchId);
      await fsp.mkdir(batchDir, { recursive: true });

      const usedFilenames = new Set<string>();
      const jobs: Array<RenderJobItem & { outputPath: string }> = clips.map((clip, i) => {
        let outputFilename = slugifyHeadForFilename(
          clip.head,
          'head_only',
          clip.index ?? i + 1,
          clip.format,
          'mp4'
        );
        if (usedFilenames.has(outputFilename)) {
          outputFilename = outputFilename.replace(/\.mp4$/, `_${i + 1}.mp4`);
        }
        usedFilenames.add(outputFilename);

        const jobId = `job_${i + 1}_${Math.random().toString(36).slice(2, 6)}`;
        return {
          jobId,
          clipId: clip.id,
          head: clip.head,
          format: clip.format,
          outputFilename,
          status: 'queued',
          progress: 0,
          outputPath: path.join(batchDir, outputFilename),
        };
      });

      const batch: StoredBatch = { batchId, batchDir, jobs };
      batches.set(batchId, batch);

      // Processa a fila em background no servidor local
      void (async () => {
        for (let i = 0; i < clips.length; i++) {
          const clip = clips[i];
          const job = batch.jobs[i];
          job.status = 'rendering';
          job.progress = 5;

          try {
            await renderClipToMp4({
              sourcePath: project.filePath,
              clip,
              outputPath: job.outputPath,
              workDir: path.join(batchDir, `work_${job.jobId}`),
              onProgress: (pct) => {
                job.progress = pct;
              },
            });
            const st = await fsp.stat(job.outputPath);
            if (st.size < 1024) {
              throw new Error('O arquivo .mp4 renderizado ficou vazio ou corrompido.');
            }
            job.fileSize = st.size;
            job.status = 'done';
            job.progress = 100;
            job.downloadUrl = `/api/download/${batchId}/${job.jobId}`;
          } catch (err) {
            job.status = 'error';
            job.error = err instanceof Error ? err.message : 'Erro na renderização FFmpeg.';
          }
        }
      })();

      res.json({
        batchId,
        jobs: jobs.map(({ outputPath: _op, ...rest }) => rest),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Erro ao iniciar lote.';
      res.status(500).json({ error: msg });
    }
  });

  app.get('/api/batches/:batchId', (req, res) => {
    const batch = batches.get(req.params.batchId);
    if (!batch) {
      return res.status(404).json({ error: 'Lote não encontrado.' });
    }
    res.json({
      batchId: batch.batchId,
      jobs: batch.jobs.map(({ outputPath: _op, ...rest }) => rest),
    });
  });

  const sendFileWithRangeSupport = (
    req: express.Request,
    res: express.Response,
    filePath: string,
    contentType: string,
    downloadFilename: string
  ) => {
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const safeFilename = downloadFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const rangeHeader = req.headers.range;

    if (rangeHeader) {
      const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
      if (!match) {
        return res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
      }
      const start = parseInt(match[1], 10);
      const requestedEnd = match[2] ? parseInt(match[2], 10) : fileSize - 1;
      const end = Math.min(fileSize - 1, requestedEnd);

      if (Number.isNaN(start) || Number.isNaN(end) || start >= fileSize || start > end) {
        return res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
      }

      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${safeFilename}"`,
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Content-Disposition': `attachment; filename="${safeFilename}"`,
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(filePath).pipe(res);
  };

  app.get('/api/download/:batchId/:jobId', (req, res) => {
    const batch = batches.get(req.params.batchId);
    const job = batch?.jobs.find((j) => j.jobId === req.params.jobId);
    if (!job || job.status !== 'done' || !fs.existsSync(job.outputPath)) {
      return res.status(404).json({ error: 'Arquivo renderizado não encontrado.' });
    }
    sendFileWithRangeSupport(req, res, job.outputPath, 'video/mp4', job.outputFilename);
  });

  app.get('/api/download-zip/:batchId', async (req, res) => {
    try {
      const batch = batches.get(req.params.batchId);
      if (!batch) {
        return res.status(404).json({ error: 'Lote não encontrado.' });
      }
      const readyJobs = batch.jobs.filter(
        (j) => j.status === 'done' && fs.existsSync(j.outputPath)
      );
      if (readyJobs.length === 0) {
        return res.status(400).json({ error: 'Nenhum corte finalizado neste lote ainda.' });
      }

      if (!batch.zipPath || !fs.existsSync(batch.zipPath)) {
        const zipPath = path.join(batch.batchDir, 'cortes_lote_cortefacil.zip');
        const zip = new JSZip();
        for (const job of readyJobs) {
          zip.file(job.outputFilename, fs.createReadStream(job.outputPath));
        }
        await new Promise<void>((resolve, reject) => {
          const out = fs.createWriteStream(zipPath);
          zip
            .generateNodeStream({
              type: 'nodebuffer',
              streamFiles: true,
              compression: 'STORE',
            })
            .on('error', reject)
            .pipe(out)
            .on('finish', resolve)
            .on('error', reject);
        });
        batch.zipPath = zipPath;
      }

      sendFileWithRangeSupport(
        req,
        res,
        batch.zipPath,
        'application/zip',
        'cortes_lote_cortefacil.zip'
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Erro ao gerar arquivo ZIP.';
      res.status(500).json({ error: msg });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve('dist');
    app.use(express.static(distPath));
    app.get('/{*path}', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CorteFácil ativo em http://localhost:${PORT}`);
    void ensureDemoVideo(DEMO_VIDEO_PATH).catch(() => {});
    void cleanupStaleTempFiles().catch(() => {});
  });
}

startServer().catch((err) => {
  console.error('Erro fatal ao iniciar servidor:', err);
  process.exit(1);
});
