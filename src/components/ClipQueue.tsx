import React from 'react';
import type { ClipFormat, ClipItem } from '../types/clip';
import { formatDurationBadge, formatTimecode } from '../utils/clipLogic';

export type ClipFilterTab = 'all' | ClipFormat;

interface ClipQueueProps {
  clips: ClipItem[];
  activeClipId: string | null;
  filterTab: ClipFilterTab;
  onChangeFilter: (tab: ClipFilterTab) => void;
  onSelectClip: (clipId: string) => void;
  onToggleBatchCheck: (clipId: string) => void;
  onSelectAllVisible: (select: boolean) => void;
}

export const ClipQueue: React.FC<ClipQueueProps> = ({
  clips,
  activeClipId,
  filterTab,
  onChangeFilter,
  onSelectClip,
  onToggleBatchCheck,
  onSelectAllVisible,
}) => {
  const verticalCount = clips.filter((c) => c.format === 'vertical').length;
  const horizontalCount = clips.filter((c) => c.format === 'horizontal').length;

  const visibleClips = clips.filter((c) => {
    if (filterTab === 'all') return true;
    return c.format === filterTab;
  });

  const allVisibleSelected =
    visibleClips.length > 0 && visibleClips.every((c) => c.selected);

  return (
    <aside
      aria-label="Cortes gerados"
      className="bg-[#111827] border border-slate-800 rounded-2xl flex flex-col overflow-hidden h-full"
    >
      <div className="p-4 border-b border-slate-800">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="font-display text-sm font-semibold text-white">
            Cortes Sugeridos ({clips.length})
          </h2>
          <button
            type="button"
            onClick={() => onSelectAllVisible(!allVisibleSelected)}
            className="text-xs font-medium text-indigo-400 hover:text-indigo-300 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {allVisibleSelected ? 'Desmarcar visíveis' : 'Selecionar visíveis'}
          </button>
        </div>

        {/* Filter segmented tabs */}
        <div className="grid grid-cols-3 gap-1 p-1 bg-[#0B1120] border border-slate-800 rounded-lg">
          <button
            type="button"
            onClick={() => onChangeFilter('all')}
            className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer tabular-nums ${
              filterTab === 'all'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Todos ({clips.length})
          </button>
          <button
            type="button"
            onClick={() => onChangeFilter('vertical')}
            className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer tabular-nums ${
              filterTab === 'vertical'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            9:16 ({verticalCount})
          </button>
          <button
            type="button"
            onClick={() => onChangeFilter('horizontal')}
            className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer tabular-nums ${
              filterTab === 'horizontal'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            16:9 ({horizontalCount})
          </button>
        </div>
      </div>

      <div className="divide-y divide-slate-800/80 overflow-y-auto flex-1">
        {visibleClips.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-400">
            Nenhum corte neste filtro.
          </div>
        ) : (
          visibleClips.map((clip) => {
            const isActive = clip.id === activeClipId;
            const duration = Math.max(1, clip.endTime - clip.startTime);
            return (
              <div
                key={clip.id}
                className={`p-3.5 transition-colors flex items-start gap-3 ${
                  isActive ? 'bg-indigo-500/15' : 'hover:bg-slate-800/40'
                }`}
              >
                <input
                  type="checkbox"
                  checked={clip.selected}
                  onChange={() => onToggleBatchCheck(clip.id)}
                  aria-label={`Selecionar corte "${clip.head}" para lote`}
                  className="mt-1 w-4 h-4 rounded border-slate-600 bg-slate-900 text-indigo-500 focus:ring-indigo-500 cursor-pointer shrink-0"
                />

                <button
                  type="button"
                  onClick={() => onSelectClip(clip.id)}
                  className="text-left flex-1 min-w-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-indigo-500 rounded"
                >
                  <div className="text-sm font-semibold text-white leading-snug line-clamp-2">
                    {clip.head || `Corte ${clip.index}`}
                  </div>

                  <div className="mt-1 flex items-center flex-wrap gap-x-1.5 gap-y-0.5 text-xs text-slate-400 tabular-nums">
                    <span className="font-medium text-slate-200">
                      {clip.format === 'vertical' ? 'Vertical 9:16' : 'Horizontal 16:9'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{formatDurationBadge(duration)}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">
                      {formatTimecode(clip.startTime)}–{formatTimecode(clip.endTime)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>Relevância {clip.score}%</span>
                  </div>

                  <p className="mt-1 text-xs text-slate-400 line-clamp-1">
                    {clip.reason}
                  </p>
                </button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
