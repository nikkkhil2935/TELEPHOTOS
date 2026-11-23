'use client';

import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, RefreshCw, X } from 'lucide-react';
import type { TelegramSessionPayload } from '@/lib/types';
import { tgClient } from '@/lib/services/tgClient';

interface RebuildIndexModalProps {
  open: boolean;
  session: TelegramSessionPayload | null;
  onClose: () => void;
  onRequireAuth: () => void;
  onCompleted?: (indexedCount: number) => void;
}

export function RebuildIndexModal({
  open,
  session,
  onClose,
  onRequireAuth,
  onCompleted,
}: RebuildIndexModalProps) {
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(0);
  const [indexed, setIndexed] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleStartRebuild = async () => {
    if (!session) {
      onClose();
      onRequireAuth();
      return;
    }

    setScanning(true);
    setError(null);
    setDone(false);
    setScanned(0);
    setIndexed(0);

    try {
      const res = await tgClient.rebuildIndexFromChannel((s, idx) => {
        setScanned(s);
        setIndexed(idx);
      });
      setScanned(res.totalScanned);
      setIndexed(res.totalIndexed);
      setDone(true);
      onCompleted?.(res.totalIndexed);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to scan Telegram channel messages.'
      );
    } finally {
      setScanning(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Rebuild Library Index from Telegram"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-3 sm:p-4"
    >
      <div className="w-full max-w-md max-h-[90dvh] flex flex-col rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#1E1F20] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-zinc-800 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#D3E3FD] dark:bg-[#004A77] text-[#0B57D0] dark:text-[#A8C7FA] flex items-center justify-center shrink-0">
              <RefreshCw className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-[#1F1F1F] dark:text-zinc-100 truncate">
                Rebuild Index from Telegram
              </h2>
              <p className="text-[11px] text-[#5F6368] dark:text-zinc-400 truncate">
                {session ? session.channelTitle : 'Telegram is your source of truth'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close rebuild index dialog"
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto text-xs text-[#5F6368] dark:text-zinc-300">
          <p className="leading-relaxed">
            Scans every message in your private Telegram storage channel in 100-message batches, parses Schema v1 JSON captions & native Telegram media, caches thumbnails, and rebuilds your local IndexedDB gallery with zero data loss.
          </p>

          {scanning && (
            <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-[#F8FAFD] dark:bg-zinc-900 p-4 space-y-2.5">
              <div className="flex items-center justify-between font-medium text-[#1F1F1F] dark:text-zinc-100">
                <span className="inline-flex items-center gap-1.5 text-[#0B57D0] dark:text-[#A8C7FA]">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Scanning Telegram history...
                </span>
                <span className="font-mono tabular-nums">{scanned} scanned</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-zinc-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#0B57D0] transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(15, (scanned % 100) || 100))}%` }}
                />
              </div>
              <p className="text-[11px] text-[#5F6368] dark:text-zinc-400 tabular-nums">
                Indexed {indexed} {indexed === 1 ? 'photo or video' : 'photos & videos'} so far.
              </p>
            </div>
          )}

          {done && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 p-3.5 flex items-start gap-2.5 text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="font-semibold">Rebuild Complete</p>
                <p className="text-[11px] opacity-90 mt-0.5 tabular-nums">
                  Scanned {scanned} Telegram messages and indexed {indexed} media masters.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-3.5 flex items-start gap-2 text-red-700 dark:text-red-300"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-200 dark:border-zinc-800 bg-[#F8FAFD] dark:bg-zinc-900/50 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-2 text-xs font-semibold text-slate-600 dark:text-zinc-300 hover:bg-slate-200/70 dark:hover:bg-zinc-800"
          >
            {done ? 'Done' : 'Cancel'}
          </button>
          <button
            type="button"
            disabled={scanning}
            onClick={handleStartRebuild}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] disabled:opacity-50 text-white px-4 py-2 text-xs font-semibold transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? 'Scanning Channel...' : session ? 'Start Full Rebuild' : 'Connect Telegram First'}
          </button>
        </div>
      </div>
    </div>
  );
}
