import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BatchExportModal } from './components/BatchExportModal';
import { ClipQueue, type ClipFilterTab } from './components/ClipQueue';
import { OfflineIndicator } from './components/PWAInstallButton';
import { QuickEditPanel } from './components/QuickEditPanel';
import { TopBar } from './components/TopBar';
import { UploadScreen } from './components/UploadScreen';
import { VideoPreviewStage } from './components/VideoPreviewStage';
import type {
  AnalysisSettings,
  CaptionPresetId,
  ClipItem,
  HeadStyleConfig,
  RenderJobItem,
  VideoProject,
} from './types/clip';
import {
  formatDurationBadge,
  generateLocalStructuredClips,
} from './utils/clipLogic';
import { detectLocalAudioPeaks } from './utils/localVideoEngine';

const DEFAULT_SETTINGS: AnalysisSettings = {
  scope: 'both',
  shortTargetSeconds: 60,
  longTargetMinutes: 10,
  defaultPreset: 'destaque',
  verticalFraming: 'crop',
  showHeadOverlay: true,
  analysisMode: 'ai_full',
};

const CHUNK_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB por bloco
const UPLOAD_CONCURRENCY = 3;
const CHUNK_MAX_RETRIES = 4;

function formatResolutionLabel(width: number, height: number): string {
  const maxDim = Math.max(width, height);
  if (maxDim >= 3840) return `${width}×${height} (4K)`;
  if (maxDim >= 2560) return `${width}×${height} (2K)`;
  if (maxDim >= 1920) return `${width}×${height} (Full HD)`;
  return `${width}×${height}`;
}

