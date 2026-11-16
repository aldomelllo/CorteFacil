import React from 'react';
import { Archive, CheckCircle2, Cpu, Download, X } from 'lucide-react';
import type { ClipItem, RenderJobItem } from '../types/clip';
import { slugifyHeadForFilename } from '../utils/clipLogic';

interface BatchExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedClips: ClipItem[];
  sourceResolutionLabel: string;
  jobs: RenderJobItem[];
  isStartingRender: boolean;
  renderError: string | null;
  downloadingJobId: string | null;
  downloadingProgress: number | null;
  onStartBatchRender: () => void;
  onDownloadJob: (job: RenderJobItem) => void;
  onDownloadZip: () => void;
  isZipping: boolean;
}

export const BatchExportModal: React.FC<BatchExportModalProps> = ({
  isOpen,
  onClose,
  selectedClips,
  sourceResolutionLabel,
  jobs,
  isStartingRender,
  renderError,
  downloadingJobId,
  downloadingProgress,
  onStartBatchRender,
  onDownloadJob,
  onDownloadZip,
  isZipping,
}) => {
  if (!isOpen) return null;

  const hasStarted = jobs.length > 0;
  const allDone =
    hasStarted && jobs.every((j) => j.status === 'done' || j.status === 'error');
  const readyCount = jobs.filter((j) => j.status === 'done').length;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="batch-export-title"
    >
      <div className="bg-[#111827] border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden shadow-2xl text-slate-100">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between gap-4">
          <div>
            <h2
              id="batch-export-title"
              className="font-display text-lg font-semibold text-white"
            >
              Exportar e Baixar Cortes (.MP4)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>
                Exportação em .MP4 mantendo a qualidade original ({sourceResolutionLabel}), com legendas e arquivo nomeado pela Head Viral.
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar janela de exportação"
            className="w-8 h-8 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {renderError && (
            <div className="p-3 rounded-lg bg-red-950/60 border border-red-800 text-xs text-red-200">
              {renderError}
            </div>
          )}

          {/* Queue list */}
          <div className="border border-slate-800 rounded-xl divide-y divide-slate-800 bg-[#0B1120]">
            {hasStarted
              ? jobs.map((job) => {
                  const isDownloadingThis = downloadingJobId === job.jobId;
                  return (
                    <div
                      key={job.jobId}
                      className="p-3.5 flex items-center justify-between gap-4"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-white truncate">
                          {job.head}
                        </div>
                        <div className="text-xs font-mono text-slate-400 truncate mt-0.5">
                          {job.outputFilename} · {job.format === 'vertical' ? '9:16' : '16:9'}
                          {typeof job.fileSize === 'number' && job.fileSize > 0
                            ? ` · ${(job.fileSize / (1024 * 1024)).toFixed(1)} MB`
                            : ''}
                        </div>
                        {job.status === 'rendering' && (
                          <div className="mt-2 h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-indigo-500 transition-all"
                              style={{ width: `${job.progress}%` }}
                            />
                          </div>
                        )}
                        {job.status === 'error' && (
                          <div className="mt-1 text-xs text-red-400">{job.error}</div>
                        )}
                      </div>

                      <div className="shrink-0">
                        {job.status === 'done' && job.downloadUrl ? (
                          <button
                            type="button"
                            disabled={downloadingJobId !== null}
                            onClick={() => onDownloadJob(job)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 disabled:opacity-60 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>
                              {isDownloadingThis
                                ? `Baixando ${downloadingProgress ?? 0}%`
                                : 'Baixar'}
                            </span>
                          </button>
                        ) : job.status === 'rendering' ? (
                          <span className="text-xs font-medium text-indigo-400 tabular-nums">
                            Renderizando {job.progress}%
                          </span>
                        ) : job.status === 'error' ? (
                          <span className="text-xs font-medium text-red-400">Falhou</span>
                        ) : (
                          <span className="text-xs text-slate-500">Na fila</span>
                        )}
                      </div>
                    </div>
                  );
                })
              : selectedClips.map((clip) => (
                  <div
                    key={clip.id}
                    className="p-3.5 flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white truncate">
                        {clip.head}
                      </div>
                      <div className="text-xs font-mono text-indigo-300 truncate mt-0.5">
                        {slugifyHeadForFilename(
                          clip.head,
                          'head_only',
                          clip.index,
                          clip.format,
                          'mp4'
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-slate-400 font-medium whitespace-nowrap shrink-0">
                      {clip.format === 'vertical' ? '9:16 Vertical' : '16:9 Horizontal'}
                    </span>
                  </div>
                ))}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-800 bg-[#0B1120] flex items-center justify-between gap-3 flex-wrap">
          {!hasStarted ? (
            <>
              <span className="text-xs text-slate-400 tabular-nums">
                {selectedClips.length}{' '}
                {selectedClips.length === 1 ? 'corte selecionado' : 'cortes selecionados'}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg border border-slate-700 bg-slate-900 text-xs font-semibold text-slate-300 hover:bg-slate-800 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={selectedClips.length === 0 || isStartingRender}
                  onClick={onStartBatchRender}
                  className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-500 disabled:opacity-50 cursor-pointer"
                >
                  {isStartingRender ? 'Processando...' : 'Renderizar .MP4 agora'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
                {allDone ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>
                      {readyCount} de {jobs.length} prontos para baixar
                    </span>
                  </>
                ) : (
                  <>
                    <span className="inline-block w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                    <span>
                      Renderizando .MP4 ({sourceResolutionLabel}) com vídeo, áudio e legenda sincronizados...
                    </span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2">
                {readyCount > 1 && (
                  <button
                    type="button"
                    disabled={isZipping}
                    onClick={onDownloadZip}
                    className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-500 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    <span>{isZipping ? 'Compactando...' : 'Baixar Lote (.ZIP)'}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg border border-slate-700 bg-slate-900 text-xs font-semibold text-slate-300 hover:bg-slate-800 cursor-pointer"
                >
                  Fechar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
