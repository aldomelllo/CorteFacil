import React from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Check,
  Plus,
  Trash2,
} from 'lucide-react';
import type {
  CaptionPresetId,
  ClipFormat,
  ClipItem,
  HeadAlignment,
  HeadStyleConfig,
  VerticalFraming,
} from '../types/clip';
import {
  CAPTION_PRESETS,
  clampClipRange,
  formatDurationBadge,
  formatTimecode,
  resolveHeadStyle,
  slugifyHeadForFilename,
} from '../utils/clipLogic';

interface QuickEditPanelProps {
  clip: ClipItem;
  videoDuration: number;
  onUpdateClip: (clipId: string, updater: (prev: ClipItem) => ClipItem) => void;
  onApplyPresetToAll: (preset: CaptionPresetId) => void;
  onApplyHeadStyleToAll: (headStyle: HeadStyleConfig, showHeadOverlay: boolean) => void;
  onSeekTo: (timeSeconds: number) => void;
}

const HEAD_TEXT_COLORS = [
  '#FFFFFF',
  '#FBBF24',
  '#22C55E',
  '#38BDF8',
  '#F43F5E',
];

const HEAD_BG_COLORS = [
  '#090D16',
  '#1E293B',
  '#4F46E5',
  '#DC2626',
  '#000000',
];

