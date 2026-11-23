'use client';

import React, { useMemo, useState } from 'react';
import { ArrowLeft, Compass, MapPin, Play } from 'lucide-react';
import type { MediaItem, PlaceCluster } from '@/lib/types';
import { buildPlaceClusters, formatDuration } from '@/lib/utils/security';

interface PlacesViewProps {
  items: MediaItem[];
  onOpenMedia: (item: MediaItem, scopeItems: MediaItem[]) => void;
}

export function PlacesView({ items, onOpenMedia }: PlacesViewProps) {
  const clusters = useMemo(() => buildPlaceClusters(items), [items]);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);

  const selectedCluster: PlaceCluster | undefined = useMemo(
    () => clusters.find((c) => c.id === selectedClusterId),
    [clusters, selectedClusterId]
  );

  const clusterItems = useMemo(() => {
    if (!selectedCluster) return [];
    const idSet = new Set(selectedCluster.mediaIds);
    return items
      .filter((i) => idSet.has(i.messageId))
      .sort((a, b) => new Date(b.takenAt).getTime() - new Date(a.takenAt).getTime());
  }, [items, selectedCluster]);

  if (selectedCluster) {
    return (
      <div className="px-4 sm:px-8 py-6 max-w-[1440px] mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-slate-200 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSelectedClusterId(null)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-full text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              All Places
            </button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-[#1F1F1F] dark:text-zinc-100">
                {selectedCluster.name}
              </h1>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                {selectedCluster.regionSubtitle} ·{' '}
                <span className="font-mono tabular-nums">
                  {selectedCluster.latitude.toFixed(4)}°N, {selectedCluster.longitude.toFixed(4)}°E
                </span>{' '}
                · {clusterItems.length} {clusterItems.length === 1 ? 'item' : 'items'}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 mt-6">
          {clusterItems.map((item) => (
            <button
              key={item.messageId}
              type="button"
              onClick={() => onOpenMedia(item, clusterItems)}
              aria-label={`Open ${item.filename}`}
              className="group relative aspect-[4/3] overflow-hidden rounded-xl bg-slate-100 dark:bg-zinc-900 focus-visible:outline-2 focus-visible:outline-[#0B57D0] text-left"
            >
              <img
                src={item.thumbnailDataUrl || item.fullUrl}
                alt={item.filename}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
              {item.kind === 'video' && (
                <span className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/70 text-white text-[11px] font-mono tabular-nums">
                  <Play className="w-3 h-3 fill-current" />
                  {formatDuration(item.durationMs)}
                </span>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent p-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <p className="text-xs font-medium text-white truncate">{item.filename}</p>
                <p className="text-[11px] text-white/80 font-mono tabular-nums">
                  {item.camera || 'Original Master'}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-8 py-6 max-w-[1440px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-7">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1F1F1F] dark:text-zinc-100">
            Places
          </h1>
          <p className="text-sm text-[#5F6368] dark:text-zinc-400 mt-1">
            EXIF GPS coordinates clustered locally in your browser — zero external map tracking.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-zinc-400 font-mono tabular-nums">
          <Compass className="w-4 h-4 text-[#0B57D0] dark:text-[#A8C7FA]" />
          <span>{clusters.length} regional destinations indexed</span>
        </div>
      </div>

      {clusters.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-[#F8FAFD] dark:bg-zinc-900/50 p-12 text-center">
          <MapPin className="w-8 h-8 text-slate-400 mx-auto mb-3" />
          <h2 className="text-base font-semibold text-[#1F1F1F] dark:text-zinc-100">
            No geotagged photos yet
          </h2>
          <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1 max-w-md mx-auto">
            Upload original photos containing GPS EXIF coordinates to automatically cluster destinations here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {clusters.map((cluster) => (
            <button
              key={cluster.id}
              type="button"
              onClick={() => setSelectedClusterId(cluster.id)}
              className="group relative aspect-[16/10] w-full overflow-hidden rounded-2xl border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-900 text-left focus-visible:outline-2 focus-visible:outline-[#0B57D0] transition-transform duration-200 hover:-translate-y-0.5"
            >
              <img
                src={cluster.coverUrl}
                alt={cluster.name}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/10" />

              {/* Floating Location Pin Header */}
              <div className="absolute top-3.5 left-3.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/55 backdrop-blur-md text-white text-xs font-medium">
                <MapPin className="w-3.5 h-3.5 text-[#A8C7FA]" />
                <span className="font-mono tabular-nums">
                  {cluster.latitude.toFixed(2)}°N, {cluster.longitude.toFixed(2)}°E
                </span>
              </div>

              <div className="absolute top-3.5 right-3.5 px-2.5 py-1 rounded-full bg-white/90 dark:bg-zinc-900/90 text-[#1F1F1F] dark:text-zinc-100 text-xs font-semibold tabular-nums">
                {cluster.count} {cluster.count === 1 ? 'item' : 'items'}
              </div>

              <div className="absolute inset-x-0 bottom-0 p-5">
                <h2 className="text-xl font-bold tracking-tight text-white">
                  {cluster.name}
                </h2>
                <p className="text-xs text-white/80 mt-1">
                  {cluster.regionSubtitle}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
