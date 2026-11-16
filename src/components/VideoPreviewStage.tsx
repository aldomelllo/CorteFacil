import React, { useEffect, useRef, useState } from 'react';
import { Download, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import type { ClipItem } from '../types/clip';
import {
  formatTimecode,
  getActiveCaptionAtTime,
  getActiveWordIndex,
  getCaptionPreset,
  resolveHeadStyle,
} from '../utils/clipLogic';

interface VideoPreviewStageProps {
  mediaUrl: string;
  clip: ClipItem;
  seekRequestTime: number | null;
  onClearSeekRequest: () => void;
  onExportSingleClip: (clip: ClipItem) => void;
}

export const VideoPreviewStage: React.FC<VideoPreviewStageProps> = ({
  mediaUrl,
  clip,
  seekRequestTime,
  onClearSeekRequest,
  onExportSingleClip,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(clip.startTime);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.currentTime < clip.startTime || video.currentTime > clip.endTime) {
      video.currentTime = clip.startTime;
      setCurrentTime(clip.startTime);
    }
  }, [clip.id, clip.startTime, clip.endTime]);

  useEffect(() => {
    if (seekRequestTime === null) return;
    const video = videoRef.current;
    if (video) {
      video.currentTime = seekRequestTime;
      setCurrentTime(seekRequestTime);
    }
    onClearSeekRequest();
  }, [seekRequestTime, onClearSeekRequest]);

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    const t = video.currentTime;
    if (t >= clip.endTime) {
      video.currentTime = clip.startTime;
      setCurrentTime(clip.startTime);
    } else {
      setCurrentTime(t);
    }
  };

  const togglePlay = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (video.currentTime < clip.startTime || video.currentTime >= clip.endTime) {
        video.currentTime = clip.startTime;
      }
      await video.play().catch(() => {});
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  };

  const clipDuration = Math.max(1, clip.endTime - clip.startTime);
  const relativeElapsed = Math.max(
    0,
    Math.min(clipDuration, currentTime - clip.startTime)
  );
  const progressPct = (relativeElapsed / clipDuration) * 100;

  const preset = getCaptionPreset(clip.captionPreset);
  const headStyle = resolveHeadStyle(clip.headStyle);
  const exactCaption = getActiveCaptionAtTime(clip.captions, currentTime);
  const activeCaption =
    exactCaption ??
    (!isPlaying &&
    clip.captions.length > 0 &&
    Math.abs(currentTime - clip.startTime) <= 0.35 &&
    clip.captions[0].start - clip.startTime <= 3.0
      ? clip.captions[0]
      : null);
  const activeWordIdx = activeCaption
    ? getActiveWordIndex(activeCaption, exactCaption ? currentTime : activeCaption.start + 0.3)
    : 0;

  const isVertical = clip.format === 'vertical';
  const headPreviewFontPx = Math.round(headStyle.fontSize * (isVertical ? 0.56 : 0.68));
  const headFlexAlign =
    headStyle.align === 'left'
      ? 'justify-start'
      : headStyle.align === 'right'
      ? 'justify-end'
      : 'justify-center';
  const headTextAlign =
    headStyle.align === 'left'
      ? 'text-left'
      : headStyle.align === 'right'
      ? 'text-right'
      : 'text-center';

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    const targetTime = clip.startTime + (val / 100) * clipDuration;
    if (videoRef.current) {
      videoRef.current.currentTime = targetTime;
    }
    setCurrentTime(targetTime);
  };

  return (
    <section
      aria-label="Pré-visualização do corte"
      className="bg-[#111827] border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col items-center justify-between h-full"
    >
      {/* Top bar info */}
      <div className="w-full flex items-center justify-between gap-4 mb-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-400">
            Prévia ao vivo · {isVertical ? 'Formato Vertical 9:16' : 'Formato Horizontal 16:9'}
          </div>
          <h3 className="font-display text-sm font-semibold text-white truncate">
            {clip.head}
          </h3>
        </div>
        <button
          type="button"
          onClick={() => onExportSingleClip(clip)}
          className="px-3.5 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-500 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Baixar Vídeo</span>
        </button>
      </div>

      {/* Video Frame */}
      <div className="w-full flex-1 flex items-center justify-center py-2">
        <div
          data-testid="video-preview-stage"
          data-preset={clip.captionPreset}
          data-format={clip.format}
          className={`relative bg-[#05070C] rounded-xl overflow-hidden border border-slate-800 flex items-center justify-center ${
            isVertical
              ? 'w-full max-w-[300px] aspect-[9/16]'
              : 'w-full max-w-[640px] aspect-video'
          }`}
        >
          <video
            ref={videoRef}
            src={mediaUrl}
            preload="auto"
            playsInline
            onLoadedMetadata={() => {
              const video = videoRef.current;
              if (video) {
                video.currentTime = clip.startTime;
                setCurrentTime(clip.startTime);
              }
            }}
            onTimeUpdate={handleTimeUpdate}
            onEnded={() => setIsPlaying(false)}
            onClick={togglePlay}
            className={`w-full h-full cursor-pointer ${
              isVertical
                ? clip.verticalFraming === 'fit'
                  ? 'object-contain'
                  : 'object-cover'
                : 'object-contain'
            }`}
          />

          {/* Top Head Overlay (personalizável em alinhamento, fonte, cor e fundo) */}
          {clip.showHeadOverlay && clip.head.trim() && (
            <div
              data-testid="live-head-overlay"
              className={`pointer-events-none z-20 absolute top-4 inset-x-4 flex ${headFlexAlign}`}
            >
              <div
                className={`font-display font-bold leading-snug max-w-[92%] ${headTextAlign} ${
                  headStyle.hasBackground
                    ? 'px-3 py-1.5 rounded-lg border border-white/15 shadow-sm'
                    : 'px-1 py-0.5'
                }`}
                style={{
                  fontSize: `${headPreviewFontPx}px`,
                  color: headStyle.textColor,
                  backgroundColor: headStyle.hasBackground
                    ? `${headStyle.backgroundColor}E6`
                    : 'transparent',
                  textShadow: headStyle.hasBackground
                    ? 'none'
                    : '0 2px 6px rgba(0,0,0,0.95), 0 0 3px rgba(0,0,0,0.95)',
                }}
              >
                {clip.head}
              </div>
            </div>
          )}

          {/* Live Dynamic Caption Overlay */}
          {activeCaption && (
            <div
              data-testid="live-caption-overlay"
              className={`pointer-events-none z-20 absolute inset-x-4 flex justify-center ${
                preset.position === 'lower-center'
                  ? isVertical
                    ? 'bottom-14'
                    : 'bottom-10'
                  : 'bottom-5'
              }`}
            >
              <div
                className={`text-center leading-tight max-w-[92%] ${
                  preset.hasBox ? 'px-3 py-1.5 rounded-md' : 'px-1'
                }`}
                style={{
                  backgroundColor: preset.hasBox ? preset.backgroundColor : 'transparent',
                  fontFamily: preset.fontFamily,
                }}
              >
                {(() => {
                  const text = preset.uppercase
                    ? activeCaption.text.toUpperCase()
                    : activeCaption.text;
                  const words = text.split(/\s+/).filter(Boolean);
                  const isKaraoke = preset.id === 'destaque' || preset.id === 'impacto';
                  const sizeClass = isVertical
                    ? preset.id === 'impacto'
                      ? 'text-lg font-extrabold'
                      : preset.id === 'minimalista'
                      ? 'text-sm font-medium'
                      : 'text-base font-bold'
                    : preset.id === 'impacto'
                    ? 'text-xl font-extrabold'
                    : preset.id === 'minimalista'
                    ? 'text-sm font-medium'
                    : 'text-lg font-bold';

                  return (
                    <span
                      className={sizeClass}
                      style={{
                        textShadow: preset.hasBox
                          ? 'none'
                          : '0 2px 6px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,0.95)',
                      }}
                    >
                      {words.map((word, wIdx) => {
                        const isWordHighlighted = isKaraoke && wIdx <= activeWordIdx;
                        return (
                          <span
                            key={`${activeCaption.id}-${wIdx}`}
                            style={{
                              color: isWordHighlighted
                                ? preset.highlightColor
                                : preset.primaryColor,
                            }}
                          >
                            {word}
                            {wIdx < words.length - 1 ? ' ' : ''}
                          </span>
                        );
                      })}
                    </span>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Player Controls */}
      <div className="w-full mt-3 pt-3 border-t border-slate-800 flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={isPlaying ? 'Pausar prévia' : 'Reproduzir prévia'}
          className="w-9 h-9 rounded-lg bg-[#0B1120] border border-slate-800 hover:bg-slate-800 text-white flex items-center justify-center transition-colors shrink-0 cursor-pointer"
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>

        <span className="text-xs font-mono text-slate-300 tabular-nums shrink-0">
          {formatTimecode(relativeElapsed)} / {formatTimecode(clipDuration)}
        </span>

        <input
          type="range"
          min={0}
          max={100}
          step={0.5}
          value={progressPct}
          onChange={handleScrub}
          aria-label="Linha do tempo do corte"
          className="flex-1 accent-indigo-500 cursor-pointer h-1.5"
        />

        <button
          type="button"
          onClick={toggleMute}
          aria-label={isMuted ? 'Ativar som' : 'Silenciar som'}
          className="w-9 h-9 rounded-lg bg-[#0B1120] border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-white flex items-center justify-center transition-colors shrink-0 cursor-pointer"
        >
          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      </div>
    </section>
  );
};