export const QuickEditPanel: React.FC<QuickEditPanelProps> = ({
  clip,
  videoDuration,
  onUpdateClip,
  onApplyPresetToAll,
  onApplyHeadStyleToAll,
  onSeekTo,
}) => {
  const filenamePreview = slugifyHeadForFilename(
    clip.head,
    'head_only',
    clip.index,
    clip.format,
    'mp4'
  );

  const headStyle = resolveHeadStyle(clip.headStyle);

  const updateHeadStyle = (patch: Partial<HeadStyleConfig>) => {
    onUpdateClip(clip.id, (prev) => ({
      ...prev,
      headStyle: {
        ...resolveHeadStyle(prev.headStyle),
        ...patch,
      },
    }));
  };

  const nudgeStart = (delta: number) => {
    onUpdateClip(clip.id, (prev) => {
      const next = clampClipRange(
        prev.startTime + delta,
        prev.endTime,
        videoDuration,
        4
      );
      return { ...prev, ...next };
    });
  };

  const nudgeEnd = (delta: number) => {
    onUpdateClip(clip.id, (prev) => {
      const next = clampClipRange(
        prev.startTime,
        prev.endTime + delta,
        videoDuration,
        4
      );
      return { ...prev, ...next };
    });
  };

  const updateCaptionText = (segId: string, newText: string) => {
    onUpdateClip(clip.id, (prev) => ({
      ...prev,
      captions: prev.captions.map((c) =>
        c.id === segId ? { ...c, text: newText } : c
      ),
    }));
  };

  const addCaptionSegment = () => {
    onUpdateClip(clip.id, (prev) => {
      const lastEnd =
        prev.captions.length > 0
          ? prev.captions[prev.captions.length - 1].end
          : prev.startTime;
      const start = Math.min(prev.endTime - 1, Math.max(prev.startTime, lastEnd + 0.1));
      const end = Math.min(prev.endTime, start + 3);
      return {
        ...prev,
        captions: [
          ...prev.captions,
          {
            id: `manual-${Date.now()}`,
            start: Number(start.toFixed(2)),
            end: Number(end.toFixed(2)),
            text: 'Nova frase da legenda',
          },
        ],
      };
    });
  };

  const removeCaptionSegment = (segId: string) => {
    onUpdateClip(clip.id, (prev) => ({
      ...prev,
      captions: prev.captions.filter((c) => c.id !== segId),
    }));
  };

  return (
    <section
      aria-label="Edição rápida do corte"
      className="bg-[#111827] border border-slate-800 rounded-2xl flex flex-col overflow-hidden h-full"
    >
      <div className="p-4 border-b border-slate-800">
        <h2 className="font-display text-sm font-semibold text-white">
          Edição Rápida
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Ajuste a head no topo, o tempo e o estilo ou texto da legenda.
        </p>
      </div>

      <div className="p-4 space-y-5 overflow-y-auto flex-1">
        {/* 1. Head & Nome do Arquivo + Editor da Head no Topo */}
        <div>
          <label
            htmlFor="clip-head-input"
            className="block text-xs font-semibold text-slate-300 mb-1.5"
          >
            Head do vídeo (título viral e nome do arquivo)
          </label>
          <input
            id="clip-head-input"
            type="text"
            value={clip.head}
            onChange={(e) =>
              onUpdateClip(clip.id, (prev) => ({ ...prev, head: e.target.value }))
            }
            placeholder="Ex: O erro invisível que derruba sua retenção"
            className="w-full px-3 py-2 text-sm text-white bg-[#0B1120] border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 placeholder:text-slate-500"
          />

          <div className="mt-2.5 flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={clip.showHeadOverlay}
                onChange={(e) =>
                  onUpdateClip(clip.id, (prev) => ({
                    ...prev,
                    showHeadOverlay: e.target.checked,
                  }))
                }
                className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-indigo-500 focus:ring-indigo-500"
              />
              <span>Mostrar Head no topo do vídeo</span>
            </label>
          </div>

          <div
            data-testid="filename-preview"
            className="mt-2 px-2.5 py-1.5 rounded-lg bg-[#0B1120] border border-slate-800 text-xs font-mono text-indigo-300 truncate"
          >
            Arquivo .MP4: {filenamePreview}
          </div>

          {/* Editor Básico da Head no Topo */}
          {clip.showHeadOverlay && (
            <div
              data-testid="head-style-editor"
              className="mt-3 p-3 rounded-xl border border-slate-800 bg-[#0B1120] space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-200">
                  Estilo da Head no topo
                </span>
                <button
                  type="button"
                  onClick={() => onApplyHeadStyleToAll(headStyle, clip.showHeadOverlay)}
                  className="text-[11px] font-medium text-indigo-400 hover:text-indigo-300 whitespace-nowrap cursor-pointer"
                >
                  Aplicar em todos
                </button>
              </div>

              {/* Alinhamento + Tamanho da Fonte */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                <div>
                  <span className="block text-[11px] text-slate-400 mb-1">
                    Alinhamento
                  </span>
                  <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg bg-[#111827] border border-slate-800">
                    {(
                      [
                        { value: 'left', label: 'Esquerda', Icon: AlignLeft },
                        { value: 'center', label: 'Centro', Icon: AlignCenter },
                        { value: 'right', label: 'Direita', Icon: AlignRight },
                      ] as Array<{
                        value: HeadAlignment;
                        label: string;
                        Icon: React.FC<{ className?: string }>;
                      }>
                    ).map(({ value, label, Icon }) => (
                      <button
                        key={value}
                        type="button"
                        aria-label={`Alinhar Head à ${label}`}
                        onClick={() => updateHeadStyle({ align: value })}
                        className={`py-1.5 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
                          headStyle.align === value
                            ? 'bg-indigo-600 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                    <span>Tamanho da fonte</span>
                    <span className="font-mono text-slate-200 tabular-nums">
                      {headStyle.fontSize}px
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-label="Diminuir fonte da Head"
                      onClick={() =>
                        updateHeadStyle({ fontSize: Math.max(16, headStyle.fontSize - 2) })
                      }
                      className="px-2 py-1 rounded border border-slate-700 bg-slate-800 text-xs font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer"
                    >
                      A-
                    </button>
                    <input
                      type="range"
                      aria-label="Tamanho da fonte da Head"
                      min={16}
                      max={38}
                      step={1}
                      value={headStyle.fontSize}
                      onChange={(e) =>
                        updateHeadStyle({ fontSize: Number(e.target.value) })
                      }
                      className="flex-1 accent-indigo-500 cursor-pointer h-1.5"
                    />
                    <button
                      type="button"
                      aria-label="Aumentar fonte da Head"
                      onClick={() =>
                        updateHeadStyle({ fontSize: Math.min(38, headStyle.fontSize + 2) })
                      }
                      className="px-2 py-1 rounded border border-slate-700 bg-slate-800 text-xs font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer"
                    >
                      A+
                    </button>
                  </div>
                </div>
              </div>

              {/* Cor do texto da Head */}
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-slate-400">Cor da letra</span>
                <div className="flex items-center gap-1.5">
                  {HEAD_TEXT_COLORS.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      aria-label={`Cor do texto ${hex}`}
                      onClick={() => updateHeadStyle({ textColor: hex })}
                      className={`w-5 h-5 rounded-full border transition-transform cursor-pointer ${
                        headStyle.textColor.toUpperCase() === hex
                          ? 'border-indigo-400 scale-110 ring-2 ring-indigo-500/40'
                          : 'border-slate-600'
                      }`}
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                  <input
                    type="color"
                    aria-label="Escolher cor personalizada da Head"
                    value={headStyle.textColor}
                    onChange={(e) => updateHeadStyle({ textColor: e.target.value })}
                    className="w-6 h-5 rounded border border-slate-700 bg-transparent cursor-pointer p-0"
                  />
                </div>
              </div>

              {/* Fundo atrás da Head (ativar/retirar + cor) */}
              <div className="pt-2 border-t border-slate-800/80 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={headStyle.hasBackground}
                      onChange={(e) =>
                        updateHeadStyle({ hasBackground: e.target.checked })
                      }
                      className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-indigo-500 focus:ring-indigo-500"
                    />
                    <span>Fundo atrás da Head</span>
                  </label>

                  {!headStyle.hasBackground && (
                    <span className="text-[11px] text-slate-400">Sem fundo (transparente)</span>
                  )}
                </div>

                {headStyle.hasBackground && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] text-slate-400">Cor do fundo</span>
                    <div className="flex items-center gap-1.5">
                      {HEAD_BG_COLORS.map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          aria-label={`Cor de fundo ${hex}`}
                          onClick={() => updateHeadStyle({ backgroundColor: hex })}
                          className={`w-5 h-5 rounded-full border transition-transform cursor-pointer ${
                            headStyle.backgroundColor.toUpperCase() === hex
                              ? 'border-indigo-400 scale-110 ring-2 ring-indigo-500/40'
                              : 'border-slate-600'
                          }`}
                          style={{ backgroundColor: hex }}
                        />
                      ))}
                      <input
                        type="color"
                        aria-label="Cor personalizada de fundo da Head"
                        value={headStyle.backgroundColor}
                        onChange={(e) =>
                          updateHeadStyle({ backgroundColor: e.target.value })
                        }
                        className="w-6 h-5 rounded border border-slate-700 bg-transparent cursor-pointer p-0"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 2. Formato e Ajuste Rápido de Tempo */}
        <div className="pt-4 border-t border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-300">
              Formato e tempo do corte
            </span>
            <span className="text-xs font-mono text-slate-400 tabular-nums">
              Duração: {formatDurationBadge(clip.endTime - clip.startTime)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#0B1120] border border-slate-800 rounded-lg mb-3">
            {(
              [
                { value: 'vertical', label: 'Vertical 9:16' },
                { value: 'horizontal', label: 'Horizontal 16:9' },
              ] as Array<{ value: ClipFormat; label: string }>
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() =>
                  onUpdateClip(clip.id, (prev) => ({ ...prev, format: opt.value }))
                }
                className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  clip.format === opt.value
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {clip.format === 'vertical' && (
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#0B1120] border border-slate-800 rounded-lg mb-3">
              {(
                [
                  { value: 'crop', label: 'Enquadrar Centro' },
                  { value: 'fit', label: 'Ajustado c/ Fundo' },
                ] as Array<{ value: VerticalFraming; label: string }>
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    onUpdateClip(clip.id, (prev) => ({
                      ...prev,
                      verticalFraming: opt.value,
                    }))
                  }
                  className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    clip.verticalFraming === opt.value
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="p-2.5 rounded-lg border border-slate-800 bg-[#0B1120]">
              <div className="text-[11px] font-medium text-slate-400 mb-1">Início</div>
              <div className="flex items-center justify-between gap-1">
                <button
                  type="button"
                  aria-label="Recuar início em 1 segundo"
                  onClick={() => nudgeStart(-1)}
                  className="px-2 py-1 rounded border border-slate-700 bg-slate-800 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer"
                >
                  -1s
                </button>
                <span className="text-xs font-mono font-semibold text-white tabular-nums">
                  {formatTimecode(clip.startTime)}
                </span>
                <button
                  type="button"
                  aria-label="Avançar início em 1 segundo"
                  onClick={() => nudgeStart(1)}
                  className="px-2 py-1 rounded border border-slate-700 bg-slate-800 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer"
                >
                  +1s
                </button>
              </div>
            </div>

            <div className="p-2.5 rounded-lg border border-slate-800 bg-[#0B1120]">
              <div className="text-[11px] font-medium text-slate-400 mb-1">Fim</div>
              <div className="flex items-center justify-between gap-1">
                <button
                  type="button"
                  aria-label="Recuar fim em 1 segundo"
                  onClick={() => nudgeEnd(-1)}
                  className="px-2 py-1 rounded border border-slate-700 bg-slate-800 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer"
                >
                  -1s
                </button>
                <span className="text-xs font-mono font-semibold text-white tabular-nums">
                  {formatTimecode(clip.endTime)}
                </span>
                <button
                  type="button"
                  aria-label="Avançar fim em 1 segundo"
                  onClick={() => nudgeEnd(1)}
                  className="px-2 py-1 rounded border border-slate-700 bg-slate-800 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer"
                >
                  +1s
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Estilo da Legenda (5 Pré-definições) */}
        <div className="pt-4 border-t border-slate-800">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-semibold text-slate-300">
              Legenda (5 pré-definições)
            </span>
            <button
              type="button"
              onClick={() => onApplyPresetToAll(clip.captionPreset)}
              className="text-xs font-medium text-indigo-400 hover:text-indigo-300 whitespace-nowrap cursor-pointer"
            >
              Aplicar em todos
            </button>
          </div>

          <div className="grid grid-cols-1 gap-1.5">
            {CAPTION_PRESETS.map((preset) => {
              const active = clip.captionPreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() =>
                    onUpdateClip(clip.id, (prev) => ({
                      ...prev,
                      captionPreset: preset.id,
                    }))
                  }
                  className={`px-3 py-2 rounded-lg border text-left flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                    active
                      ? 'border-indigo-500 bg-indigo-500/15'
                      : 'border-slate-800 bg-[#0B1120] hover:border-slate-700'
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
                    className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                      active
                        ? 'bg-indigo-600 text-white'
                        : 'border border-slate-700 text-transparent'
                    }`}
                  >
                    <Check className="w-2.5 h-2.5" />
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 4. Edição rápida do texto das legendas */}
        <div className="pt-4 border-t border-slate-800">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-semibold text-slate-300">
              Texto das legendas ({clip.captions.length})
            </span>
            <button
              type="button"
              onClick={addCaptionSegment}
              className="text-[11px] font-medium text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3 h-3" />
              <span>Adicionar</span>
            </button>
          </div>

          {clip.captions.length === 0 ? (
            <p className="text-xs text-slate-400 py-2">
              Nenhuma legenda automática neste corte. Clique em "+ Adicionar" ou use o modo IA Viral para transcrição fiel da fala.
            </p>
          ) : (
            <div className="space-y-2">
              {clip.captions.map((seg) => (
                <div key={seg.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onSeekTo(seg.start)}
                    title="Ir para este momento"
                    className="px-1.5 py-1 rounded bg-slate-800 hover:bg-indigo-600 text-[11px] font-mono text-slate-200 tabular-nums shrink-0 cursor-pointer"
                  >
                    {formatTimecode(seg.start)}
                  </button>
                  <input
                    type="text"
                    value={seg.text}
                    onChange={(e) => updateCaptionText(seg.id, e.target.value)}
                    aria-label={`Legenda em ${formatTimecode(seg.start)}`}
                    className="flex-1 min-w-0 px-2.5 py-1.5 text-xs text-white bg-[#0B1120] border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    aria-label={`Remover legenda em ${formatTimecode(seg.start)}`}
                    onClick={() => removeCaptionSegment(seg.id)}
                    className="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-slate-800 shrink-0 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
