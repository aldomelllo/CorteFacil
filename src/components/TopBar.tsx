import React from 'react';
import { PWAInstallControl } from './PWAInstallButton';

interface TopBarProps {
  activeView: 'upload' | 'studio';
  hasProject: boolean;
  selectedCount: number;
  onNavigateUpload: () => void;
  onNavigateStudio: () => void;
  onOpenBatchModal: () => void;
  onStartDemo: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeView,
  hasProject,
  selectedCount,
  onNavigateUpload,
  onNavigateStudio,
  onOpenBatchModal,
  onStartDemo,
}) => {
  return (
    <header className="sticky top-0 z-30 bg-[#0B1120]/95 backdrop-blur border-b border-slate-800">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single text element wordmark */}
        <button
          type="button"
          onClick={onNavigateUpload}
          className="font-display text-xl font-bold tracking-tight text-white whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 rounded"
        >
          CorteFácil
        </button>

        {/* Zone 2: Concise single-line navigation links */}
        <nav
          aria-label="Navegação principal"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400"
        >
          <button
            type="button"
            onClick={onNavigateUpload}
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
              activeView === 'upload'
                ? 'border-indigo-500 text-white font-semibold'
                : 'border-transparent hover:text-white'
            }`}
          >
            Novo Vídeo
          </button>
          {hasProject && (
            <button
              type="button"
              onClick={onNavigateStudio}
              className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
                activeView === 'studio'
                  ? 'border-indigo-500 text-white font-semibold'
                  : 'border-transparent hover:text-white'
              }`}
            >
              Estúdio de Cortes
            </button>
          )}
          <PWAInstallControl variant="nav" />
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
          {activeView === 'studio' && hasProject ? (
            <button
              type="button"
              onClick={onOpenBatchModal}
              disabled={selectedCount === 0}
              className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums"
            >
              Exportar Lote ({selectedCount})
            </button>
          ) : (
            <button
              type="button"
              onClick={onStartDemo}
              className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Testar Exemplo
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