export default function App() {
  const [settings, setSettings] = useState<AnalysisSettings>(DEFAULT_SETTINGS);
  const [project, setProject] = useState<VideoProject | null>(null);
  const [activeView, setActiveView] = useState<'upload' | 'studio'>('upload');
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<ClipFilterTab>('all');
  const [seekRequestTime, setSeekRequestTime] = useState<number | null>(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState('');
  const [processingProgress, setProcessingProgress] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Batch export state (FFmpeg .MP4 local engine preserving source resolution)
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [exportTargetClips, setExportTargetClips] = useState<ClipItem[]>([]);
  const [renderJobs, setRenderJobs] = useState<RenderJobItem[]>([]);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [isStartingRender, setIsStartingRender] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [downloadingJobId, setDownloadingJobId] = useState<string | null>(null);
  const [downloadingProgress, setDownloadingProgress] = useState<number | null>(null);
  const [isZipping, setIsZipping] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pollIntervalRef = useRef<number | null>(null);

  const clearPollInterval = () => {
    if (pollIntervalRef.current !== null) {
      window.clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearPollInterval();
      abortControllerRef.current?.abort();
    };
  }, []);

  const startDemoProject = useCallback(async () => {
    setErrorMessage(null);
    setIsProcessing(true);
    setProcessingStep('Preparando vídeo exemplo...');
    setProcessingProgress(null);
    try {
      const res = await fetch('/api/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Não foi possível carregar o vídeo exemplo.');
      }
      const loaded = data as VideoProject;
      setProject(loaded);
      setActiveClipId(loaded.clips[0]?.id ?? null);
      setFilterTab('all');
      setActiveView('studio');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Erro ao iniciar vídeo exemplo.'
      );
    } finally {
      setIsProcessing(false);
      setProcessingStep('');
      setProcessingProgress(null);
    }
  }, [settings]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1' && !project) {
      void startDemoProject();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmitVideo = async (file: File) => {
    setErrorMessage(null);
    setIsProcessing(true);
    setProcessingProgress(null);

    let activeUploadId: string | null = null;
    let uploadCompleted = false;

    try {
      const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE_BYTES));

      // Todos os fluxos preparam o arquivo localmente em blocos posicionais para garantir .MP4 na qualidade original (até 4K)
      setProcessingStep('Preparando arquivo de vídeo no motor local...');
      setProcessingProgress(2);

      const initRes = await fetch('/api/upload-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          fileSize: file.size,
          totalChunks,
          mimeType: file.type || 'video/mp4',
        }),
      });
      const initData = await initRes.json();
      if (!initRes.ok) {
        throw new Error(initData.error || 'Falha ao iniciar o carregamento do vídeo.');
      }

      const uploadId: string = initData.uploadId;
      activeUploadId = uploadId;
      let completedChunks = 0;
      let nextChunkIndex = 0;

      const uploadSingleChunk = async (idx: number) => {
        const start = idx * CHUNK_SIZE_BYTES;
        const end = Math.min(file.size, start + CHUNK_SIZE_BYTES);
        const slice = file.slice(start, end);

        let lastError: Error | null = null;
        for (let attempt = 1; attempt <= CHUNK_MAX_RETRIES; attempt++) {
          try {
            const chunkRes = await fetch(
              `/api/upload-chunk?uploadId=${encodeURIComponent(
                uploadId
              )}&chunkIndex=${idx}&offset=${start}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: slice,
              }
            );
            if (!chunkRes.ok) {
              const errData = await chunkRes.json().catch(() => ({}));
              throw new Error(
                errData.error || `Falha ao carregar bloco ${idx + 1} de ${totalChunks}.`
              );
            }
            return;
          } catch (err) {
            lastError =
              err instanceof Error
                ? err
                : new Error(`Falha de rede no bloco ${idx + 1}.`);
            if (attempt < CHUNK_MAX_RETRIES) {
              await new Promise((r) => setTimeout(r, 800 * attempt));
            }
          }
        }
        throw lastError!;
      };

      const workerCount = Math.min(UPLOAD_CONCURRENCY, totalChunks);
      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (true) {
            const idx = nextChunkIndex++;
            if (idx >= totalChunks) break;
            await uploadSingleChunk(idx);
            completedChunks++;
            const uploadPct = Math.round((completedChunks / totalChunks) * 55);
            setProcessingProgress(uploadPct);
            setProcessingStep(
              `Carregando vídeo para processamento local (${completedChunks}/${totalChunks})...`
            );
          }
        })
      );

      setProcessingStep('Lendo resolução original e trilhas do vídeo...');
      setProcessingProgress(58);
      const completeRes = await fetch('/api/upload-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId }),
      });
      const completeData = await completeRes.json();
      if (!completeRes.ok) {
        throw new Error(completeData.error || 'Falha ao validar o vídeo carregado.');
      }
      uploadCompleted = true;

      let clips: ClipItem[] = [];
      let overallTopic = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');

      if (settings.analysisMode === 'ai_full') {
        setProcessingStep(
          'Mapeando momentos completos e transcrevendo áudio fielmente...'
        );
        setProcessingProgress(62);
        const startRes = await fetch('/api/analyze-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: completeData.projectId,
            settings,
          }),
        });
        const startData = await startRes.json();
        if (!startRes.ok || !startData.analysisId) {
          throw new Error(
            startData.error || 'Erro ao iniciar leitura inteligente do vídeo.'
          );
        }

        let analyzeData: { overallTopic?: string; clips?: ClipItem[] } | null = null;
        while (!analyzeData) {
          await new Promise((r) => setTimeout(r, 900));
          const statusRes = await fetch(
            `/api/analyze-status/${encodeURIComponent(startData.analysisId)}`
          );
          if (!statusRes.ok) {
            throw new Error('Falha ao acompanhar progresso da análise.');
          }
          const statusJson = await statusRes.json();
          if (statusJson.step) {
            setProcessingStep(statusJson.step);
          }
          if (typeof statusJson.progress === 'number') {
            setProcessingProgress(
              Math.min(99, 60 + Math.round((statusJson.progress / 100) * 40))
            );
          }
          if (statusJson.status === 'error') {
            throw new Error(
              statusJson.error || 'Erro ao analisar conteúdo com inteligência artificial.'
            );
          }
          if (statusJson.status === 'done') {
            analyzeData = statusJson.result ?? {};
          }
        }

        clips = Array.isArray(analyzeData.clips) ? analyzeData.clips : [];
        if (analyzeData.overallTopic) {
          overallTopic = analyzeData.overallTopic;
        }
      } else {
        setProcessingStep('Detectando picos de áudio localmente na sua máquina...');
        setProcessingProgress(66);
        const peaks = await detectLocalAudioPeaks(file);
        const peakClips = generateLocalStructuredClips({
          duration: completeData.duration,
          fileName: file.name,
          settings,
          energyPeaks: peaks,
        });

        setProcessingStep('Transcrevendo legendas fiéis para cada corte...');
        setProcessingProgress(80);
        const transcribeRes = await fetch('/api/transcribe-clips', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: completeData.projectId,
            clips: peakClips,
          }),
        });
        if (transcribeRes.ok) {
          const tData = await transcribeRes.json();
          clips = Array.isArray(tData.clips) ? tData.clips : peakClips;
        } else {
          const errJson = await transcribeRes.json().catch(() => ({}));
          throw new Error(
            errJson.error || 'Não foi possível transcrever as legendas deste vídeo.'
          );
        }
      }

      if (clips.length === 0) {
        throw new Error(
          'Nenhum corte pôde ser identificado. Tente ajustar as durações ou verificar o áudio.'
        );
      }

      const loaded: VideoProject = {
        projectId: completeData.projectId,
        fileName: completeData.fileName,
        mediaUrl: completeData.mediaUrl,
        duration: completeData.duration,
        width: completeData.width,
        height: completeData.height,
        fps: completeData.fps,
        isDemo: false,
        hasServerMedia: true,
        overallTopic,
        clips,
      };

      setProcessingProgress(100);
      setProject(loaded);
      setActiveClipId(clips[0]?.id ?? null);
      setFilterTab('all');
      setActiveView('studio');
    } catch (err) {
      if (activeUploadId && !uploadCompleted) {
        void fetch('/api/upload-abort', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uploadId: activeUploadId }),
        }).catch(() => {});
      }
      setErrorMessage(
        err instanceof Error ? err.message : 'Erro inesperado ao processar o vídeo.'
      );
    } finally {
      setIsProcessing(false);
      setProcessingStep('');
      setProcessingProgress(null);
    }
  };

  const activeClip = useMemo(() => {
    if (!project) return null;
    return (
      project.clips.find((c) => c.id === activeClipId) ?? project.clips[0] ?? null
    );
  }, [project, activeClipId]);

  const selectedClips = useMemo(
    () => (project ? project.clips.filter((c) => c.selected) : []),
    [project]
  );

  const sourceResolutionLabel = useMemo(() => {
    if (!project) return 'Original';
    return formatResolutionLabel(project.width, project.height);
  }, [project]);

  const handleUpdateClip = (
    clipId: string,
    updater: (prev: ClipItem) => ClipItem
  ) => {
    setProject((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        clips: prev.clips.map((c) => (c.id === clipId ? updater(c) : c)),
      };
    });
  };

  const handleToggleBatchCheck = (clipId: string) => {
    handleUpdateClip(clipId, (c) => ({ ...c, selected: !c.selected }));
  };

  const handleSelectAllVisible = (select: boolean) => {
    setProject((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        clips: prev.clips.map((c) => {
          const matchesFilter = filterTab === 'all' || c.format === filterTab;
          return matchesFilter ? { ...c, selected: select } : c;
        }),
      };
    });
  };

  const handleApplyPresetToAll = (preset: CaptionPresetId) => {
    setProject((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        clips: prev.clips.map((c) => ({ ...c, captionPreset: preset })),
      };
    });
  };

  const handleApplyHeadStyleToAll = (
    headStyle: HeadStyleConfig,
    showHeadOverlay: boolean
  ) => {
    setProject((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        clips: prev.clips.map((c) => ({
          ...c,
          showHeadOverlay,
          headStyle: { ...headStyle },
        })),
      };
    });
  };

  const openExportModalForClips = (clipsToExport: ClipItem[]) => {
    clearPollInterval();
    abortControllerRef.current?.abort();
    setExportTargetClips(clipsToExport);
    setRenderJobs([]);
    setActiveBatchId(null);
    setRenderError(null);
    setIsStartingRender(false);
    setIsExportOpen(true);
  };

  const handleCloseExportModal = () => {
    clearPollInterval();
    abortControllerRef.current?.abort();
    setIsExportOpen(false);
    setIsStartingRender(false);
  };

  const handleStartBatchRender = async () => {
    if (!project || exportTargetClips.length === 0) return;
    setRenderError(null);
    setIsStartingRender(true);
    clearPollInterval();

    try {
      const res = await fetch('/api/render-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.projectId,
          clips: exportTargetClips,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Erro ao iniciar renderização FFmpeg.');
      }

      const batchId: string = data.batchId;
      setActiveBatchId(batchId);
      setRenderJobs(Array.isArray(data.jobs) ? data.jobs : []);

      pollIntervalRef.current = window.setInterval(async () => {
        try {
          const pollRes = await fetch(`/api/batches/${encodeURIComponent(batchId)}`);
          if (!pollRes.ok) return;
          const pollData = await pollRes.json();
          const jobsList: RenderJobItem[] = Array.isArray(pollData.jobs)
            ? pollData.jobs
            : [];
          setRenderJobs(jobsList);

          const allFinished =
            jobsList.length > 0 &&
            jobsList.every((j) => j.status === 'done' || j.status === 'error');
          if (allFinished) {
            clearPollInterval();
            setIsStartingRender(false);
          }
        } catch {
          // Keep polling on transient network blip
        }
      }, 750);
    } catch (err) {
      setRenderError(
        err instanceof Error ? err.message : 'Erro ao iniciar renderização em lote.'
      );
      setIsStartingRender(false);
    }
  };

  const downloadInChunks = async (
    url: string,
    filename: string,
    mimeType: string,
    knownSize?: number,
    onProgress?: (pct: number) => void
  ) => {
    const DOWNLOAD_CHUNK_BYTES = 8 * 1024 * 1024; // 8 MB por bloco (abaixo do limite do proxy)
    const parts: ArrayBuffer[] = [];
    let offset = 0;
    let totalSize = knownSize && knownSize > 0 ? knownSize : 0;

    while (true) {
      const requestedEnd =
        totalSize > 0
          ? Math.min(totalSize - 1, offset + DOWNLOAD_CHUNK_BYTES - 1)
          : offset + DOWNLOAD_CHUNK_BYTES - 1;

      let res: Response | null = null;
      let lastErr: Error | null = null;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const attemptRes = await fetch(url, {
            headers: {
              Range: `bytes=${offset}-${requestedEnd}`,
            },
            cache: 'no-store',
          });
          const ct = (attemptRes.headers.get('content-type') || '').toLowerCase();
          if (ct.includes('text/html')) {
            throw new Error(
              'O servidor retornou uma página HTML em vez do vídeo. Recarregue a página e tente novamente.'
            );
          }
          if (!attemptRes.ok && attemptRes.status !== 206) {
            const errJson = await attemptRes.json().catch(() => ({}));
            throw new Error(
              errJson.error || `Falha ao baixar arquivo (HTTP ${attemptRes.status}).`
            );
          }
          res = attemptRes;
          break;
        } catch (err) {
          lastErr = err instanceof Error ? err : new Error('Erro de rede ao baixar.');
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, 600 * attempt));
          }
        }
      }

      if (!res) {
        throw lastErr || new Error('Não foi possível baixar o arquivo.');
      }

      const chunkBuf = await res.arrayBuffer();
      if (chunkBuf.byteLength === 0) {
        throw new Error('O bloco recebido veio vazio.');
      }
      parts.push(chunkBuf);
      offset += chunkBuf.byteLength;

      if (res.status === 200) {
        totalSize = offset;
        onProgress?.(100);
        break;
      }

      const contentRange = res.headers.get('content-range');
      if (contentRange) {
        const match = /\/(\d+)$/.exec(contentRange);
        if (match) {
          totalSize = Number(match[1]);
        }
      }

      if (totalSize > 0) {
        onProgress?.(Math.min(100, Math.round((offset / totalSize) * 100)));
        if (offset >= totalSize) {
          break;
        }
      } else if (chunkBuf.byteLength < DOWNLOAD_CHUNK_BYTES) {
        break;
      }
    }

    const totalReceived = parts.reduce((sum, b) => sum + b.byteLength, 0);
    if (totalReceived < 1024 || (totalSize > 0 && totalReceived !== totalSize)) {
      throw new Error(
        `Download incompleto (${totalReceived} de ${totalSize || '?'} bytes). Tente baixar novamente.`
      );
    }

    const blob = new Blob(parts, { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 15_000);
  };

  const handleDownloadJob = async (job: RenderJobItem) => {
    if (!job.downloadUrl) return;
    setRenderError(null);
    setDownloadingJobId(job.jobId);
    setDownloadingProgress(0);
    try {
      await downloadInChunks(
        job.downloadUrl,
        job.outputFilename,
        'video/mp4',
        job.fileSize,
        (pct) => setDownloadingProgress(pct)
      );
    } catch (err) {
      setRenderError(
        err instanceof Error ? err.message : 'Não foi possível baixar o vídeo renderizado.'
      );
    } finally {
      setDownloadingJobId(null);
      setDownloadingProgress(null);
    }
  };

  const handleDownloadZip = async () => {
    if (!activeBatchId) return;
    setRenderError(null);
    setIsZipping(true);
    try {
      await downloadInChunks(
        `/api/download-zip/${encodeURIComponent(activeBatchId)}`,
        'cortes_lote_cortefacil.zip',
        'application/zip'
      );
    } catch (err) {
      setRenderError(
        err instanceof Error ? err.message : 'Falha ao gerar arquivo ZIP.'
      );
    } finally {
      setIsZipping(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#090D16] text-slate-50">
      <TopBar
        activeView={activeView}
        hasProject={Boolean(project)}
        selectedCount={selectedClips.length}
        onNavigateUpload={() => setActiveView('upload')}
        onNavigateStudio={() => project && setActiveView('studio')}
        onOpenBatchModal={() => openExportModalForClips(selectedClips)}
        onStartDemo={startDemoProject}
      />

      {activeView === 'upload' || !project ? (
        <UploadScreen
          settings={settings}
          onChangeSettings={setSettings}
          onSubmitVideo={handleSubmitVideo}
          onStartDemo={startDemoProject}
          isProcessing={isProcessing}
          processingStep={processingStep}
          processingProgress={processingProgress}
          errorMessage={errorMessage}
        />
      ) : (
        <main className="max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-5 flex-1 flex flex-col gap-4">
          {/* Studio context strip */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1">
            <div className="min-w-0">
              <h1 className="font-display text-lg font-bold text-white truncate">
                {project.overallTopic}
              </h1>
              <div className="flex items-center flex-wrap gap-x-2 text-xs text-slate-400 tabular-nums">
                <span className="truncate max-w-[260px]">{project.fileName}</span>
                <span aria-hidden="true">·</span>
                <span>Duração total {formatDurationBadge(project.duration)}</span>
                <span aria-hidden="true">·</span>
                <span>{project.clips.length} cortes sugeridos</span>
                <span aria-hidden="true">·</span>
                <span className="text-emerald-400 font-medium">
                  .MP4 {sourceResolutionLabel}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setActiveView('upload')}
                className="px-3 py-1.5 rounded-lg border border-slate-700 bg-[#111827] text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap cursor-pointer"
              >
                Trocar vídeo
              </button>
            </div>
          </div>

          {/* 3-Column Studio Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:h-[calc(100vh-176px)] min-h-[620px]">
            <div className="order-3 lg:order-1 lg:col-span-3 h-full min-h-[340px]">
              <ClipQueue
                clips={project.clips}
                activeClipId={activeClip?.id ?? null}
                filterTab={filterTab}
                onChangeFilter={setFilterTab}
                onSelectClip={(id) => setActiveClipId(id)}
                onToggleBatchCheck={handleToggleBatchCheck}
                onSelectAllVisible={handleSelectAllVisible}
              />
            </div>

            <div className="order-1 lg:order-2 lg:col-span-5 h-full min-h-[460px]">
              {activeClip ? (
                <VideoPreviewStage
                  mediaUrl={project.mediaUrl}
                  clip={activeClip}
                  seekRequestTime={seekRequestTime}
                  onClearSeekRequest={() => setSeekRequestTime(null)}
                  onExportSingleClip={(c) => openExportModalForClips([c])}
                />
              ) : (
                <div className="bg-[#111827] border border-slate-800 rounded-2xl h-full flex items-center justify-center text-sm text-slate-400">
                  Selecione um corte ao lado para visualizar.
                </div>
              )}
            </div>

            <div className="order-2 lg:order-3 lg:col-span-4 h-full min-h-[440px]">
              {activeClip && (
                <QuickEditPanel
                  clip={activeClip}
                  videoDuration={project.duration}
                  onUpdateClip={handleUpdateClip}
                  onApplyPresetToAll={handleApplyPresetToAll}
                  onApplyHeadStyleToAll={handleApplyHeadStyleToAll}
                  onSeekTo={(t) => setSeekRequestTime(t)}
                />
              )}
            </div>
          </div>
        </main>
      )}

      <BatchExportModal
        isOpen={isExportOpen}
        onClose={handleCloseExportModal}
        selectedClips={exportTargetClips}
        sourceResolutionLabel={sourceResolutionLabel}
        jobs={renderJobs}
        isStartingRender={isStartingRender}
        renderError={renderError}
        downloadingJobId={downloadingJobId}
        downloadingProgress={downloadingProgress}
        onStartBatchRender={handleStartBatchRender}
        onDownloadJob={handleDownloadJob}
        onDownloadZip={handleDownloadZip}
        isZipping={isZipping}
      />

      <OfflineIndicator />
    </div>
  );
}
