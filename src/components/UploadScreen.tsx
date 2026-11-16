import React, { useRef, useState } from 'react';
import { Check, Cpu, Film, Play, Scissors, Upload } from 'lucide-react';
import type {
  AnalysisMode,
  AnalysisSettings,
  CaptionPresetId,
  GenerationScope,
  VerticalFraming,
} from '../types/clip';
import { CAPTION_PRESETS, formatDurationBadge } from '../utils/clipLogic';
import { PWAInstallControl } from './PWAInstallButton';

interface UploadScreenProps {
  settings: AnalysisSettings;
  onChangeSettings: (next: AnalysisSettings) => void;
  onSubmitVideo: (file: File) => void;
  onStartDemo: () => void;
  isProcessing: boolean;
  processingStep: string;
  processingProgress: number | null;
  errorMessage: string | null;
}

export const UploadScreen: React.FC<UploadScreenProps> = ({
  settings,
  onChangeSettings,
  onSubmitVideo,
  onStartDemo,
  isProcessing,
  processingStep,
  processingProgress,
  errorMessage,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFilePick = (file: File | undefined) => {
    if (!file) return;
    setSelectedFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFilePick(file);
  };

  const updateField = <K extends keyof AnalysisSettings>(
    key: K,
    value: AnalysisSettings[K]
  ) => {
    onChangeSettings({ ...settings, [key]: value });
  };

  const scopeOptions: Array<{ value: GenerationScope; label: string }> = [
    { value: 'both', label: 'Ambos' },
    { value: 'vertical', label: 'Verticais (9:16)' },
    { value: 'horizontal', label: 'Horizontais (16:9)' },
  ];

  const shortDurations = [30, 60, 90, 120, 180];
  const longDurations = [3, 5, 10, 15];

  return (
    <main className="max-w-[1200px] w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div className="max-w-2xl">
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white leading-tight text-balance">
            Suba um vídeo longo e saia com cortes e Heads virais prontos para postar.
          </h1>
          <p className="mt-2 text-sm sm:text-base text-slate-400 leading-relaxed">
            Lê o vídeo inteiro em blocos, cria títulos que despertam curiosidade para assistir o vídeo completo e renderiza com legendas dinâmicas.
          </p>
        </div>

        <div className="md:hidden">
          <PWAInstallControl variant="banner" />
        </div>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="mb-5 p-3.5 rounded-xl bg-red-950/60 border border-red-800/80 text-sm text-red-200"
        >
          {errorMessage}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left column: Video Selection & Analysis Mode */}
        <section className="lg:col-span-6 bg-[#111827] border border-slate-800 rounded-2xl p-5 sm:p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <h2 className="font-display text-base sm:text-lg font-semibold text-white">
                1. Selecionar vídeo longo
              </h2>
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                <Cpu className="w-3.5 h-3.5" />
                <span>Motor Local .MP4 (até 4K)</span>
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 mb-4">
              Suporta gravações e podcasts longos (MP4, MOV, WebM ou MKV).
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="sr-only"
              aria-label="Selecionar arquivo de vídeo"
              onChange={(e) => handleFilePick(e.target.files?.[0])}
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              disabled={isProcessing}
              className={`w-full rounded-xl border-2 border-dashed p-6 text-center transition-colors cursor-pointer flex flex-col items-center justify-center min-h-[168px] ${
                isDragging
                  ? 'border-indigo-500 bg-indigo-950/40'
                  : selectedFile
                  ? 'border-indigo-500/70 bg-[#0B1120]'
                  : 'border-slate-700 bg-[#0B1120]/60 hover:border-indigo-500/70 hover:bg-[#0B1120]'
              }`}
            >
              <div className="w-11 h-11 rounded-xl bg-indigo-500/15 text-indigo-400 flex items-center justify-center mb-2.5">
                {selectedFile ? <Film className="w-5 h-5" /> : <Upload className="w-5 h-5" />}
              </div>
              {selectedFile ? (
                <>
                  <span className="text-sm font-semibold text-white break-all max-w-xs">
                    {selectedFile.name}
                  </span>
                  <span className="mt-1 text-xs text-slate-400 tabular-nums">
                    {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB selecionado
                  </span>
                </>
              ) : (
                <>
                  <span className="text-sm font-semibold text-slate-100">
                    Clique para escolher ou arraste seu vídeo aqui
                  </span>
                  <span className="mt-1 text-xs text-slate-400">
                    Vídeos de 10, 30 ou 60+ minutos com envio em blocos seguros
                  </span>
                </>
              )}
            </button>

            {/* Processing / Analysis Mode selector */}
            <div className="mt-4">
              <span className="block text-xs font-semibold text-slate-300 mb-2">
                Como analisar e renderizar os cortes
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(
                  [
                    {
                      value: 'ai_full',
                      title: 'IA Viral Completa (.MP4 Original)',
                      desc: 'Lê 100% do vídeo em blocos, cria Heads virais, legenda fiel e exporta .MP4 na qualidade original (até 4K).',
                    },
                    {
                      value: 'local_offline',
                      title: 'Picos Rápidos + Legenda (.MP4)',
                      desc: 'Usa picos de áudio na sua máquina, transcreve as falas e exporta .MP4 na qualidade original.',
                    },
                  ] as Array<{ value: AnalysisMode; title: string; desc: string }>
                ).map((m) => {
                  const active = settings.analysisMode === m.value;
                  return (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => updateField('analysisMode', m.value)}
                      className={`p-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                        active
                          ? 'border-indigo-500 bg-indigo-500/10'
                          : 'border-slate-800 bg-[#0B1120] hover:border-slate-700'
                      }`}
                    >
                      <div className="text-xs font-semibold text-white">{m.title}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                        {m.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-800 flex flex-col gap-2.5">
            {isProcessing ? (
              <div className="p-3.5 rounded-xl bg-indigo-950/60 border border-indigo-800 text-sm text-indigo-200 flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <span className="inline-block w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin shrink-0" />
                  <span className="font-medium">
                    {processingStep || 'Analisando vídeo e gerando cortes...'}
                  </span>
                </div>
                {typeof processingProgress === 'number' && (
                  <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-400 transition-all"
                      style={{ width: `${Math.max(4, processingProgress)}%` }}
                    />
                  </div>
                )}
              </div>
            ) : (
              <>
                <button
                  type="button"
                  disabled={!selectedFile}
                  onClick={() => selectedFile && onSubmitVideo(selectedFile)}
                  className="w-full py-2.5 px-5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Scissors className="w-4 h-4" />
                  <span>Gerar Cortes e Heads Virais</span>
                </button>

                <button
                  type="button"
                  onClick={onStartDemo}
                  className="w-full py-2.5 px-4 rounded-xl border border-slate-700 bg-[#0B1120] text-slate-200 text-sm font-medium hover:bg-slate-800 hover:text-white transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Play className="w-4 h-4 text-indigo-400" />
                  <span>Testar agora com Vídeo Exemplo</span>
                </button>
              </>
            )}
          </div>
        </section>

        {/* Right column: Basic Settings */}
        <section
          id="presets-info"
          className="lg:col-span-6 bg-[#111827] border border-slate-800 rounded-2xl p-5 sm:p-6 flex flex-col gap-4"
        >
          <div>
            <h2 className="font-display text-base sm:text-lg font-semibold text-white mb-0.5">
              2. Definições básicas do corte
            </h2>
            <p className="text-xs sm:text-sm text-slate-400">
              Ajuste apenas o formato, o tempo e o estilo inicial de legenda.
            </p>
          </div>

          {/* Scope / Formato */}
          <div>
            <span className="block text-xs font-semibold text-slate-300 mb-2">
              Quais cortes gerar
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 p-1 bg-[#0B1120] border border-slate-800 rounded-xl">
              {scopeOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => updateField('scope', opt.value)}
                  className={`py-2 px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    settings.scope === opt.value
                      ? 'bg-slate-800 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tempo dos cortes */}
          <div className="space-y-4">
            {(settings.scope === 'vertical' || settings.scope === 'both') && (
              <div>
                <label
                  htmlFor="short-duration-select"
                  className="block text-xs font-semibold text-slate-300 mb-2"
                >
                  Tempo dos cortes verticais (9:16 · até 3 min)
                </label>
                <div
                  id="short-duration-select"
                  className="grid grid-cols-3 sm:grid-cols-5 gap-2"
                >
                  {shortDurations.map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => updateField('shortTargetSeconds', sec)}
                      className={`py-2 px-2 rounded-lg border text-xs font-medium tabular-nums transition-colors whitespace-nowrap cursor-pointer ${
                        settings.shortTargetSeconds === sec
                          ? 'border-indigo-500 bg-indigo-500/15 text-indigo-300 font-semibold'
                          : 'border-slate-800 bg-[#0B1120] text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      {formatDurationBadge(sec)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(settings.scope === 'horizontal' || settings.scope === 'both') && (
              <div>
                <label
                  htmlFor="long-duration-select"
                  className="block text-xs font-semibold text-slate-300 mb-2"
                >
                  Tempo dos cortes horizontais (16:9)
                </label>
                <div id="long-duration-select" className="grid grid-cols-4 gap-2">
                  {longDurations.map((min) => (
                    <button
                      key={min}
                      type="button"
                      onClick={() => updateField('longTargetMinutes', min)}
                      className={`py-2 px-2 rounded-lg border text-xs font-medium tabular-nums transition-colors whitespace-nowrap cursor-pointer ${
                        settings.longTargetMinutes === min
                          ? 'border-indigo-500 bg-indigo-500/15 text-indigo-300 font-semibold'
                          : 'border-slate-800 bg-[#0B1120] text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      {min} min
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Enquadramento vertical + Head toggle */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
            <div>
              <span className="block text-xs font-semibold text-slate-300 mb-2">
                Enquadramento vertical (9:16)
              </span>
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#0B1120] border border-slate-800 rounded-xl">
                {(
                  [
                    { value: 'crop', label: 'Preencher' },
                    { value: 'fit', label: 'Ajustado' },
                  ] as Array<{ value: VerticalFraming; label: string }>
                ).map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => updateField('verticalFraming', item.value)}
                    className={`py-1.5 px-2.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      settings.verticalFraming === item.value
                        ? 'bg-slate-800 text-white shadow-xs'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2.5 py-2 px-3 rounded-xl border border-slate-800 bg-[#0B1120] cursor-pointer hover:border-slate-700 transition-colors">
              <input
                type="checkbox"
                checked={settings.showHeadOverlay}
                onChange={(e) => updateField('showHeadOverlay', e.target.checked)}
                className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-indigo-500 focus:ring-indigo-500"
              />
              <span className="text-xs font-medium text-slate-200">
                Mostrar Head no topo do corte
              </span>
            </label>
          </div>

          {/* 5 Caption Presets */}
          <div>
            <span className="block text-xs font-semibold text-slate-300 mb-2">
              Estilo da legenda (5 pré-definições)
            </span>
            <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden bg-[#0B1120]">
              {CAPTION_PRESETS.map((preset) => {
                const active = settings.defaultPreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => updateField('defaultPreset', preset.id as CaptionPresetId)}
                    className={`w-full px-3.5 py-2 text-left flex items-center justify-between gap-4 transition-colors cursor-pointer ${
                      active ? 'bg-indigo-500/15' : 'hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white">
                        {preset.name}
                      </div>
                      <div className="text-[11px] text-slate-400 truncate">
                        {preset.description}
                      </div>
                    </div>
                    <span
                      className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                        active
                          ? 'bg-indigo-600 text-white'
                          : 'border border-slate-700 text-transparent'
                      }`}
                    >
                      <Check className="w-3 h-3" />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
};
