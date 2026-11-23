'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  Archive,
  Check,
  Download,
  FolderPlus,
  Grid2x2,
  Grid3x3,
  Heart,
  LayoutGrid,
  Lock,
  Play,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { GridDensity, MediaItem } from '@/lib/types';
import {
  extractTimelineYears,
  formatDuration,
  groupMediaByDay,
} from '@/lib/utils/security';

interface TimelineViewProps {
  title?: string;
  subtitle?: string;
  items: MediaItem[];
  density: GridDensity;
  onDensityChange: (density: GridDensity) => void;
  showMemories?: boolean;
  emptyTitle?: string;
  emptySubtitle?: string;
  onOpenMedia: (item: MediaItem, scope: MediaItem[]) => void;
  onToggleFavoriteBulk: (ids: number[]) => Promise<void>;
  onDeleteBulk: (ids: number[]) => Promise<void>;
  onArchiveBulk: (ids: number[]) => Promise<void>;
  onLockBulk: (ids: number[]) => Promise<void>;
  onDownloadZipBulk: (ids: number[]) => Promise<void>;
  onOpenAddToAlbum: (ids: number[]) => void;
  onTriggerUpload: () => void;
  selectedIds?: Set<number>;
  onSelectedIdsChange?: React.Dispatch<React.SetStateAction<Set<number>>>;
  activeShortcutPulse?: 'archive' | 'favorite' | 'delete' | null;
  isArchiveView?: boolean;
}

const DENSITY_GRID_CLASSES: Record<GridDensity, string> = {
  compact: 'grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-9 gap-1.5',
  standard: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2',
  spacious: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5',
};

