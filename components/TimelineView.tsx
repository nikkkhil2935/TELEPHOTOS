'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Archive,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FolderPlus,
  Grid2x2,
  Grid3x3,
  Heart,
  Layers,
  LayoutGrid,
  Lock,
  Play,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { GridDensity, MediaItem } from '@/lib/types';
import { formatDuration, groupMediaByDay } from '@/lib/utils/security';
import {
  buildCuratedMemories,
  extractTimelineYearMonths,
  type TimelineMonthNode,
  type TimelineYearNode,
} from '@/lib/utils/timeline';

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
  const dateSectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const memoriesTrackRef = useRef<HTMLDivElement | null>(null);
  const scrubToastTimerRef = useRef<number | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

  // Use a stable UTC calendar date matching the active session day
  const referenceDate = useMemo(() => new Date(), []);

  const dayGroups = useMemo(
    () => groupMediaByDay(items, referenceDate),
    [items, referenceDate]
  );
  const yearNodes = useMemo(() => extractTimelineYearMonths(dayGroups), [dayGroups]);

  // Flat ordered list matching visual grid order for Shift+Click range select & Lightbox order
  const orderedItems = useMemo(
    () => dayGroups.flatMap((group) => group.items),
    [dayGroups]
  );

  // Curated date-based Memories highlights across previous years
  const memories = useMemo(
    () => (showMemories ? buildCuratedMemories(orderedItems, referenceDate) : []),
    [orderedItems, showMemories, referenceDate]
  );

  // Horizontal carousel scroll arrows state
  const [canScrollMemLeft, setCanScrollMemLeft] = useState(false);
  const [canScrollMemRight, setCanScrollMemRight] = useState(true);

  const updateMemoriesScrollButtons = useCallback(() => {
    const el = memoriesTrackRef.current;
    if (!el) return;
    setCanScrollMemLeft(el.scrollLeft > 8);
    setCanScrollMemRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  }, []);

  useEffect(() => {
    const el = memoriesTrackRef.current;
    if (!el) return;
    const raf = window.requestAnimationFrame(updateMemoriesScrollButtons);
    el.addEventListener('scroll', updateMemoriesScrollButtons, { passive: true });
    window.addEventListener('resize', updateMemoriesScrollButtons);
    return () => {
      window.cancelAnimationFrame(raf);
      el.removeEventListener('scroll', updateMemoriesScrollButtons);
      window.removeEventListener('resize', updateMemoriesScrollButtons);
    };
  }, [memories.length, updateMemoriesScrollButtons]);

  const scrollMemoriesBy = (direction: 'left' | 'right') => {
    const el = memoriesTrackRef.current;
    if (!el) return;
    const delta = direction === 'right' ? 440 : -440;
    el.scrollBy({ left: delta, behavior: 'smooth' });
  };

  // Active Year/Month scroll-spy + scrub jump feedback for Floating Date Scrubber Rail
  const defaultMonthKey = yearNodes[0]?.months[0]?.monthKey ?? null;
  const defaultYear = yearNodes[0]?.year ?? null;
  const [activeMonthKey, setActiveMonthKey] = useState<string | null>(null);
  const [expandedYear, setExpandedYear] = useState<number | null>(null);
  const [scrubCallout, setScrubCallout] = useState<{ label: string; count: number } | null>(null);
  const [highlightedDateKey, setHighlightedDateKey] = useState<string | null>(null);

  const effectiveMonthKey = activeMonthKey ?? defaultMonthKey;
  const effectiveActiveYear = effectiveMonthKey
    ? Number(effectiveMonthKey.slice(0, 4))
    : defaultYear;
  const effectiveExpandedYear = expandedYear ?? effectiveActiveYear;

  useEffect(() => {
    if (dayGroups.length === 0 || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const topEntry = visible[0];
        if (!topEntry) return;
        const monthKey = topEntry.target.getAttribute('data-month-key');
        if (monthKey) {
          setActiveMonthKey(monthKey);
        }
      },
      {
        rootMargin: '-12% 0px -68% 0px',
        threshold: 0,
      }
    );

    for (const group of dayGroups) {
      const node = dateSectionRefs.current[group.dateKey];
      if (node) observer.observe(node);
    }

    return () => observer.disconnect();
  }, [dayGroups]);

  useEffect(() => {
    return () => {
      if (scrubToastTimerRef.current !== null) window.clearTimeout(scrubToastTimerRef.current);
      if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
    };
  }, []);

  const flashScrubFeedback = (dateKey: string, label: string, count: number) => {
    if (scrubToastTimerRef.current !== null) window.clearTimeout(scrubToastTimerRef.current);
    if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);

    setScrubCallout({ label, count });
    setHighlightedDateKey(dateKey);

    scrubToastTimerRef.current = window.setTimeout(() => {
      setScrubCallout(null);
    }, 1800);
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedDateKey(null);
    }, 1200);
  };

  const jumpToYear = (yearNode: TimelineYearNode) => {
    const firstMonth = yearNode.months[0];
    setExpandedYear(yearNode.year);
    if (firstMonth) {
      setActiveMonthKey(firstMonth.monthKey);
    }
    const target = dateSectionRefs.current[yearNode.firstDateKey];
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    flashScrubFeedback(
      yearNode.firstDateKey,
      firstMonth ? firstMonth.fullLabel : String(yearNode.year),
      yearNode.totalCount
    );
  };

  const jumpToMonth = (monthNode: TimelineMonthNode) => {
    setExpandedYear(monthNode.year);
    setActiveMonthKey(monthNode.monthKey);
    const target = dateSectionRefs.current[monthNode.firstDateKey];
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    flashScrubFeedback(monthNode.firstDateKey, monthNode.fullLabel, monthNode.itemCount);
  };

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

  // Drag-to-select rectangle state & interaction
  const timelineContainerRef = useRef<HTMLDivElement | null>(null);
  const [dragBox, setDragBox] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    isDragging: boolean;
  } | null>(null);
  const dragInitialSelectedRef = useRef<Set<number>>(new Set());
  const isDraggingActiveRef = useRef(false);

  const handleContainerMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          'button, input, select, textarea, a, video, [role="button"], [role="tab"], [role="dialog"], [role="region"]'
        )
      ) {
        return;
      }

      dragInitialSelectedRef.current = e.shiftKey ? new Set(selectedIds) : new Set();
      setDragBox({
        startX: e.clientX,
        startY: e.clientY,
        currentX: e.clientX,
        currentY: e.clientY,
        isDragging: false,
      });
    },
    [selectedIds]
  );

  useEffect(() => {
    if (!dragBox) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dist = Math.hypot(e.clientX - dragBox.startX, e.clientY - dragBox.startY);
      const isDragging = dragBox.isDragging || dist > 6;
      isDraggingActiveRef.current = isDragging;

      setDragBox((prev) =>
        prev ? { ...prev, currentX: e.clientX, currentY: e.clientY, isDragging } : null
      );

      if (isDragging && timelineContainerRef.current) {
        const boxLeft = Math.min(dragBox.startX, e.clientX);
        const boxTop = Math.min(dragBox.startY, e.clientY);
        const boxRight = Math.max(dragBox.startX, e.clientX);
        const boxBottom = Math.max(dragBox.startY, e.clientY);

        const cardElements = timelineContainerRef.current.querySelectorAll<HTMLElement>(
          '[data-media-card="true"]'
        );
        const nextSelected = new Set(dragInitialSelectedRef.current);

        cardElements.forEach((el) => {
          const rect = el.getBoundingClientRect();
          const intersects = !(
            rect.right < boxLeft ||
            rect.left > boxRight ||
            rect.bottom < boxTop ||
            rect.top > boxBottom
          );
          const rawId = el.getAttribute('data-media-id');
          if (rawId) {
            const id = Number(rawId);
            if (intersects) {
              nextSelected.add(id);
            }
          }
        });

        setSelectedIds(nextSelected);
      }
    };

    const handleMouseUp = () => {
      setTimeout(() => {
        isDraggingActiveRef.current = false;
      }, 50);
      setDragBox(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragBox, setSelectedIds]);

  const selectedArray = Array.from(selectedIds);

  const formattedReferenceDay = useMemo(
    () =>
      referenceDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }),
    [referenceDate]
  );

  return (
    <div
      ref={timelineContainerRef}
      onMouseDown={handleContainerMouseDown}
      className={`relative px-4 sm:px-7 py-5 max-w-[1600px] mx-auto pb-24 lg:pb-12 ${
        dragBox?.isDragging ? 'select-none' : ''
      }`}
    >
      {/* Drag-to-select visual marquee rectangle */}
      {dragBox && dragBox.isDragging && (
        <div
          role="presentation"
          className="fixed pointer-events-none z-50 rounded-lg border-2 border-[#0B57D0] bg-[#0B57D0]/20 shadow-xs backdrop-blur-[0.5px]"
          style={{
            left: Math.min(dragBox.startX, dragBox.currentX),
            top: Math.min(dragBox.startY, dragBox.currentY),
            width: Math.abs(dragBox.currentX - dragBox.startX),
            height: Math.abs(dragBox.currentY - dragBox.startY),
          }}
        />
      )}
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

      {/* Curated Date-Based Memories Highlights Carousel */}
      {memories.length > 0 && (
        <section
          aria-label="Memories highlights"
          data-testid="memories-carousel"
          className="mb-8"
        >
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles className="w-4 h-4 text-[#0B57D0] dark:text-[#A8C7FA] shrink-0" />
              <h2 className="text-sm font-semibold text-[#1F1F1F] dark:text-zinc-100">
                Memories
              </h2>
              <span className="hidden sm:inline text-xs text-[#5F6368] dark:text-zinc-400 truncate">
                · Curated for {formattedReferenceDay} across previous years
              </span>
            </div>

            {/* Horizontal Scroll Controls */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => scrollMemoriesBy('left')}
                disabled={!canScrollMemLeft}
                aria-label="Scroll memories left"
                className="w-7 h-7 rounded-full border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-[#444746] dark:text-zinc-300 flex items-center justify-center hover:bg-[#F8FAFD] dark:hover:bg-zinc-800 disabled:opacity-35 disabled:pointer-events-none transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => scrollMemoriesBy('right')}
                disabled={!canScrollMemRight}
                aria-label="Scroll memories right"
                className="w-7 h-7 rounded-full border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-[#444746] dark:text-zinc-300 flex items-center justify-center hover:bg-[#F8FAFD] dark:hover:bg-zinc-800 disabled:opacity-35 disabled:pointer-events-none transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div
            ref={memoriesTrackRef}
            className="flex gap-3.5 overflow-x-auto scroll-smooth snap-x snap-mandatory no-scrollbar pb-1"
          >
            {memories.map((mem) => (
              <button
                key={mem.id}
                type="button"
                onClick={() =>
                  onOpenMedia(
                    mem.coverItem,
                    mem.items.length > 1 ? mem.items : orderedItems
                  )
                }
                aria-label={`Open memory ${mem.title} (${mem.eyebrow})`}
                className="group relative shrink-0 snap-start w-44 sm:w-52 h-60 sm:h-64 rounded-2xl overflow-hidden bg-slate-100 dark:bg-zinc-900 text-left shadow-xs hover:shadow-md transition-shadow focus-visible:outline-2 focus-visible:outline-[#0B57D0]"
              >
                <img
                  src={mem.coverItem.thumbnailDataUrl || mem.coverItem.fullUrl}
                  alt={mem.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/20" />

                {/* Top Overlay: Date-Proximity Label & Multi-Item Count */}
                <div className="absolute top-3 inset-x-3 flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 rounded-md bg-black/50 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white/95">
                    {mem.kind === 'anniversary' && <Calendar className="w-2.5 h-2.5" />}
                    {mem.badge}
                  </span>
                  {mem.items.length > 1 && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-black/50 backdrop-blur-sm px-1.5 py-0.5 text-[10px] font-mono tabular-nums text-white/90">
                      <Layers className="w-2.5 h-2.5" />
                      {mem.items.length}
                    </span>
                  )}
                </div>

                {/* Bottom Editorial Typography */}
                <div className="absolute inset-x-0 bottom-0 p-3.5 sm:p-4">
                  <p className="text-[11px] font-medium text-white/80 tabular-nums">
                    {mem.eyebrow}
                  </p>
                  <p className="text-sm sm:text-[15px] font-bold text-white leading-snug mt-0.5">
                    {mem.title}
                  </p>
                  <p className="text-[11px] text-white/75 truncate mt-0.5">
                    {mem.subtitle}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Empty State or Timeline Grid + Sticky Floating Date Scrubber Rail */}
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
        <div className="space-y-4">
          {/* Mobile Compact Year Jump Bar (< 768px) */}
          {yearNodes.length > 1 && (
            <div
              aria-label="Mobile date jump"
              className="md:hidden flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1"
            >
              {yearNodes.map((yearNode) => {
                const isYearActive = effectiveActiveYear === yearNode.year;
                return (
                  <button
                    key={yearNode.year}
                    type="button"
                    onClick={() => jumpToYear(yearNode)}
                    className={`shrink-0 px-3 py-1 rounded-full text-xs font-mono font-semibold tabular-nums transition-colors ${
                      isYearActive
                        ? 'bg-[#0B57D0] text-white'
                        : 'bg-[#F8FAFD] dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-[#444746] dark:text-zinc-300'
                    }`}
                  >
                    {yearNode.year}
                  </button>
                );
              })}
            </div>
          )}

          <div className="relative flex items-start gap-4 lg:gap-6">
            {/* Primary Day-Grouped Media Timeline */}
            <div className="flex-1 min-w-0 space-y-8">
            {dayGroups.map((group) => {
              const allGroupSelected = group.items.every((i) => selectedIds.has(i.messageId));
              const monthKey = group.dateKey.slice(0, 7);
              const isHighlighted = highlightedDateKey === group.dateKey;

              return (
                <section
                  key={group.dateKey}
                  ref={(el) => {
                    dateSectionRefs.current[group.dateKey] = el;
                  }}
                  data-date-key={group.dateKey}
                  data-month-key={monthKey}
                  data-year={group.year}
                  aria-label={group.label}
                  className="scroll-mt-20"
                >
                  <div
                    className={`flex items-center justify-between gap-3 mb-3 rounded-xl transition-colors duration-300 ${
                      isHighlighted
                        ? 'bg-[#D3E3FD]/55 dark:bg-[#004A77]/50 px-2.5 py-1.5 -mx-2.5'
                        : ''
                    }`}
                  >
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
                          data-media-card="true"
                          data-media-id={item.messageId}
                          className={`group relative aspect-square overflow-hidden rounded-xl bg-slate-100 dark:bg-zinc-900 transition-all ${
                            isSelected
                              ? 'ring-3 ring-[#0B57D0] dark:ring-[#A8C7FA] scale-[0.96]'
                              : ''
                          }`}
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              if (isDraggingActiveRef.current) return;
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

          {/* Floating Date Scrubber Rail (Sticky to Right Margin of Timeline View) */}
          {yearNodes.length > 0 && (
            <aside
              aria-label="Date scrubber"
              className="hidden md:flex sticky top-20 self-start shrink-0 z-20 flex-col items-end"
            >
              <div className="relative">
                {/* Floating Scrub Jump Callout Pill */}
                <AnimatePresence>
                  {scrubCallout && (
                    <motion.div
                      key={scrubCallout.label}
                      data-testid="date-scrubber-callout"
                      initial={{ opacity: 0, x: 8, scale: 0.94 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      exit={{ opacity: 0, x: 6, scale: 0.95 }}
                      transition={{ duration: 0.16 }}
                      className="pointer-events-none absolute right-full mr-2.5 top-2 rounded-xl bg-[#1F1F1F] dark:bg-white text-white dark:text-[#1F1F1F] px-3 py-1.5 shadow-lg whitespace-nowrap"
                    >
                      <p className="text-xs font-semibold leading-tight">{scrubCallout.label}</p>
                      <p className="text-[10px] opacity-75 font-mono tabular-nums">
                        {scrubCallout.count} {scrubCallout.count === 1 ? 'item' : 'items'}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>

                <nav
                  aria-label="Floating date scrubber rail"
                  data-testid="date-scrubber-rail"
                  className="flex flex-col items-center gap-1 rounded-2xl border border-slate-200/90 dark:border-zinc-700/80 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md px-1.5 py-2 shadow-sm w-[56px]"
                >
                  {yearNodes.map((yearNode) => {
                    const isYearActive = effectiveActiveYear === yearNode.year;
                    const isYearExpanded = effectiveExpandedYear === yearNode.year;

                    return (
                      <div
                        key={yearNode.year}
                        onMouseEnter={() => setExpandedYear(yearNode.year)}
                        className="w-full flex flex-col items-center"
                      >
                        <button
                          type="button"
                          onClick={() => jumpToYear(yearNode)}
                          aria-label={`Jump to ${yearNode.year}`}
                          aria-current={isYearActive ? 'true' : undefined}
                          className={`w-full py-1 rounded-xl text-[11px] font-mono font-bold tabular-nums transition-colors ${
                            isYearActive
                              ? 'bg-[#0B57D0] text-white shadow-xs'
                              : 'text-[#444746] dark:text-zinc-300 hover:bg-[#D3E3FD] hover:text-[#0B57D0] dark:hover:bg-[#004A77] dark:hover:text-[#A8C7FA]'
                          }`}
                        >
                          {yearNode.year}
                        </button>

                        {/* Nested Months Sub-Rail for Expanded / Active Year */}
                        <AnimatePresence initial={false}>
                          {isYearExpanded && yearNode.months.length > 0 && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.16 }}
                              className="w-full overflow-hidden flex flex-col items-center gap-0.5 pt-1 pb-1"
                            >
                              {yearNode.months.map((monthNode) => {
                                const isMonthActive = effectiveMonthKey === monthNode.monthKey;
                                return (
                                  <button
                                    key={monthNode.monthKey}
                                    type="button"
                                    onClick={() => jumpToMonth(monthNode)}
                                    aria-label={`Jump to ${monthNode.fullLabel}`}
                                    aria-current={isMonthActive ? 'location' : undefined}
                                    title={`${monthNode.fullLabel} (${monthNode.itemCount})`}
                                    className={`w-full py-0.5 rounded-lg text-[10px] font-medium transition-colors flex items-center justify-center gap-1 ${
                                      isMonthActive
                                        ? 'bg-[#D3E3FD] dark:bg-[#004A77] text-[#0B57D0] dark:text-[#C2E7FF] font-semibold'
                                        : 'text-[#5F6368] dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 hover:text-[#1F1F1F] dark:hover:text-zinc-100'
                                    }`}
                                  >
                                    <span>{monthNode.shortLabel}</span>
                                  </button>
                                );
                              })}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </nav>
              </div>
            </aside>
          )}
          </div>
        </div>
      )}
    </div>
  );
}
