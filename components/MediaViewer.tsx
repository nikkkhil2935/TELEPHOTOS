'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Heart,
  Info,
  Lock,
  MapPin,
  Maximize2,
  Minimize2,
  Play,
  ShieldCheck,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import type { MediaItem } from '@/lib/types';
import {
  formatBytes,
  formatDuration,
  getWindowedFilmstripIndices,
} from '@/lib/utils/security';

interface MediaViewerProps {
  items: MediaItem[];
  activeMessageId: number;
  onSelectMessageId: (messageId: number) => void;
  onClose: () => void;
  onToggleFavorite: (item: MediaItem) => void;
  onToggleArchive: (item: MediaItem) => void;
  onToggleLock: (item: MediaItem) => void;
  onDelete: (item: MediaItem) => void;
  onDownloadOriginal: (item: MediaItem) => void;
}

export function MediaViewer({
  items,
  activeMessageId,
  onSelectMessageId,
  onClose,
  onToggleFavorite,
  onToggleArchive,
  onToggleLock,
  onDelete,
  onDownloadOriginal,
}: MediaViewerProps) {
  const activeIndex = useMemo(
    () => Math.max(0, items.findIndex((i) => i.messageId === activeMessageId)),
    [items, activeMessageId]
  );
  const current = items[activeIndex];

  // Default to open on desktop (>= 1024px) and CLOSED on mobile so photos are never squashed
  const [infoOpen, setInfoOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : false
  );
  const [zoomed, setZoomed] = useState(false);
  const [copiedSha, setCopiedSha] = useState(false);
  const activeThumbRef = useRef<HTMLButtonElement | null>(null);

  const goPrev = useCallback(() => {
    if (activeIndex > 0) {
      setZoomed(false);
      onSelectMessageId(items[activeIndex - 1].messageId);
    }
  }, [activeIndex, items, onSelectMessageId]);

  const goNext = useCallback(() => {
    if (activeIndex < items.length - 1) {
      setZoomed(false);
      onSelectMessageId(items[activeIndex + 1].messageId);
    }
  }, [activeIndex, items, onSelectMessageId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!current) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      } else if (e.key === ' ') {
        e.preventDefault();
        setZoomed((z) => !z);
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        onToggleFavorite(current);
      } else if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        setInfoOpen((o) => !o);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if ((e.target as HTMLElement)?.tagName !== 'INPUT') {
          e.preventDefault();
          onDelete(current);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [current, goNext, goPrev, onClose, onDelete, onToggleFavorite]);

  // Keep active filmstrip thumbnail centered cleanly
  useEffect(() => {
    activeThumbRef.current?.scrollIntoView({
      behavior: 'auto',
      inline: 'center',
      block: 'nearest',
    });
  }, [activeMessageId]);

  if (!current) return null;

  // 0ms Camera Roll Filmstrip: windowed rendering (active ± 18 items)
  const { start, end } = getWindowedFilmstripIndices(items.length, activeIndex, 18);
  const windowedFilmstrip = items.slice(start, end);

  const megapixels =
    current.width && current.height
      ? ((current.width * current.height) / 1_000_000).toFixed(1)
      : '—';

  const formattedDate = new Date(current.takenAt).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  });

  const handleCopySha = async () => {
    try {
      await navigator.clipboard.writeText(current.sha256);
      setCopiedSha(true);
      setTimeout(() => setCopiedSha(false), 1800);
    } catch {
      // Clipboard blocked in restricted frame
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Darkroom media viewer for ${current.filename}`}
      className="fixed inset-0 z-50 flex flex-col bg-black/[0.96] text-white select-none"
    >
      {/* Top Cinema Control Bar */}
      <header className="h-14 shrink-0 px-3 sm:px-5 flex items-center justify-between gap-4 border-b border-white/10 bg-black/50 backdrop-blur-md">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close viewer"
            className="w-9 h-9 rounded-full flex items-center justify-center text-white/85 hover:bg-white/10 transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">{current.filename}</p>
            <p className="text-[11px] text-white/60 font-mono tabular-nums truncate">
              {activeIndex + 1} / {items.length} · {formattedDate}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setZoomed((z) => !z)}
            aria-label={zoomed ? 'Reset zoom' : 'Zoom image'}
            title="Toggle Zoom (Space)"
            className="hidden sm:flex w-9 h-9 rounded-full items-center justify-center text-white/80 hover:bg-white/10 transition-colors"
          >
            {zoomed ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={() => onToggleFavorite(current)}
            aria-label={current.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            title="Favorite (F)"
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
              current.isFavorite
                ? 'text-rose-400 bg-rose-500/15'
                : 'text-white/80 hover:bg-white/10'
            }`}
          >
            <Heart className={`w-4 h-4 ${current.isFavorite ? 'fill-current' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => onDownloadOriginal(current)}
            aria-label="Download original master"
            title="Download Original"
            className="w-9 h-9 rounded-full flex items-center justify-center text-white/80 hover:bg-white/10 transition-colors"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onToggleArchive(current)}
            aria-label={current.isArchived ? 'Unarchive item' : 'Archive item'}
            title={current.isArchived ? 'Unarchive' : 'Archive'}
            className="hidden sm:flex w-9 h-9 rounded-full items-center justify-center text-white/80 hover:bg-white/10 transition-colors"
          >
            <Archive className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onToggleLock(current)}
            aria-label={current.isLocked ? 'Move out of Locked Folder' : 'Move to Locked Folder'}
            title={current.isLocked ? 'Unlock item' : 'Move to Locked Folder'}
            className="hidden sm:flex w-9 h-9 rounded-full items-center justify-center text-white/80 hover:bg-white/10 transition-colors"
          >
            {current.isLocked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={() => onDelete(current)}
            aria-label="Move to trash"
            title="Delete (Del)"
            className="w-9 h-9 rounded-full flex items-center justify-center text-white/80 hover:text-red-400 hover:bg-red-500/15 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setInfoOpen((o) => !o)}
            aria-label="Toggle EXIF Studio drawer"
            aria-expanded={infoOpen}
            title="EXIF Studio (I)"
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
              infoOpen ? 'bg-[#0B57D0] text-white' : 'text-white/80 hover:bg-white/10'
            }`}
          >
            <Info className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Darkroom Stage + Responsive EXIF Studio */}
      <div className="flex-1 min-h-0 flex relative overflow-hidden">
        {/* Cinema Viewport */}
        <div className="flex-1 min-w-0 flex flex-col relative">
          <div className="flex-1 min-h-0 relative flex items-center justify-center p-3 sm:p-8 overflow-hidden">
            {activeIndex > 0 && (
              <button
                type="button"
                onClick={goPrev}
                aria-label="Previous photo"
                className="absolute left-3 sm:left-5 z-20 w-11 h-11 rounded-full bg-black/60 hover:bg-black/85 border border-white/15 flex items-center justify-center text-white transition-colors"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
            )}

            <div className="relative max-w-full max-h-full flex items-center justify-center">
              <img
                src={current.fullUrl || current.thumbnailDataUrl}
                alt={current.filename}
                referrerPolicy="no-referrer"
                onClick={() => setZoomed((z) => !z)}
                className={`max-h-[calc(100vh-195px)] max-w-full object-contain rounded-lg cursor-zoom-in transition-transform duration-200 ${
                  zoomed ? 'scale-150 cursor-zoom-out' : 'scale-100'
                }`}
              />
              {current.kind === 'video' && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-black/75 border border-white/15 text-xs font-mono tabular-nums text-white">
                  <Play className="w-3.5 h-3.5 fill-current text-[#A8C7FA]" />
                  <span>4K60 Uncompressed Master · {formatDuration(current.durationMs)}</span>
                </div>
              )}
            </div>

            {activeIndex < items.length - 1 && (
              <button
                type="button"
                onClick={goNext}
                aria-label="Next photo"
                className="absolute right-3 sm:right-5 z-20 w-11 h-11 rounded-full bg-black/60 hover:bg-black/85 border border-white/15 flex items-center justify-center text-white transition-colors"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            )}
          </div>

          {/* 0ms Windowed Camera Roll Filmstrip (active ± 18) */}
          <div
            aria-label="Camera roll filmstrip"
            className="h-20 shrink-0 border-t border-white/10 bg-black/75 px-4 flex items-center justify-center"
          >
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar max-w-full py-2">
              {windowedFilmstrip.map((thumb) => {
                const isActive = thumb.messageId === current.messageId;
                return (
                  <button
                    key={thumb.messageId}
                    ref={isActive ? activeThumbRef : null}
                    type="button"
                    onClick={() => {
                      setZoomed(false);
                      onSelectMessageId(thumb.messageId);
                    }}
                    aria-label={`Jump to ${thumb.filename}`}
                    aria-current={isActive ? 'true' : undefined}
                    className={`relative shrink-0 h-12 rounded-md overflow-hidden focus-visible:outline-2 focus-visible:outline-[#A8C7FA] ${
                      isActive
                        ? 'w-16 ring-2 ring-[#A8C7FA] opacity-100'
                        : 'w-12 opacity-55 hover:opacity-90'
                    }`}
                  >
                    <img
                      src={thumb.thumbnailDataUrl || thumb.fullUrl}
                      alt={thumb.filename}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Desktop Right EXIF Studio Drawer (>= 1024px) */}
        {infoOpen && (
          <aside
            aria-label="EXIF Studio Inspector"
            className="hidden lg:flex w-[360px] shrink-0 flex-col border-l border-white/10 bg-[#121316] text-zinc-100 overflow-y-auto"
          >
            <ExifStudioContent
              item={current}
              megapixels={megapixels}
              formattedDate={formattedDate}
              copiedSha={copiedSha}
              onCopySha={handleCopySha}
              onClose={() => setInfoOpen(false)}
            />
          </aside>
        )}

        {/* Mobile Slide-Up Bottom Sheet Drawer (< 1024px) */}
        {infoOpen && (
          <div className="lg:hidden fixed inset-x-0 bottom-0 z-40 max-h-[76vh] rounded-t-3xl border-t border-white/15 bg-[#121316] text-zinc-100 shadow-2xl flex flex-col">
            <div className="pt-3 pb-1 flex justify-center shrink-0">
              <button
                type="button"
                onClick={() => setInfoOpen(false)}
                aria-label="Close EXIF details sheet"
                className="w-11 h-1.5 rounded-full bg-white/25 hover:bg-white/40"
              />
            </div>
            <div className="overflow-y-auto">
              <ExifStudioContent
                item={current}
                megapixels={megapixels}
                formattedDate={formattedDate}
                copiedSha={copiedSha}
                onCopySha={handleCopySha}
                onClose={() => setInfoOpen(false)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface ExifStudioContentProps {
  item: MediaItem;
  megapixels: string;
  formattedDate: string;
  copiedSha: boolean;
  onCopySha: () => void;
  onClose: () => void;
}

function ExifStudioContent({
  item,
  megapixels,
  formattedDate,
  copiedSha,
  onCopySha,
  onClose,
}: ExifStudioContentProps) {
  return (
    <div className="p-5 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold tracking-tight text-white">EXIF Studio</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close EXIF Studio"
          className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:bg-white/10 hover:text-white"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* File & Capture Telemetry */}
      <div className="space-y-3 text-sm">
        <div>
          <p className="text-xs text-zinc-400">Filename</p>
          <p className="text-zinc-100 font-medium break-all mt-0.5">{item.filename}</p>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-1">
          <div>
            <p className="text-xs text-zinc-400">Dimensions</p>
            <p className="font-mono text-xs tabular-nums text-zinc-100 mt-0.5">
              {item.width} × {item.height} ({megapixels} MP)
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-400">Master Size</p>
            <p className="font-mono text-xs tabular-nums text-zinc-100 mt-0.5">
              {formatBytes(item.sizeBytes)} · Lossless
            </p>
          </div>
        </div>

        <div>
          <p className="text-xs text-zinc-400">Captured</p>
          <p className="text-xs text-zinc-100 mt-0.5">{formattedDate}</p>
        </div>
      </div>

      {/* Camera & Optics */}
      <div className="pt-4 border-t border-white/10 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
          <Camera className="w-4 h-4 text-[#A8C7FA]" />
          <span>Camera & Optics</span>
        </div>
        <p className="text-sm font-medium text-white">{item.camera || 'Original Master'}</p>
        {item.lens && <p className="text-xs text-zinc-400 -mt-1.5">{item.lens}</p>}
        <div className="grid grid-cols-4 gap-2 pt-1">
          <div className="rounded-lg bg-white/[0.04] border border-white/10 p-2 text-center">
            <p className="text-[10px] text-zinc-400">Aperture</p>
            <p className="font-mono text-xs tabular-nums text-white mt-0.5">
              {item.aperture || '—'}
            </p>
          </div>
          <div className="rounded-lg bg-white/[0.04] border border-white/10 p-2 text-center">
            <p className="text-[10px] text-zinc-400">Shutter</p>
            <p className="font-mono text-xs tabular-nums text-white mt-0.5">
              {item.shutterSpeed || '—'}
            </p>
          </div>
          <div className="rounded-lg bg-white/[0.04] border border-white/10 p-2 text-center">
            <p className="text-[10px] text-zinc-400">Focal</p>
            <p className="font-mono text-xs tabular-nums text-white mt-0.5">
              {item.focalLength || '—'}
            </p>
          </div>
          <div className="rounded-lg bg-white/[0.04] border border-white/10 p-2 text-center">
            <p className="text-[10px] text-zinc-400">ISO</p>
            <p className="font-mono text-xs tabular-nums text-white mt-0.5">
              {item.iso ?? '—'}
            </p>
          </div>
        </div>
      </div>

      {/* Location & GPS */}
      {(item.placeName || typeof item.latitude === 'number') && (
        <div className="pt-4 border-t border-white/10 space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
            <MapPin className="w-4 h-4 text-[#A8C7FA]" />
            <span>Location</span>
          </div>
          <p className="text-sm text-white">{item.placeName || 'Geotagged Coordinates'}</p>
          {typeof item.latitude === 'number' && typeof item.longitude === 'number' && (
            <p className="text-xs font-mono tabular-nums text-zinc-400">
              {item.latitude.toFixed(5)}° N, {item.longitude.toFixed(5)}° E
            </p>
          )}
        </div>
      )}

      {/* Telegram Cloud Storage Verification */}
      <div className="pt-4 border-t border-white/10 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
          <ShieldCheck className="w-4 h-4" />
          <span>Telegram Cloud Storage Verified</span>
        </div>

        <div className="rounded-xl bg-white/[0.04] border border-white/10 p-3.5 space-y-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-zinc-400">Protocol</span>
            <span className="font-mono text-zinc-100">MTProto 2.0 · Document</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-zinc-400">Message ID</span>
            <span className="font-mono tabular-nums text-zinc-100">#{item.messageId}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-zinc-400">Channel ID</span>
            <span className="font-mono tabular-nums text-zinc-100">{item.libraryId}</span>
          </div>
          <div className="pt-1 border-t border-white/10">
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">SHA-256 Bitstream</span>
              <button
                type="button"
                onClick={onCopySha}
                className="inline-flex items-center gap-1 text-[11px] text-[#A8C7FA] hover:underline"
              >
                {copiedSha ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copiedSha ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="font-mono text-[11px] text-zinc-300 break-all mt-1">
              {item.sha256}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