export function TimelineView({
  title,
  subtitle,
  items,
  density,
  onDensityChange,
  showMemories = false,
  emptyTitle = 'No photos in this view',
  emptySubtitle = 'Upload original photos or videos up to 2,048 MB to store them losslessly.',
  onOpenMedia,
  onToggleFavoriteBulk,
  onDeleteBulk,
  onArchiveBulk,
  onLockBulk,
  onDownloadZipBulk,
  onOpenAddToAlbum,
  onTriggerUpload,
  selectedIds: controlledSelectedIds,
  onSelectedIdsChange,
  activeShortcutPulse = null,
  isArchiveView = false,
}: TimelineViewProps) {
  const [internalSelectedIds, setInternalSelectedIds] = useState<Set<number>>(new Set());
  const selectedIds = controlledSelectedIds ?? internalSelectedIds;
  const setSelectedIds = onSelectedIdsChange ?? setInternalSelectedIds;
  const lastClickedIndexRef = useRef<number | null>(null);
  const yearSectionRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const dayGroups = useMemo(() => groupMediaByDay(items), [items]);
  const years = useMemo(() => extractTimelineYears(dayGroups), [dayGroups]);

  // Flat ordered list matching visual grid order for Shift+Click range select & Lightbox order
  const orderedItems = useMemo(
    () => dayGroups.flatMap((group) => group.items),
    [dayGroups]
  );

  const memories = useMemo(() => {
    if (!showMemories || orderedItems.length === 0) return [];
    const favorites = orderedItems.filter((i) => i.isFavorite);
    const pool = favorites.length >= 3 ? favorites : orderedItems;
    return [
      {
        id: 'mem-golden',
        title: 'Golden Hour Masters',
        meta: 'November 2026',
        item: pool[0],
      },
      pool[1]
        ? {
            id: 'mem-portraits',
            title: 'Studio & Light',
            meta: 'Curated Selection',
            item: pool[1],
          }
        : null,
      pool[2]
        ? {
            id: 'mem-monsoon',
            title: 'Western Ghats & Coast',
            meta: 'Regional Highlights',
            item: pool[2],
          }
        : null,
      pool[3]
        ? {
            id: 'mem-travel',
            title: '1 Year Ago · Autumn',
            meta: '2025 Archive',
            item: pool[3],
          }
        : null,
    ].filter(Boolean) as Array<{ id: string; title: string; meta: string; item: MediaItem }>;
  }, [orderedItems, showMemories]);

  const toggleSelectItem = (
    messageId: number,
    flatIndex: number,
    shiftKey: boolean
  ) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastClickedIndexRef.current !== null) {
        const start = Math.min(lastClickedIndexRef.current, flatIndex);
        const end = Math.max(lastClickedIndexRef.current, flatIndex);
        for (let i = start; i <= end; i++) {
          const item = orderedItems[i];
          if (item) next.add(item.messageId);
        }
      } else if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      lastClickedIndexRef.current = flatIndex;
      return next;
    });
  };

  const toggleSelectGroup = (groupItems: MediaItem[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = groupItems.every((i) => next.has(i.messageId));
      for (const item of groupItems) {
        if (allSelected) {
          next.delete(item.messageId);
        } else {
          next.add(item.messageId);
        }
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    lastClickedIndexRef.current = null;
  };

  const selectedArray = Array.from(selectedIds);

  const scrollToYear = (year: number) => {
    const target = yearSectionRefs.current[year];
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Track which years have already received a ref anchor
  const seenYearAnchors = new Set<number>();

  return (
    <div className="relative px-4 sm:px-7 py-5 max-w-[1600px] mx-auto pb-24 lg:pb-12">
      {/* Floating Blue Selection Action Bar */}
      {selectedArray.length > 0 && (
        <div
          role="region"
          aria-label="Bulk selection actions"
          className="sticky top-3 z-30 mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#0B57D0] text-white px-4 py-2.5 shadow-lg"
        >
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={clearSelection}
              aria-label="Clear selection"
              className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/15 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold tabular-nums">
              {selectedArray.length} selected
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1 sm:gap-1.5">
            <button
              type="button"
              onClick={async () => {
                await onToggleFavoriteBulk(selectedArray);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150 whitespace-nowrap ${
                activeShortcutPulse === 'favorite'
                  ? 'scale-95 bg-white/30 ring-2 ring-white/90 shadow-inner'
                  : 'hover:bg-white/15 active:scale-95'
              }`}
            >
              <Heart className="w-3.5 h-3.5" />
              Favorite
              <kbd className="hidden sm:inline-flex items-center justify-center rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-mono leading-none text-white/95">
                F
              </kbd>
            </button>
            <button
              type="button"
              onClick={() => onOpenAddToAlbum(selectedArray)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium hover:bg-white/15 active:scale-95 transition-all whitespace-nowrap"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              Add to album
            </button>
            <button
              type="button"
              onClick={async () => {
                await onDownloadZipBulk(selectedArray);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium hover:bg-white/15 active:scale-95 transition-all whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Download ZIP
            </button>
            <button
              type="button"
              onClick={async () => {
                await onLockBulk(selectedArray);
                clearSelection();
              }}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium hover:bg-white/15 active:scale-95 transition-all whitespace-nowrap"
            >
              <Lock className="w-3.5 h-3.5" />
              Lock
            </button>
            <button
              type="button"
              onClick={async () => {
                await onArchiveBulk(selectedArray);
                clearSelection();
              }}
              className={`hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150 whitespace-nowrap ${
                activeShortcutPulse === 'archive'
                  ? 'scale-95 bg-white/30 ring-2 ring-white/90 shadow-inner'
                  : 'hover:bg-white/15 active:scale-95'
              }`}
            >
              <Archive className="w-3.5 h-3.5" />
              {isArchiveView ? 'Unarchive' : 'Archive'}
              <kbd className="hidden lg:inline-flex items-center justify-center rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-mono leading-none text-white/95">
                A
              </kbd>
            </button>
            <button
              type="button"
              onClick={async () => {
                await onDeleteBulk(selectedArray);
                clearSelection();
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150 whitespace-nowrap ${
                activeShortcutPulse === 'delete'
                  ? 'scale-95 bg-red-500 ring-2 ring-white/90 shadow-inner'
                  : 'bg-white/15 hover:bg-red-500 active:scale-95'
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
              <kbd className="hidden sm:inline-flex items-center justify-center rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-mono leading-none text-white/95">
                Del
              </kbd>
            </button>
          </div>
        </div>
      )}

      {/* Optional View Header + Grid Density Segmented Control */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
        <div>
          {title && (
            <h1 className="text-2xl font-bold tracking-tight text-[#1F1F1F] dark:text-zinc-100">
              {title}
            </h1>
          )}
          <p className="text-xs text-[#5F6368] dark:text-zinc-400 mt-0.5 tabular-nums">
            {subtitle ? `${subtitle} · ` : ''}
            {orderedItems.length} {orderedItems.length === 1 ? 'original master' : 'original masters'} · Shift+Click to select · A Archive · F Favorite · Del Trash
          </p>
        </div>

        <div
          role="group"
          aria-label="Grid density"
          className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#F8FAFD] dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
        >
          {(
            [
              { id: 'compact', label: 'Compact', Icon: Grid3x3 },
              { id: 'standard', label: 'Standard', Icon: LayoutGrid },
              { id: 'spacious', label: 'Spacious', Icon: Grid2x2 },
            ] as const
          ).map(({ id, label, Icon }) => {
            const active = density === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onDensityChange(id)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-white dark:bg-zinc-800 text-[#0B57D0] dark:text-[#A8C7FA] shadow-sm'
                    : 'text-[#5F6368] dark:text-zinc-400 hover:text-[#1F1F1F] dark:hover:text-zinc-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Memories Highlights Carousel (Photos Timeline Only) */}
      {memories.length > 0 && (
        <section aria-label="Memories highlights" className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-[#0B57D0] dark:text-[#A8C7FA]" />
            <h2 className="text-sm font-semibold text-[#1F1F1F] dark:text-zinc-100">
              Memories
            </h2>
          </div>
          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
            {memories.map((mem) => (
              <button
                key={mem.id}
                type="button"
                onClick={() => onOpenMedia(mem.item, orderedItems)}
                className="group relative shrink-0 w-44 sm:w-52 h-60 sm:h-64 rounded-2xl overflow-hidden bg-slate-100 dark:bg-zinc-900 text-left focus-visible:outline-2 focus-visible:outline-[#0B57D0]"
              >
                <img
                  src={mem.item.thumbnailDataUrl || mem.item.fullUrl}
                  alt={mem.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-4">
                  <p className="text-[11px] font-medium text-white/80">{mem.meta}</p>
                  <p className="text-sm font-bold text-white leading-snug mt-0.5">
                    {mem.title}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Empty State */}
      {orderedItems.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-[#F8FAFD] dark:bg-zinc-900/40 p-12 text-center mt-4">
          <h2 className="text-base font-semibold text-[#1F1F1F] dark:text-zinc-100">
            {emptyTitle}
          </h2>
          <p className="text-sm text-[#5F6368] dark:text-zinc-400 mt-1 max-w-md mx-auto">
            {emptySubtitle}
          </p>
          <button
            type="button"
            onClick={onTriggerUpload}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] text-white text-xs font-semibold px-5 py-2.5 transition-colors"
          >
            <Upload className="w-4 h-4" />
            Upload Uncompressed Masters
          </button>
        </div>
      ) : (
        <div className="space-y-8 pr-0 lg:pr-16">
          {dayGroups.map((group) => {
            const isFirstOfYear = !seenYearAnchors.has(group.year);
            if (isFirstOfYear) seenYearAnchors.add(group.year);
            const allGroupSelected = group.items.every((i) => selectedIds.has(i.messageId));

            return (
              <section
                key={group.dateKey}
                ref={(el) => {
                  if (isFirstOfYear) {
                    yearSectionRefs.current[group.year] = el as HTMLDivElement | null;
                  }
                }}
                aria-label={group.label}
                className="scroll-mt-20"
              >
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <button
                      type="button"
                      onClick={() => toggleSelectGroup(group.items)}
                      aria-label={`Select all items from ${group.label}`}
                      aria-pressed={allGroupSelected}
                      className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors shrink-0 ${
                        allGroupSelected
                          ? 'bg-[#0B57D0] border-[#0B57D0] text-white'
                          : 'border-slate-300 dark:border-zinc-700 text-transparent hover:border-[#0B57D0]'
                      }`}
                    >
                      <Check className="w-3 h-3 stroke-[3]" />
                    </button>
                    <h2 className="text-sm font-semibold text-[#1F1F1F] dark:text-zinc-100 truncate">
                      {group.label}
                    </h2>
                    {group.locationSummary && (
                      <span className="hidden sm:inline text-xs text-[#5F6368] dark:text-zinc-400 truncate">
                        · {group.locationSummary}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-[#5F6368] dark:text-zinc-500 font-mono tabular-nums shrink-0">
                    {group.items.length}
                  </span>
                </div>

                <div className={`grid ${DENSITY_GRID_CLASSES[density]}`}>
                  {group.items.map((item) => {
                    const flatIdx = orderedItems.findIndex(
                      (x) => x.messageId === item.messageId
                    );
                    const isSelected = selectedIds.has(item.messageId);
                    const isRaw = /\.(dng|arw|raf|cr3|nef)$/i.test(item.filename);

                    return (
                      <div
                        key={item.messageId}
                        className={`group relative aspect-square overflow-hidden rounded-xl bg-slate-100 dark:bg-zinc-900 transition-all ${
                          isSelected
                            ? 'ring-3 ring-[#0B57D0] dark:ring-[#A8C7FA] scale-[0.96]'
                            : ''
                        }`}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            if (selectedIds.size > 0 || e.shiftKey) {
                              toggleSelectItem(item.messageId, flatIdx, e.shiftKey);
                            } else {
                              onOpenMedia(item, orderedItems);
                            }
                          }}
                          aria-label={`Open ${item.filename}`}
                          className="w-full h-full block focus-visible:outline-2 focus-visible:outline-[#0B57D0]"
                        >
                          <img
                            src={item.thumbnailDataUrl || item.fullUrl}
                            alt={item.filename}
                            referrerPolicy="no-referrer"
                            loading="lazy"
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                        </button>

                        {/* Hover / Selection Checkmark */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelectItem(item.messageId, flatIdx, e.shiftKey);
                          }}
                          aria-label={
                            isSelected ? `Deselect ${item.filename}` : `Select ${item.filename}`
                          }
                          aria-pressed={isSelected}
                          className={`absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                            isSelected
                              ? 'bg-[#0B57D0] text-white opacity-100 shadow'
                              : 'bg-black/40 border border-white/80 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-[#0B57D0]'
                          }`}
                        >
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                        </button>

                        {/* Video Duration Badge */}
                        {item.kind === 'video' && (
                          <span className="pointer-events-none absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 text-[10px] font-mono tabular-nums text-white">
                            <Play className="w-2.5 h-2.5 fill-current" />
                            {formatDuration(item.durationMs)}
                          </span>
                        )}

                        {/* Favorite & RAW Indicators */}
                        <div className="pointer-events-none absolute bottom-2 inset-x-2 flex items-center justify-between">
                          {isRaw ? (
                            <span className="rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-white/95">
                              RAW
                            </span>
                          ) : (
                            <span />
                          )}
                          {item.isFavorite && (
                            <span className="w-6 h-6 rounded-full bg-black/50 flex items-center justify-center text-white">
                              <Heart className="w-3.5 h-3.5 fill-rose-400 text-rose-400" />
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Floating Frosted Vertical Date Scrubber Rail (Desktop Right Margin) */}
      {years.length > 0 && (
        <nav
          aria-label="Jump to year"
          className="hidden lg:flex fixed right-4 top-1/2 -translate-y-1/2 z-20 flex-col items-center gap-1 rounded-full border border-slate-200/80 dark:border-zinc-700/80 bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md px-1.5 py-2 shadow-sm"
        >
          {years.map((year) => (
            <button
              key={year}
              type="button"
              onClick={() => scrollToYear(year)}
              className="px-2 py-1 rounded-full text-[11px] font-mono font-semibold tabular-nums text-[#5F6368] dark:text-zinc-300 hover:bg-[#D3E3FD] hover:text-[#0B57D0] dark:hover:bg-[#004A77] dark:hover:text-[#A8C7FA] transition-colors"
            >
              {year}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
