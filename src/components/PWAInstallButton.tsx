import React, { useState } from 'react';
import { MonitorDown, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

interface DesktopInstallControlProps {
  variant?: 'nav' | 'banner';
}

export const PWAInstallControl: React.FC<DesktopInstallControlProps> = ({
  variant = 'nav',
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      const ok = await install();
      if (!ok) setShowGuide(true);
    } else {
      setShowGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={
          variant === 'nav'
            ? 'whitespace-nowrap shrink-0 py-1 border-b-2 border-transparent text-slate-300 hover:text-white transition-colors cursor-pointer inline-flex items-center gap-1.5'
            : 'px-3.5 py-2 rounded-lg border border-slate-700 bg-slate-800/70 hover:bg-slate-800 text-xs font-medium text-slate-200 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer'
        }
      >
        <MonitorDown className="w-3.5 h-3.5 text-indigo-400" />
        <span>{isInstallable ? 'Instalar no PC' : 'App Desktop'}</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="desktop-install-title"
        >
          <div className="bg-[#111827] border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl text-slate-100">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2
                  id="desktop-install-title"
                  className="font-display text-lg font-bold text-white"
                >
                  Rodar CorteFácil no seu computador
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  O processamento dos vídeos e legendas já roda direto na sua máquina.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Fechar guia de instalação"
                className="w-8 h-8 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-sm text-slate-300">
              {isIOS ? (
                <div className="p-4 rounded-xl bg-[#0B1120] border border-slate-800">
                  <div className="font-semibold text-white mb-1">
                    Instalar no iPhone / iPad
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    1. Toque no botão <strong className="text-slate-200">Compartilhar</strong> do Safari.
                    <br />
                    2. Escolha <strong className="text-slate-200">Adicionar à Tela de Início</strong>.
                  </p>
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-[#0B1120] border border-slate-800">
                  <div className="font-semibold text-white mb-1">
                    Opção 1: Instalar como aplicativo nativo (Chrome / Edge)
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Abra o menu do navegador (<strong className="text-slate-200">⋮</strong>) ou o ícone na barra de endereço e clique em{' '}
                    <strong className="text-slate-200">Instalar CorteFácil</strong> (ou{' '}
                    <strong className="text-slate-200">Salvar e compartilhar → Instalar página como app</strong>). Ele abre em janela própria, sem barra do navegador, e funciona offline no modo local.
                  </p>
                </div>
              )}

              <div className="p-4 rounded-xl bg-[#0B1120] border border-slate-800">
                <div className="font-semibold text-white mb-1">
                  Opção 2: Rodar localmente via Node.js na sua máquina
                </div>
                <p className="text-xs text-slate-400 leading-relaxed mb-2">
                  Baixe o projeto e execute localmente em <code className="text-indigo-300 font-mono">localhost:3000</code> usando 100% do seu processador:
                </p>
                <pre className="p-2.5 rounded-lg bg-[#05070C] border border-slate-800 text-xs font-mono text-indigo-300 overflow-x-auto">
                  npm install &amp;&amp; npm run dev
                </pre>
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white cursor-pointer"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-600/95 border border-amber-400/30 px-3 py-1.5 text-xs font-medium text-white shadow-lg">
      <span>Modo Offline Ativo — Processamento local na sua máquina</span>
    </div>
  );
};
