'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AnimatePresence, motion } from 'motion/react';
import JSZip from 'jszip';
import {
  AlertTriangle,
  Archive,
  ArrowUpDown,
  Clock,
  Cloud,
  Compass,
  FileText,
  Film,
  FolderHeart,
  Heart,
  Image as ImageIcon,
  Lock,
  MapPin,
  Menu,
  Monitor,
  Moon,
  Plus,
  QrCode,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  Smartphone,
  Sun,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { db } from '@/lib/db';
import { startSingleTabGuard, type SingleTabGuardHandle } from '@/lib/services/singleTabGuard';
import { tgClient } from '@/lib/services/tgClient';
import { getAutoLockMinutes, loadEncryptedVaultEnvelope } from '@/lib/services/vaultService';
import type {
  AlbumItem,
  GallerySection,
  GridDensity,
  MediaItem,
  PersonGroup,
  TelegramSessionPayload,
  ThemeMode,
  TransferJob,
} from '@/lib/types';
import {
  formatBytes,
  STORAGE_QUOTA_DISPLAY_BYTES,
} from '@/lib/utils/security';
import {
  isEditableElement,
  resolveGalleryShortcut,
} from '@/lib/utils/shortcuts';
import { FramelyLogo } from './FramelyLogo';
import {
  AddToAlbumModal,
  SettingsModal,
  StorageQuotaModal,
  TelegramAuthModal,
  TransfersModal,
  UploadModal,
} from './GalleryModals';
import { LockedFolderView } from './LockedFolderView';
import { MediaViewer } from './MediaViewer';
import { OnboardingModal } from './OnboardingModal';
import { PlacesView } from './PlacesView';
import { RebuildIndexModal } from './RebuildIndexModal';
import { TimelineView } from './TimelineView';
import { VaultUnlockModal } from './VaultUnlockModal';

interface PhotoGalleryAppProps {
  theme: ThemeMode;
  onCycleTheme: () => void;
  onSetTheme: (theme: ThemeMode) => void;
  onReturnToLanding: () => void;
  openAuthOnMount?: boolean;
}

export function PhotoGalleryApp({
  theme,
  onCycleTheme,
  onSetTheme,
  onReturnToLanding,
  openAuthOnMount = false,
}: PhotoGalleryAppProps) {
  const [session, setSession] = useState<TelegramSessionPayload | null>(() => tgClient.getSession());
  const [vaultLocked, setVaultLocked] = useState<boolean>(() => tgClient.hasLockedEncryptedVault());
  const [liveConnected, setLiveConnected] = useState(false);

  const [activeSection, setActiveSection] = useState<GallerySection>('photos');
  const [selectedAlbumName, setSelectedAlbumName] = useState<string | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [density, setDensity] = useState<GridDensity>('standard');

  // Search & ⌘K shortcut
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Lightbox state
  const [viewerScope, setViewerScope] = useState<MediaItem[] | null>(null);
  const [viewerActiveId, setViewerActiveId] = useState<number | null>(null);

  // Modals & Mobile Drawer
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadDefaultLocked, setUploadDefaultLocked] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(openAuthOnMount);
  const [rebuildModalOpen, setRebuildModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [transfersModalOpen, setTransfersModalOpen] = useState(false);
  const [storageModalOpen, setStorageModalOpen] = useState(false);
  const [albumAssignIds, setAlbumAssignIds] = useState<number[] | null>(null);

  // Vault lock, Sync, Transfers, Toast, Selection & Tactile Keyboard Feedback, Single-Tab Guard
  const [lockedFolderUnlocked, setLockedFolderUnlocked] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [transferJobs, setTransferJobs] = useState<TransferJob[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [activeShortcutPulse, setActiveShortcutPulse] = useState<
    'archive' | 'favorite' | 'delete' | null
  >(null);
  const [tactileHud, setTactileHud] = useState<{
    id: number;
    keycap: string;
    label: string;
    kind: 'archive' | 'favorite' | 'delete';
  } | null>(null);
  const pulseTimerRef = useRef<number | null>(null);
  const hudTimerRef = useRef<number | null>(null);
  const clearSelectTimerRef = useRef<number | null>(null);
  const [tabConflict, setTabConflict] = useState(false);
  const tabGuardRef = useRef<SingleTabGuardHandle | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
  }, []);

  const triggerTactileFeedback = useCallback(
    (payload: { keycap: string; label: string; kind: 'archive' | 'favorite' | 'delete' }) => {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate(14);
        } catch {
          // Ignore unsupported browser vibration errors
        }
      }
      if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
      if (hudTimerRef.current !== null) window.clearTimeout(hudTimerRef.current);

      setActiveShortcutPulse(payload.kind);
      setTactileHud({ id: Date.now(), ...payload });

      pulseTimerRef.current = window.setTimeout(() => {
        setActiveShortcutPulse(null);
      }, 260);
      hudTimerRef.current = window.setTimeout(() => {
        setTactileHud(null);
      }, 2400);
    },
    []
  );

  useEffect(() => {
    return () => {
      if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
      if (hudTimerRef.current !== null) window.clearTimeout(hudTimerRef.current);
      if (clearSelectTimerRef.current !== null) window.clearTimeout(clearSelectTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Connect live Telegram MTProto client + real-time listener + 30s incremental sync when signed in
  const activeChannelId = session?.channelId || '';
  useEffect(() => {
    if (!session || !activeChannelId || tabConflict) {
      setLiveConnected(false);
      return;
    }

    let disposed = false;
    let pollInterval: number | null = null;

    const bootLiveTelegram = async () => {
      try {
        await tgClient.ensureConnectedClient();
        if (disposed) return;
        setLiveConnected(true);
        await tgClient.startLiveChannelListener(() => {
          if (!disposed) {
            showToast('New media synced live from your Telegram channel.');
          }
        });
        await tgClient.syncRecentChannelMessages(40);
      } catch (err) {
        if (!disposed) {
          setLiveConnected(false);
          console.warn('[Framely MTProto] Background connect warning:', err);
        }
      }
    };

    void bootLiveTelegram();

    pollInterval = window.setInterval(() => {
      if (!disposed && tgClient.isLiveConnected()) {
        void tgClient.syncRecentChannelMessages(25).catch(() => {});
      }
    }, 30_000);

    return () => {
      disposed = true;
      if (pollInterval !== null) window.clearInterval(pollInterval);
      tgClient.stopLiveChannelListener();
    };
  }, [session, activeChannelId, tabConflict, showToast]);

  // Single-Tab MTProto Protection
  useEffect(() => {
    const guard = startSingleTabGuard((hasConflict) => {
      setTabConflict(hasConflict);
    });
    tabGuardRef.current = guard;
    return () => guard.dispose();
  }, []);

  // Auto-lock timer for Locked Folder on inactivity
  useEffect(() => {
    if (!lockedFolderUnlocked) return;
    const minutes = getAutoLockMinutes();
    if (minutes <= 0) return;

    let timer = window.setTimeout(() => {
      setLockedFolderUnlocked(false);
      showToast('Locked Folder automatically locked after inactivity.');
    }, minutes * 60 * 1000);

    const resetTimer = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setLockedFolderUnlocked(false);
        showToast('Locked Folder automatically locked after inactivity.');
      }, minutes * 60 * 1000);
    };

    window.addEventListener('pointerdown', resetTimer);
    window.addEventListener('keydown', resetTimer);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', resetTimer);
      window.removeEventListener('keydown', resetTimer);
    };
  }, [lockedFolderUnlocked, showToast]);

  const handleLockVault = useCallback(() => {
    if (!loadEncryptedVaultEnvelope()) {
      showToast('Set a master passphrase in Settings first to enable vault lock.');
      return;
    }
    tgClient.lockSession();
    setSession(null);
    setLiveConnected(false);
    setVaultLocked(true);
    showToast('Telegram session vault locked.');
  }, [showToast]);

  // Global ⌘K / Ctrl+K shortcut for search bar & Ctrl+L / Cmd+L for vault lock
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l' && session) {
        if (loadEncryptedVaultEnvelope()) {
          e.preventDefault();
          handleLockVault();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session, handleLockVault]);

  // Live Dexie queries scoped strictly to active Telegram channel libraryId (never seeds fake items)
  const libraryId = session?.channelId || '';

  const allLibraryMedia = useLiveQuery(
    () =>
      libraryId
        ? db.media.where('libraryId').equals(libraryId).toArray()
        : Promise.resolve([] as MediaItem[]),
    [libraryId],
    [] as MediaItem[]
  );

  const allAlbums = useLiveQuery(
    () =>
      libraryId
        ? db.albums.where('libraryId').equals(libraryId).toArray()
        : Promise.resolve([] as AlbumItem[]),
    [libraryId],
    [] as AlbumItem[]
  );

  const allPeople = useLiveQuery(
    () =>
      libraryId
        ? db.personGroups.where('libraryId').equals(libraryId).toArray()
        : Promise.resolve([] as PersonGroup[]),
    [libraryId],
    [] as PersonGroup[]
  );

  // Derived partitions
  const activeMedia = useMemo(
    () => allLibraryMedia.filter((m) => !m.trashedAt && !m.isLocked),
    [allLibraryMedia]
  );

  const mainTimelineItems = useMemo(
    () => activeMedia.filter((m) => !m.isArchived),
    [activeMedia]
  );

  const lockedItems = useMemo(
    () => allLibraryMedia.filter((m) => !m.trashedAt && m.isLocked),
    [allLibraryMedia]
  );

  const trashedItems = useMemo(
    () => allLibraryMedia.filter((m) => Boolean(m.trashedAt)),
    [allLibraryMedia]
  );

  const totalUsedBytes = useMemo(
    () => allLibraryMedia.reduce((sum, item) => sum + (item.sizeBytes || 0), 0),
    [allLibraryMedia]
  );

  const quotaPercent = useMemo(() => {
    if (totalUsedBytes <= 0) return 0;
    const rawPct = (totalUsedBytes / STORAGE_QUOTA_DISPLAY_BYTES) * 100;
    return Math.min(100, Math.max(2.5, rawPct));
  }, [totalUsedBytes]);

  // Search filter
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    return activeMedia.filter((m) => {
      return (
        m.filename.toLowerCase().includes(q) ||
        (m.placeName && m.placeName.toLowerCase().includes(q)) ||
        (m.camera && m.camera.toLowerCase().includes(q)) ||
        (m.lens && m.lens.toLowerCase().includes(q)) ||
        m.albums.some((a) => a.toLowerCase().includes(q)) ||
        m.takenAt.toLowerCase().includes(q)
      );
    });
  }, [activeMedia, searchQuery]);

  const searchSuggestions = useMemo(() => {
    const places = Array.from(new Set(activeMedia.map((m) => m.placeName).filter(Boolean))) as string[];
    const cameras = Array.from(new Set(activeMedia.map((m) => m.camera).filter(Boolean))) as string[];
    return [
      ...places.slice(0, 3).map((p) => ({ label: p, kind: 'Place' })),
      ...cameras.slice(0, 2).map((c) => ({ label: c, kind: 'Camera' })),
    ];
  }, [activeMedia]);

  // Actions
  const handleSyncTelegram = async () => {
    if (!session) {
      setAuthModalOpen(true);
      return;
    }
    setSyncing(true);
    try {
      const res = await tgClient.syncRecentChannelMessages(60);
      setLiveConnected(true);
      showToast(
        res.syncedCount > 0
          ? `Synced ${res.syncedCount} ${res.syncedCount === 1 ? 'item' : 'items'} from ${session.channelTitle}.`
          : `${session.channelTitle} is up to date.`
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Telegram sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  const handleUploadFiles = async (
    files: File[],
    options: { album?: string; isLocked?: boolean }
  ) => {
    for (const file of files) {
      const jobId = `up_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setTransferJobs((prev) => [
        {
          id: jobId,
          filename: file.name,
          direction: 'upload',
          sizeBytes: file.size,
          progress: 5,
          status: 'queued',
          detail: 'Reading EXIF headers',
          startedAt: new Date().toISOString(),
        },
        ...prev,
      ]);

      try {
        await tgClient.uploadMediaItem(file, {
          albums: options.album ? [options.album] : [],
          isLocked: options.isLocked,
          onProgress: (pct, stage) => {
            setTransferJobs((prev) =>
              prev.map((j) =>
                j.id === jobId
                  ? {
                      ...j,
                      progress: pct,
                      status: pct >= 100 ? 'completed' : 'streaming',
                      detail: stage,
                    }
                  : j
              )
            );
          },
        });
      } catch (err) {
        setTransferJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? {
                  ...j,
                  status: 'error',
                  detail: err instanceof Error ? err.message : 'Upload failed',
                }
              : j
          )
        );
        throw err;
      }
    }
    showToast(
      `Uploaded ${files.length} uncompressed ${files.length === 1 ? 'master' : 'masters'} to Telegram.`
    );
  };

  const handleToggleFavorite = async (item: MediaItem) => {
    const nextFav = !item.isFavorite;
    await db.media.update(item.messageId, { isFavorite: nextFav });
    void tgClient.syncItemMetadataToTelegram({ ...item, isFavorite: nextFav });
    setViewerScope((prev) =>
      prev
        ? prev.map((x) => (x.messageId === item.messageId ? { ...x, isFavorite: nextFav } : x))
        : prev
    );
  };

  const handleToggleFavoriteBulk = useCallback(
    async (ids: number[], viaShortcut = false) => {
      if (ids.length === 0) return;
      const items = (await db.media.bulkGet(ids)).filter(Boolean) as MediaItem[];
      const anyUnfav = items.some((i) => !i.isFavorite);
      await Promise.all(
        items.map(async (item) => {
          await db.media.update(item.messageId, { isFavorite: anyUnfav });
          void tgClient.syncItemMetadataToTelegram({ ...item, isFavorite: anyUnfav });
        })
      );
      const unit = ids.length === 1 ? 'item' : 'items';
      const label = anyUnfav
        ? `Added ${ids.length} ${unit} to Favorites`
        : `Removed ${ids.length} ${unit} from Favorites`;
      if (viaShortcut) {
        triggerTactileFeedback({ keycap: 'F', label, kind: 'favorite' });
      } else {
        showToast(`${label}.`);
      }
    },
    [showToast, triggerTactileFeedback]
  );

  const handleToggleArchive = async (item: MediaItem) => {
    const nextArchived = !item.isArchived;
    await db.media.update(item.messageId, { isArchived: nextArchived });
    void tgClient.syncItemMetadataToTelegram({ ...item, isArchived: nextArchived });
    showToast(item.isArchived ? 'Moved back to Photos.' : 'Moved to Archive.');
    setViewerActiveId(null);
  };

  const handleArchiveBulk = useCallback(
    async (ids: number[], viaShortcut = false) => {
      if (ids.length === 0) return;
      const items = (await db.media.bulkGet(ids)).filter(Boolean) as MediaItem[];
      const shouldArchive = items.some((i) => !i.isArchived);
      await Promise.all(
        items.map(async (item) => {
          await db.media.update(item.messageId, { isArchived: shouldArchive });
          void tgClient.syncItemMetadataToTelegram({ ...item, isArchived: shouldArchive });
        })
      );
      const unit = ids.length === 1 ? 'item' : 'items';
      const label = shouldArchive
        ? `Archived ${ids.length} ${unit}`
        : `Unarchived ${ids.length} ${unit}`;
      if (viaShortcut) {
        triggerTactileFeedback({ keycap: 'A', label, kind: 'archive' });
      } else {
        showToast(`${label}.`);
      }
    },
    [showToast, triggerTactileFeedback]
  );

  const handleToggleLock = async (item: MediaItem) => {
    const nextLocked = !item.isLocked;
    await db.media.update(item.messageId, { isLocked: nextLocked });
    showToast(item.isLocked ? 'Moved out of Locked Folder.' : 'Moved to AES-256-GCM Locked Folder.');
    setViewerActiveId(null);
  };

  const handleLockBulk = async (ids: number[]) => {
    await Promise.all(ids.map((id) => db.media.update(id, { isLocked: true })));
    showToast(`Moved ${ids.length} items into Locked Folder.`);
  };

  const handleDelete = async (item: MediaItem) => {
    if (item.trashedAt) {
      await tgClient.deleteMessagesFromTelegram([item.messageId]);
      await db.media.delete(item.messageId);
      showToast('Permanently deleted item from Telegram and local index.');
    } else {
      await db.media.update(item.messageId, { trashedAt: new Date().toISOString() });
      showToast('Moved to Trash.');
    }
    setViewerActiveId(null);
  };

  const handleDeleteBulk = useCallback(
    async (ids: number[], viaShortcut = false) => {
      if (ids.length === 0) return;
      const now = new Date().toISOString();
      await Promise.all(ids.map((id) => db.media.update(id, { trashedAt: now })));
      const unit = ids.length === 1 ? 'item' : 'items';
      const label = `Moved ${ids.length} ${unit} to Trash`;
      if (viaShortcut) {
        triggerTactileFeedback({ keycap: 'Del', label, kind: 'delete' });
      } else {
        showToast(`${label}.`);
      }
    },
    [showToast, triggerTactileFeedback]
  );

  // Global keyboard shortcuts for selected gallery items: A, F, Delete, Escape
  const isAnyModalOpen =
    onboardingOpen ||
    uploadModalOpen ||
    authModalOpen ||
    rebuildModalOpen ||
    settingsModalOpen ||
    transfersModalOpen ||
    storageModalOpen ||
    vaultLocked ||
    mobileDrawerOpen ||
    Boolean(albumAssignIds && albumAssignIds.length > 0);
  const isLightboxOpen = viewerActiveId !== null;
  const selectionSize = selectedIds.size;

  useEffect(() => {
    if (selectionSize === 0 || isAnyModalOpen || isLightboxOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const action = resolveGalleryShortcut(e, {
        hasSelection: selectedIds.size > 0,
        isModalOpen: isAnyModalOpen,
        isLightboxOpen,
        isEditable: isEditableElement(e.target),
      });
      if (!action) return;

      e.preventDefault();
      const ids = Array.from(selectedIds);

      if (action === 'favorite') {
        void handleToggleFavoriteBulk(ids, true);
      } else if (action === 'archive') {
        void handleArchiveBulk(ids, true);
        if (clearSelectTimerRef.current !== null) {
          window.clearTimeout(clearSelectTimerRef.current);
        }
        clearSelectTimerRef.current = window.setTimeout(() => {
          setSelectedIds(new Set());
        }, 140);
      } else if (action === 'delete') {
        void handleDeleteBulk(ids, true);
        if (clearSelectTimerRef.current !== null) {
          window.clearTimeout(clearSelectTimerRef.current);
        }
        clearSelectTimerRef.current = window.setTimeout(() => {
          setSelectedIds(new Set());
        }, 140);
      } else if (action === 'clear-selection') {
        setSelectedIds(new Set());
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    selectionSize,
    selectedIds,
    isAnyModalOpen,
    isLightboxOpen,
    handleToggleFavoriteBulk,
    handleArchiveBulk,
    handleDeleteBulk,
  ]);

  const handleRestoreTrash = async (ids: number[]) => {
    await Promise.all(ids.map((id) => db.media.update(id, { trashedAt: undefined })));
    showToast(`Restored ${ids.length} items from Trash.`);
  };

  const handleAssignAlbum = async (albumName: string) => {
    if (!albumAssignIds || albumAssignIds.length === 0 || !libraryId) return;
    const existingAlbum = allAlbums.find(
      (a) => a.name.toLowerCase() === albumName.toLowerCase()
    );
    if (!existingAlbum) {
      await db.albums.add({
        name: albumName,
        coverMediaId: albumAssignIds[0],
        createdAt: new Date().toISOString(),
        libraryId,
      });
    }
    const targets = await db.media.bulkGet(albumAssignIds);
    await Promise.all(
      targets.map(async (item) => {
        if (!item) return;
        const nextAlbums = Array.from(new Set([...(item.albums || []), albumName]));
        await db.media.update(item.messageId, { albums: nextAlbums });
        void tgClient.syncItemMetadataToTelegram({ ...item, albums: nextAlbums });
      })
    );
    showToast(`Added ${albumAssignIds.length} items to "${albumName}".`);
    setAlbumAssignIds(null);
  };

  const handleDownloadOriginal = async (item: MediaItem) => {
    try {
      const url = await tgClient.downloadMediaChunked(item);
      const a = document.createElement('a');
      a.href = url;
      a.download = item.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast(`Downloading original master: ${item.filename}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Download failed.');
    }
  };

  const handleDownloadZipBulk = async (ids: number[]) => {
    const jobId = `zip_${Date.now()}`;
    setTransferJobs((prev) => [
      {
        id: jobId,
        filename: `framely-export-${ids.length}-items.zip`,
        direction: 'download',
        sizeBytes: 0,
        progress: 15,
        status: 'streaming',
        detail: 'Streaming original masters from Telegram',
        startedAt: new Date().toISOString(),
      },
      ...prev,
    ]);
    try {
      const zip = new JSZip();
      const items = (await db.media.bulkGet(ids)).filter(Boolean) as MediaItem[];
      let done = 0;
      for (const item of items) {
        const src = await tgClient.downloadMediaChunked(item);
        const resp = await fetch(src);
        const blob = await resp.blob();
        zip.file(item.filename, blob);
        done += 1;
        setTransferJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? { ...j, progress: Math.round(15 + (done / items.length) * 70) }
              : j
          )
        );
      }
      const archiveBlob = await zip.generateAsync({ type: 'blob' });
      const blobUrl = URL.createObjectURL(archiveBlob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `framely-export-${items.length}-masters.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);

      setTransferJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? {
                ...j,
                progress: 100,
                sizeBytes: archiveBlob.size,
                status: 'completed',
                detail: 'ZIP download complete',
              }
            : j
        )
      );
      showToast(`Exported ${items.length} original masters as ZIP.`);
    } catch {
      setTransferJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, status: 'error', detail: 'ZIP export failed' } : j
        )
      );
      showToast('ZIP export encountered an error.');
    }
  };

  const openMediaViewer = (item: MediaItem, scope: MediaItem[]) => {
    setViewerScope(scope);
    setViewerActiveId(item.messageId);
  };

  const navigateSection = (section: GallerySection) => {
    setActiveSection(section);
    setSelectedAlbumName(null);
    setSelectedPersonId(null);
    setSearchQuery('');
    setSelectedIds(new Set());
    setMobileDrawerOpen(false);
  };

  const handleAuthenticatedSession = (next: TelegramSessionPayload, runInitialSync = true) => {
    setSession(next);
    setVaultLocked(false);
    setAuthModalOpen(false);
    setOnboardingOpen(false);
    showToast(`Connected to ${next.channelTitle} as ${next.displayName}.`);
    if (runInitialSync) {
      setSyncing(true);
      void tgClient
        .syncRecentChannelMessages(60)
        .then((res) => {
          if (res.syncedCount > 0) {
            showToast(`Indexed ${res.syncedCount} existing media items from Telegram.`);
          }
        })
        .catch(() => {})
        .finally(() => setSyncing(false));
    }
  };

  const handleLoggedOut = () => {
    setSession(null);
    setLiveConnected(false);
    setVaultLocked(false);
    setSelectedIds(new Set());
    setViewerActiveId(null);
    showToast('Signed out of Telegram.');
  };

  // Sidebar navigation definitions
  const primaryNav: Array<{ id: GallerySection; label: string; Icon: React.ElementType }> = [
    { id: 'photos', label: 'Photos', Icon: ImageIcon },
    { id: 'explore', label: 'Explore', Icon: Compass },
    { id: 'sharing', label: 'Sharing', Icon: Share2 },
  ];

  const collectionsNav: Array<{
    id: GallerySection;
    label: string;
    Icon: React.ElementType;
    badge?: number;
  }> = [
    { id: 'albums', label: 'Albums', Icon: FolderHeart, badge: allAlbums.length },
    {
      id: 'documents',
      label: 'Documents',
      Icon: FileText,
      badge: activeMedia.filter((m) => m.category === 'document').length,
    },
    {
      id: 'screenshots',
      label: 'Screenshots & recordings',
      Icon: Smartphone,
    },
    {
      id: 'favorites',
      label: 'Favorites',
      Icon: Heart,
      badge: activeMedia.filter((m) => m.isFavorite).length,
    },
    { id: 'people', label: 'People & pets', Icon: Users },
    { id: 'places', label: 'Places', Icon: MapPin },
    {
      id: 'videos',
      label: 'Videos',
      Icon: Film,
      badge: activeMedia.filter((m) => m.kind === 'video').length,
    },
    { id: 'recent', label: 'Recently added', Icon: Clock },
    { id: 'archive', label: 'Archive', Icon: Archive },
    { id: 'locked', label: 'Locked Folder', Icon: Lock, badge: lockedItems.length },
    { id: 'trash', label: 'Trash', Icon: Trash2, badge: trashedItems.length },
  ];

  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;

  const accountInitials = useMemo(() => {
    if (!session) return 'TG';
    const clean = (session.displayName || session.username || 'TG').replace(/^@/, '').trim();
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return clean.slice(0, 2).toUpperCase() || 'TG';
  }, [session]);

  const sharedTimelineProps = {
    density,
    onDensityChange: setDensity,
    onOpenMedia: openMediaViewer,
    onToggleFavoriteBulk: (ids: number[]) => handleToggleFavoriteBulk(ids, false),
    onDeleteBulk: (ids: number[]) => handleDeleteBulk(ids, false),
    onArchiveBulk: (ids: number[]) => handleArchiveBulk(ids, false),
    onLockBulk: handleLockBulk,
    onDownloadZipBulk: handleDownloadZipBulk,
    onOpenAddToAlbum: (ids: number[]) => setAlbumAssignIds(ids),
    onTriggerUpload: () => {
      setUploadDefaultLocked(false);
      setUploadModalOpen(true);
    },
    selectedIds,
    onSelectedIdsChange: setSelectedIds,
    activeShortcutPulse,
  };

  // Unauthenticated Real-Telegram Connect Workspace (Zero Placeholder Photos)
  const renderUnauthenticatedState = () => (
    <div className="px-4 sm:px-8 py-10 sm:py-16 max-w-3xl mx-auto">
      <div className="rounded-3xl border border-slate-200 dark:border-zinc-800 bg-[#F8FAFD] dark:bg-[#1E1F20] p-6 sm:p-10 text-center space-y-6">
        <div className="flex flex-col items-center gap-3">
          <FramelyLogo size={44} />
          <h1 className="font-[family-name:var(--font-jakarta)] text-2xl sm:text-3xl font-bold tracking-tight text-[#1F1F1F] dark:text-zinc-100">
            Connect Your Telegram Cloud
          </h1>
          <p className="text-sm text-[#5F6368] dark:text-zinc-300 max-w-lg leading-relaxed">
            Sign in directly with your mobile phone number &amp; Telegram OTP—or scan a live QR code. No API secrets or developer tokens required. Framely automatically creates your private lossless photo channel and syncs in real time.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-1">
          <button
            type="button"
            onClick={() => setAuthModalOpen(true)}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] text-white px-6 py-3 text-sm font-semibold shadow-sm transition-colors"
          >
            <Smartphone className="w-4 h-4" />
            Sign In with Mobile Phone / QR
          </button>
          <button
            type="button"
            onClick={() => setOnboardingOpen(true)}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-slate-50 dark:hover:bg-zinc-800 text-[#1F1F1F] dark:text-zinc-100 px-6 py-3 text-sm font-semibold transition-colors"
          >
            <QrCode className="w-4 h-4 text-[#0B57D0] dark:text-[#A8C7FA]" />
            Guided Setup Wizard
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4 text-left">
          <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 p-4 space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#0B57D0] dark:text-[#A8C7FA]">
              <Smartphone className="w-4 h-4" />
              Zero Secrets Needed
            </div>
            <p className="text-xs text-[#5F6368] dark:text-zinc-400 leading-relaxed">
              Just enter your mobile number for an instant 5-digit Telegram OTP, or scan the live QR code.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 p-4 space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#0B57D0] dark:text-[#A8C7FA]">
              <Upload className="w-4 h-4" />
              Lossless up to 2 GB
            </div>
            <p className="text-xs text-[#5F6368] dark:text-zinc-400 leading-relaxed">
              Uploads uncompressed RAW masters &amp; 4K videos via 128 KB MTProto chunks with full EXIF intact.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 p-4 space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#0B57D0] dark:text-[#A8C7FA]">
              <ShieldCheck className="w-4 h-4" />
              Direct Browser WSS
            </div>
            <p className="text-xs text-[#5F6368] dark:text-zinc-400 leading-relaxed">
              Encrypted end-to-end between your browser and Telegram datacenters with optional AES-256-GCM lock.
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  const renderMainContent = () => {
    if (!session) {
      return renderUnauthenticatedState();
    }

    if (searchResults !== null) {
      return (
        <TimelineView
          title={`Search: "${searchQuery}"`}
          subtitle="Instant client-side IndexedDB query"
          items={searchResults}
          emptyTitle="No matching photos"
          emptySubtitle="Try searching by filename, camera model, place name, or album."
          {...sharedTimelineProps}
        />
      );
    }

    switch (activeSection) {
      case 'photos':
        return (
          <TimelineView
            items={mainTimelineItems}
            showMemories
            emptyTitle={`Your ${session.channelTitle} is ready`}
            emptySubtitle="Upload uncompressed photos or videos up to 2 GB, or tap Rebuild Index to scan media already stored in your Telegram channel."
            {...sharedTimelineProps}
          />
        );

      case 'places':
        return <PlacesView items={activeMedia} onOpenMedia={openMediaViewer} />;

      case 'locked':
        return (
          <LockedFolderView
            lockedItems={lockedItems}
            isUnlocked={lockedFolderUnlocked}
            onUnlockChange={setLockedFolderUnlocked}
            onOpenMedia={openMediaViewer}
            onMoveOutOfLocked={async (id) => {
              await db.media.update(id, { isLocked: false });
              showToast('Moved item back to main Photos timeline.');
            }}
            onTriggerLockedUpload={() => {
              setUploadDefaultLocked(true);
              setUploadModalOpen(true);
            }}
          />
        );

      case 'albums': {
        if (selectedAlbumName) {
          const albumItems = activeMedia.filter((m) => m.albums.includes(selectedAlbumName));
          return (
            <div>
              <div className="px-4 sm:px-7 pt-5">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedAlbumName(null);
                    setSelectedIds(new Set());
                  }}
                  className="text-xs font-semibold text-[#0B57D0] dark:text-[#A8C7FA] hover:underline"
                >
                  ← Back to All Albums
                </button>
              </div>
              <TimelineView
                title={selectedAlbumName}
                subtitle="Private album synchronized via Telegram Schema v1 captions"
                items={albumItems}
                {...sharedTimelineProps}
              />
            </div>
          );
        }

        return (
          <div className="px-4 sm:px-8 py-6 max-w-[1440px] mx-auto">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-[#1F1F1F] dark:text-zinc-100">
                  Albums
                </h1>
                <p className="text-sm text-[#5F6368] dark:text-zinc-400 mt-0.5">
                  Multi-entry indexed albums synchronized via structured Telegram captions.
                </p>
              </div>
            </div>

            {allAlbums.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-[#F8FAFD] dark:bg-zinc-900/40 p-10 text-center space-y-2">
                <FolderHeart className="w-8 h-8 text-slate-400 mx-auto" />
                <p className="text-sm font-semibold text-[#1F1F1F] dark:text-zinc-100">
                  No albums yet
                </p>
                <p className="text-xs text-[#5F6368] dark:text-zinc-400 max-w-sm mx-auto">
                  Select any photos in your timeline and choose &quot;Add to album&quot; to organize them. Album tags sync directly to your Telegram captions.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
                {allAlbums.map((album) => {
                  const itemsInAlbum = activeMedia.filter((m) => m.albums.includes(album.name));
                  const cover =
                    activeMedia.find((m) => m.messageId === album.coverMediaId) ||
                    itemsInAlbum[0];
                  return (
                    <button
                      key={album.id ?? album.name}
                      type="button"
                      onClick={() => setSelectedAlbumName(album.name)}
                      className="group text-left focus-visible:outline-2 focus-visible:outline-[#0B57D0] rounded-2xl"
                    >
                      <div className="aspect-[4/3] rounded-2xl overflow-hidden bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800">
                        {cover ? (
                          <img
                            src={cover.thumbnailDataUrl || cover.fullUrl}
                            alt={album.name}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-400">
                            <FolderHeart className="w-8 h-8" />
                          </div>
                        )}
                      </div>
                      <h2 className="text-sm font-semibold text-[#1F1F1F] dark:text-zinc-100 mt-2.5 truncate">
                        {album.name}
                      </h2>
                      <p className="text-xs text-[#5F6368] dark:text-zinc-400 tabular-nums">
                        {itemsInAlbum.length} {itemsInAlbum.length === 1 ? 'item' : 'items'}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      }

      case 'people': {
        if (selectedPersonId) {
          const person = allPeople.find((p) => p.id === selectedPersonId);
          const personItems = activeMedia.filter(
            (m) => m.personIds?.includes(selectedPersonId) || person?.mediaIds.includes(m.messageId)
          );
          return (
            <div>
              <div className="px-4 sm:px-7 pt-5">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPersonId(null);
                    setSelectedIds(new Set());
                  }}
                  className="text-xs font-semibold text-[#0B57D0] dark:text-[#A8C7FA] hover:underline"
                >
                  ← Back to People &amp; pets
                </button>
              </div>
              <TimelineView
                title={person?.name || 'Person'}
                subtitle="Private on-device face & pet grouping"
                items={personItems}
                {...sharedTimelineProps}
              />
            </div>
          );
        }

        return (
          <div className="px-4 sm:px-8 py-6 max-w-[1440px] mx-auto">
            <h1 className="text-2xl font-bold tracking-tight text-[#1F1F1F] dark:text-zinc-100">
              People &amp; pets
            </h1>
            <p className="text-sm text-[#5F6368] dark:text-zinc-400 mt-1 mb-7">
              Curated locally inside your browser IndexedDB — never sent to cloud facial recognition APIs.
            </p>
            {allPeople.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-[#F8FAFD] dark:bg-zinc-900/40 p-10 text-center space-y-2">
                <Users className="w-8 h-8 text-slate-400 mx-auto" />
                <p className="text-sm font-semibold text-[#1F1F1F] dark:text-zinc-100">
                  No people groups indexed yet
                </p>
                <p className="text-xs text-[#5F6368] dark:text-zinc-400 max-w-sm mx-auto">
                  Upload portraits to your Telegram channel to begin local on-device grouping.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
                {allPeople.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => setSelectedPersonId(person.id)}
                    className="group flex flex-col items-center text-center focus-visible:outline-2 focus-visible:outline-[#0B57D0] rounded-2xl p-2"
                  >
                    <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-full overflow-hidden border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-900">
                      <img
                        src={person.faceUrl}
                        alt={person.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    </div>
                    <p className="text-sm font-semibold text-[#1F1F1F] dark:text-zinc-100 mt-3">
                      {person.name}
                    </p>
                    <p className="text-xs text-[#5F6368] dark:text-zinc-400 tabular-nums">
                      {person.role === 'pet' ? 'Pet' : 'Person'} · {person.count}{' '}
                      {person.count === 1 ? 'photo' : 'photos'}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      }

      case 'explore':
        return (
          <div className="px-4 sm:px-8 py-6 max-w-[1440px] mx-auto space-y-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-[#1F1F1F] dark:text-zinc-100">
                  Explore
                </h1>
                <p className="text-sm text-[#5F6368] dark:text-zinc-400 mt-1">
                  Browse your Telegram library by optics, destination, and lossless media format.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRebuildModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 dark:border-zinc-700 px-4 py-2 text-xs font-semibold text-[#0B57D0] dark:text-[#A8C7FA] hover:bg-[#F8FAFD] dark:hover:bg-zinc-800"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Rebuild Index
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                {
                  title: 'Places',
                  meta: 'Local GPS destinations',
                  section: 'places' as GallerySection,
                  cover: activeMedia.find((m) => m.placeName)?.thumbnailDataUrl || activeMedia[0]?.thumbnailDataUrl,
                },
                {
                  title: 'Favorites',
                  meta: `${activeMedia.filter((m) => m.isFavorite).length} starred masters`,
                  section: 'favorites' as GallerySection,
                  cover: activeMedia.find((m) => m.isFavorite)?.thumbnailDataUrl,
                },
                {
                  title: 'Documents',
                  meta: `${activeMedia.filter((m) => m.category === 'document').length} auto-categorized scans`,
                  section: 'documents' as GallerySection,
                  cover: activeMedia.find((m) => m.category === 'document')?.thumbnailDataUrl,
                },
                {
                  title: 'Videos',
                  meta: `${activeMedia.filter((m) => m.kind === 'video').length} uncompressed videos`,
                  section: 'videos' as GallerySection,
                  cover: activeMedia.find((m) => m.kind === 'video')?.thumbnailDataUrl,
                },
              ].map((card) => (
                <button
                  key={card.title}
                  type="button"
                  onClick={() => navigateSection(card.section)}
                  className="group relative aspect-[16/10] rounded-2xl overflow-hidden border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-900 text-left"
                >
                  {card.cover && (
                    <img
                      src={card.cover}
                      alt={card.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-4">
                    <p className="text-base font-bold text-white">{card.title}</p>
                    <p className="text-xs text-white/80">{card.meta}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );

      case 'sharing':
        return (
          <div className="px-4 sm:px-8 py-8 max-w-2xl mx-auto">
            <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-[#F8FAFD] dark:bg-[#1E1F20] p-6 sm:p-7 space-y-4">
              <div className="flex items-center gap-3">
                <Share2 className="w-5 h-5 text-[#0B57D0] dark:text-[#A8C7FA]" />
                <h1 className="text-xl font-bold tracking-tight text-[#1F1F1F] dark:text-zinc-100">
                  Zero-Knowledge Sharing
                </h1>
              </div>
              <p className="text-sm text-[#5F6368] dark:text-zinc-300 leading-relaxed">
                Your media lives exclusively inside your private Telegram Channel (<strong>{session.channelTitle}</strong>). To share an album privately with family, invite them directly to a private Telegram channel or export an uncompressed ZIP package from any selection.
              </p>
              <div className="flex flex-wrap gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => navigateSection('photos')}
                  className="rounded-full bg-[#0B57D0] hover:bg-[#0842A0] text-white px-4 py-2 text-xs font-semibold transition-colors"
                >
                  Select Photos to Export ZIP
                </button>
                <button
                  type="button"
                  onClick={() => setAuthModalOpen(true)}
                  className="rounded-full border border-slate-300 dark:border-zinc-700 px-4 py-2 text-xs font-semibold text-[#1F1F1F] dark:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  Manage Telegram Account
                </button>
              </div>
            </div>
          </div>
        );

      case 'documents':
        return (
          <TimelineView
            title="Documents"
            subtitle="Auto-categorized architectural scans, PDFs, and high-res documents"
            items={activeMedia.filter((m) => m.category === 'document')}
            {...sharedTimelineProps}
          />
        );

      case 'screenshots':
        return (
          <TimelineView
            title="Screenshots & recordings"
            subtitle="Desktop captures and screen recordings separated from camera roll"
            items={activeMedia.filter((m) => m.category === 'screenshot')}
            {...sharedTimelineProps}
          />
        );

      case 'favorites':
        return (
          <TimelineView
            title="Favorites"
            subtitle="Starred bit-for-bit original masters synced to Telegram captions"
            items={activeMedia.filter((m) => m.isFavorite)}
            {...sharedTimelineProps}
          />
        );

      case 'videos':
        return (
          <TimelineView
            title="Videos"
            subtitle="Streamed via 4 concurrent MTProto chunk workers (up to 2,048 MB)"
            items={activeMedia.filter((m) => m.kind === 'video')}
            {...sharedTimelineProps}
          />
        );

      case 'recent':
        return (
          <TimelineView
            title="Recently added"
            subtitle="Sorted by Telegram channel upload timestamp"
            items={[...activeMedia].sort(
              (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
            )}
            {...sharedTimelineProps}
          />
        );

      case 'archive':
        return (
          <TimelineView
            title="Archive"
            subtitle="Hidden from your main Photos timeline"
            items={activeMedia.filter((m) => m.isArchived)}
            isArchiveView
            {...sharedTimelineProps}
          />
        );

      case 'trash':
        return (
          <div className="px-4 sm:px-8 py-6 max-w-[1440px] mx-auto">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-[#1F1F1F] dark:text-zinc-100">
                  Trash
                </h1>
                <p className="text-sm text-[#5F6368] dark:text-zinc-400 mt-0.5">
                  Restore deleted masters or permanently remove them from Telegram and this index.
                </p>
              </div>
              {trashedItems.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleRestoreTrash(trashedItems.map((t) => t.messageId))}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 dark:border-zinc-700 px-4 py-2 text-xs font-semibold text-[#1F1F1F] dark:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Restore All
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const ids = trashedItems.map((t) => t.messageId);
                      await tgClient.deleteMessagesFromTelegram(ids);
                      await db.media.bulkDelete(ids);
                      showToast('Permanently deleted items from Telegram and Trash.');
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full bg-red-600 hover:bg-red-700 px-4 py-2 text-xs font-semibold text-white"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Empty Trash
                  </button>
                </div>
              )}
            </div>
            {trashedItems.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-[#F8FAFD] dark:bg-zinc-900/50 p-12 text-center">
                <Trash2 className="w-8 h-8 text-slate-400 mx-auto mb-2.5" />
                <p className="text-sm font-semibold text-[#1F1F1F] dark:text-zinc-100">
                  Trash is empty
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
                {trashedItems.map((item) => (
                  <div
                    key={item.messageId}
                    className="rounded-xl overflow-hidden border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
                  >
                    <div className="aspect-square bg-slate-100 dark:bg-zinc-800">
                      <img
                        src={item.thumbnailDataUrl || item.fullUrl}
                        alt={item.filename}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover opacity-75"
                      />
                    </div>
                    <div className="p-2 flex items-center justify-between gap-1">
                      <button
                        type="button"
                        onClick={() => handleRestoreTrash([item.messageId])}
                        className="text-[11px] font-semibold text-[#0B57D0] dark:text-[#A8C7FA] hover:underline"
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(item)}
                        className="text-[11px] font-semibold text-red-600 dark:text-red-400 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
    }
  };

  // Shared sidebar nav list used in both Desktop Left Rail and Mobile Slide-Out Drawer
  const renderNavSections = () => (
    <>
      <nav aria-label="Primary sections" className="space-y-0.5">
        {primaryNav.map(({ id, label, Icon }) => {
          const active = activeSection === id && !searchResults;
          return (
            <button
              key={id}
              type="button"
              onClick={() => navigateSection(id)}
              aria-current={active ? 'page' : undefined}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 lg:py-2 rounded-full text-sm font-medium transition-colors ${
                active
                  ? 'bg-[#D3E3FD] dark:bg-[#004A77] text-[#0B57D0] dark:text-[#C2E7FF] font-semibold'
                  : 'text-[#444746] dark:text-zinc-300 hover:bg-[#F8FAFD] dark:hover:bg-zinc-900'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </nav>

      <div>
        <p className="px-3.5 mb-1 text-[11px] font-semibold text-[#5F6368] dark:text-zinc-500">
          Collections
        </p>
        <nav aria-label="Collections" className="space-y-0.5">
          {collectionsNav.map(({ id, label, Icon, badge }) => {
            const active = activeSection === id && !searchResults;
            return (
              <button
                key={id}
                type="button"
                onClick={() => navigateSection(id)}
                aria-current={active ? 'page' : undefined}
                className={`w-full flex items-center justify-between gap-2 px-3.5 py-2 lg:py-1.5 rounded-full text-[13px] font-medium transition-colors ${
                  active
                    ? 'bg-[#D3E3FD] dark:bg-[#004A77] text-[#0B57D0] dark:text-[#C2E7FF] font-semibold'
                    : 'text-[#444746] dark:text-zinc-300 hover:bg-[#F8FAFD] dark:hover:bg-zinc-900'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{label}</span>
                </span>
                {typeof badge === 'number' && badge > 0 && (
                  <span className="text-[11px] font-mono tabular-nums text-[#5F6368] dark:text-zinc-400">
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </>
  );

  return (
    <div className="min-h-screen lg:h-screen lg:overflow-hidden flex flex-col bg-white dark:bg-[#131314] text-[#1F1F1F] dark:text-zinc-100">
      {/* Single-Tab MTProto Protection Warning Banner */}
      {tabConflict && (
        <div
          role="alert"
          className="bg-amber-50 dark:bg-amber-950/60 border-b border-amber-300 dark:border-amber-800 px-4 py-2 text-xs text-amber-900 dark:text-amber-200 flex flex-wrap items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              Another Framely tab is active. Single-Tab MTProto Protection paused duplicate WebSocket requests.
            </span>
          </div>
          <button
            type="button"
            onClick={() => tabGuardRef.current?.takeOver()}
            className="rounded-full bg-amber-600 hover:bg-amber-700 text-white px-3 py-1 text-[11px] font-semibold whitespace-nowrap"
          >
            Use This Tab
          </button>
        </div>
      )}

      {/* Responsive Header (Desktop + Mobile) */}
      <header className="sticky top-0 z-30 h-16 shrink-0 bg-white/95 dark:bg-[#131314]/95 backdrop-blur-md border-b border-slate-200/80 dark:border-zinc-800/80 px-2.5 sm:px-5 flex items-center justify-between gap-2 sm:gap-5">
        {/* Left: Mobile Drawer Trigger + Pure Freestanding Logo */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setMobileDrawerOpen(true)}
            aria-label="Open navigation menu"
            className="lg:hidden w-9 h-9 rounded-full flex items-center justify-center text-[#5F6368] dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 shrink-0"
          >
            <Menu className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={onReturnToLanding}
            aria-label="Framely — return to landing page"
            className="flex items-center gap-2 shrink-0 focus-visible:outline-2 focus-visible:outline-[#0B57D0] rounded-lg py-1"
          >
            <FramelyLogo size={26} />
            <span className="hidden sm:inline font-[family-name:var(--font-jakarta)] text-xl font-bold tracking-tight text-[#1F1F1F] dark:text-zinc-100 whitespace-nowrap">
              Framely
            </span>
          </button>
        </div>

        {/* Center: Google Photos Search Pill with ⌘K badge */}
        <div className="relative flex-1 min-w-0 max-w-2xl">
          <div
            className={`flex items-center gap-2 rounded-full px-3 sm:px-4 h-10 sm:h-11 transition-all border ${
              searchFocused
                ? 'bg-white dark:bg-[#1E1F20] border-[#0B57D0] dark:border-[#A8C7FA] shadow-sm'
                : 'bg-[#F8FAFD] dark:bg-[#1E1F20] border-transparent hover:bg-slate-100 dark:hover:bg-[#282A2C]'
            }`}
          >
            <Search className="w-4 h-4 text-[#5F6368] dark:text-zinc-400 shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 160)}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSelectedIds(new Set());
              }}
              placeholder="Search photos, places..."
              aria-label="Search your photos"
              className="w-full min-w-0 bg-transparent text-sm text-[#1F1F1F] dark:text-zinc-100 placeholder:text-[#5F6368] dark:placeholder:text-zinc-500 focus:outline-none"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedIds(new Set());
                }}
                aria-label="Clear search"
                className="p-1 text-slate-500 hover:text-slate-800 dark:text-zinc-400"
              >
                <X className="w-4 h-4" />
              </button>
            ) : (
              <kbd className="hidden sm:inline-flex items-center rounded-md border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-1.5 py-0.5 text-[11px] font-mono text-slate-500 dark:text-zinc-400 shrink-0">
                ⌘K
              </kbd>
            )}
          </div>

          {searchFocused && !searchQuery && searchSuggestions.length > 0 && (
            <div className="absolute inset-x-0 top-12 z-40 rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#1E1F20] shadow-xl p-2 space-y-0.5">
              <p className="px-3 py-1.5 text-[11px] font-semibold text-[#5F6368] dark:text-zinc-400">
                Quick filters in your vault
              </p>
              {searchSuggestions.map((s) => (
                <button
                  key={`${s.kind}-${s.label}`}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setSearchQuery(s.label);
                  }}
                  className="w-full flex items-center justify-between rounded-xl px-3 py-2 text-xs text-left hover:bg-[#F8FAFD] dark:hover:bg-zinc-800 transition-colors"
                >
                  <span className="font-medium text-[#1F1F1F] dark:text-zinc-100">{s.label}</span>
                  <span className="text-[11px] text-[#5F6368] dark:text-zinc-400">{s.kind}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: Quick Action Controls */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              setUploadDefaultLocked(false);
              setUploadModalOpen(true);
            }}
            aria-label="Upload photos or videos"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] text-white px-3.5 h-9 text-xs font-semibold transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Upload</span>
          </button>

          <button
            type="button"
            onClick={handleSyncTelegram}
            disabled={syncing}
            aria-label="Sync Telegram Channel"
            title={session ? `Sync ${session.channelTitle}` : 'Connect Telegram to Sync'}
            className="relative flex w-9 h-9 rounded-full items-center justify-center text-[#5F6368] dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin text-[#0B57D0]' : ''}`} />
            {liveConnected && (
              <span
                aria-hidden="true"
                className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-[#131314]"
              />
            )}
          </button>

          <button
            type="button"
            onClick={() => setTransfersModalOpen(true)}
            aria-label="Open Transfers Activity"
            title="Transfers"
            className="hidden sm:flex relative w-9 h-9 rounded-full items-center justify-center text-[#5F6368] dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <ArrowUpDown className="w-4 h-4" />
            {transferJobs.some((j) => j.status === 'streaming') && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#0B57D0]" />
            )}
          </button>

          <button
            type="button"
            onClick={onCycleTheme}
            aria-label={`Switch theme (current: ${theme})`}
            title={`Theme: ${theme}`}
            className="hidden sm:flex w-9 h-9 rounded-full items-center justify-center text-[#5F6368] dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <ThemeIcon className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setSettingsModalOpen(true)}
            aria-label="Vault settings"
            title="Settings"
            className="hidden sm:flex w-9 h-9 rounded-full items-center justify-center text-[#5F6368] dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setAuthModalOpen(true)}
            aria-label={session ? `Telegram account ${session.displayName}` : 'Sign in with Telegram'}
            title={session ? `Connected: ${session.displayName}` : 'Sign in with Telegram'}
            className={`ml-0.5 w-9 h-9 rounded-full font-bold text-xs flex items-center justify-center hover:ring-2 hover:ring-[#0B57D0]/40 transition-all shrink-0 ${
              session
                ? 'bg-[#0B57D0] text-white'
                : 'bg-[#D3E3FD] dark:bg-[#004A77] text-[#0B57D0] dark:text-[#A8C7FA]'
            }`}
          >
            {accountInitials}
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex-1 flex min-h-0">
        {/* Desktop Left Sidebar (>= 1024px) */}
        <aside
          aria-label="Library navigation"
          className="hidden lg:flex w-64 shrink-0 flex-col border-r border-slate-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#131314] px-3 py-3 overflow-hidden"
        >
          <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar space-y-3.5 pr-0.5">
            {renderNavSections()}
          </div>

          {/* Storage & Rebuild Index Widget */}
          <div className="shrink-0 mt-3 pt-3 border-t border-slate-200 dark:border-zinc-800 px-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs font-semibold text-[#1F1F1F] dark:text-zinc-200">
              <span className="flex items-center gap-2">
                <Cloud className="w-3.5 h-3.5 text-[#0B57D0] dark:text-[#A8C7FA]" />
                Storage
              </span>
              {session && (
                <button
                  type="button"
                  onClick={() => setRebuildModalOpen(true)}
                  className="text-[11px] font-medium text-[#0B57D0] dark:text-[#A8C7FA] hover:underline"
                >
                  Rebuild
                </button>
              )}
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-zinc-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#0B57D0] via-[#4285F4] to-[#34A853]"
                style={{ width: `${quotaPercent}%` }}
              />
            </div>
            <p className="text-xs text-[#5F6368] dark:text-zinc-400 font-mono tabular-nums">
              {formatBytes(totalUsedBytes)} · Unlimited Cloud
            </p>
            <button
              type="button"
              onClick={() => setStorageModalOpen(true)}
              className="w-full rounded-full border border-slate-300 dark:border-zinc-700 py-1.5 text-xs font-semibold text-[#0B57D0] dark:text-[#A8C7FA] hover:bg-[#F8FAFD] dark:hover:bg-zinc-900 transition-colors"
            >
              Channel Storage Details
            </button>
          </div>
        </aside>

        {/* Main Gallery Stage */}
        <main className="flex-1 min-w-0 overflow-y-auto bg-white dark:bg-[#131314] pb-28 lg:pb-0">
          {renderMainContent()}
        </main>
      </div>

      {/* Mobile Slide-Out Navigation Drawer (< 1024px) */}
      <AnimatePresence>
        {mobileDrawerOpen && (
          <div className="lg:hidden fixed inset-0 z-50 flex">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileDrawerOpen(false)}
              className="fixed inset-0 bg-black/50 backdrop-blur-xs"
            />
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label="Mobile library menu"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 360, damping: 34 }}
              className="relative z-10 w-[82vw] max-w-[300px] h-full bg-white dark:bg-[#131314] border-r border-slate-200 dark:border-zinc-800 flex flex-col shadow-2xl"
            >
              <div className="h-16 px-4 border-b border-slate-200 dark:border-zinc-800 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <FramelyLogo size={24} />
                  <span className="font-[family-name:var(--font-jakarta)] text-lg font-bold tracking-tight text-[#1F1F1F] dark:text-zinc-100">
                    Framely
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileDrawerOpen(false)}
                  aria-label="Close navigation menu"
                  className="w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
                {/* Account Status Card */}
                <button
                  type="button"
                  onClick={() => {
                    setMobileDrawerOpen(false);
                    setAuthModalOpen(true);
                  }}
                  className="w-full rounded-2xl border border-slate-200 dark:border-zinc-800 bg-[#F8FAFD] dark:bg-zinc-900 p-3 text-left flex items-center gap-3"
                >
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                      session
                        ? 'bg-[#0B57D0] text-white'
                        : 'bg-[#D3E3FD] dark:bg-[#004A77] text-[#0B57D0] dark:text-[#A8C7FA]'
                    }`}
                  >
                    {accountInitials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-[#1F1F1F] dark:text-zinc-100 truncate">
                      {session ? session.displayName : 'Sign In with Telegram'}
                    </p>
                    <p className="text-[11px] text-[#5F6368] dark:text-zinc-400 truncate">
                      {session ? session.channelTitle : 'Mobile Phone OTP or QR Code'}
                    </p>
                  </div>
                </button>

                {renderNavSections()}
              </div>

              {/* Mobile Drawer Quick Tools Footer */}
              <div className="p-3 border-t border-slate-200 dark:border-zinc-800 space-y-2 shrink-0">
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setMobileDrawerOpen(false);
                      setRebuildModalOpen(true);
                    }}
                    className="flex flex-col items-center justify-center gap-1 rounded-xl border border-slate-200 dark:border-zinc-800 py-2 text-[11px] font-medium text-[#1F1F1F] dark:text-zinc-200"
                  >
                    <RefreshCw className="w-4 h-4 text-[#0B57D0] dark:text-[#A8C7FA]" />
                    Rebuild
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileDrawerOpen(false);
                      setTransfersModalOpen(true);
                    }}
                    className="flex flex-col items-center justify-center gap-1 rounded-xl border border-slate-200 dark:border-zinc-800 py-2 text-[11px] font-medium text-[#1F1F1F] dark:text-zinc-200"
                  >
                    <ArrowUpDown className="w-4 h-4 text-[#0B57D0] dark:text-[#A8C7FA]" />
                    Transfers
                  </button>
                  <button
                    type="button"
                    onClick={onCycleTheme}
                    className="flex flex-col items-center justify-center gap-1 rounded-xl border border-slate-200 dark:border-zinc-800 py-2 text-[11px] font-medium text-[#1F1F1F] dark:text-zinc-200"
                  >
                    <ThemeIcon className="w-4 h-4 text-[#0B57D0] dark:text-[#A8C7FA]" />
                    Theme
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMobileDrawerOpen(false);
                    setSettingsModalOpen(true);
                  }}
                  className="w-full flex items-center justify-center gap-2 rounded-full border border-slate-300 dark:border-zinc-700 py-2 text-xs font-semibold text-[#1F1F1F] dark:text-zinc-100"
                >
                  <Settings className="w-3.5 h-3.5" />
                  Settings &amp; Vault Security
                </button>
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Mobile Bottom Navigation Bar (< 1024px) — Google Photos 4 tabs + Upload FAB */}
      <nav
        aria-label="Mobile navigation"
        className="lg:hidden fixed inset-x-0 bottom-0 z-30 h-16 bg-white/95 dark:bg-[#131314]/95 backdrop-blur-md border-t border-slate-200 dark:border-zinc-800 px-2 pb-[env(safe-area-inset-bottom)] flex items-center justify-around"
      >
        {(
          [
            { id: 'photos', label: 'Photos', Icon: ImageIcon },
            { id: 'explore', label: 'Explore', Icon: Compass },
          ] as const
        ).map(({ id, label, Icon }) => {
          const active = activeSection === id && !searchResults;
          return (
            <button
              key={id}
              type="button"
              onClick={() => navigateSection(id)}
              className={`flex flex-col items-center justify-center gap-0.5 min-w-[56px] py-1 text-[11px] font-medium ${
                active ? 'text-[#0B57D0] dark:text-[#A8C7FA]' : 'text-[#5F6368] dark:text-zinc-400'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{label}</span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => {
            setUploadDefaultLocked(false);
            setUploadModalOpen(true);
          }}
          aria-label="Upload photo or video"
          className="w-12 h-12 -mt-5 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] text-white shadow-lg flex items-center justify-center ring-4 ring-white dark:ring-[#131314]"
        >
          <Plus className="w-6 h-6" />
        </button>

        {(
          [
            { id: 'albums', label: 'Albums', Icon: FolderHeart },
            { id: 'locked', label: 'Vault', Icon: Lock },
          ] as const
        ).map(({ id, label, Icon }) => {
          const active = activeSection === id && !searchResults;
          return (
            <button
              key={id}
              type="button"
              onClick={() => navigateSection(id)}
              className={`flex flex-col items-center justify-center gap-0.5 min-w-[56px] py-1 text-[11px] font-medium ${
                active ? 'text-[#0B57D0] dark:text-[#A8C7FA]' : 'text-[#5F6368] dark:text-zinc-400'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      {/* Darkroom Cinema Lightbox & EXIF Studio */}
      {viewerScope && viewerActiveId !== null && (
        <MediaViewer
          items={viewerScope}
          activeMessageId={viewerActiveId}
          onSelectMessageId={setViewerActiveId}
          onClose={() => setViewerActiveId(null)}
          onToggleFavorite={handleToggleFavorite}
          onToggleArchive={handleToggleArchive}
          onToggleLock={handleToggleLock}
          onDelete={handleDelete}
          onDownloadOriginal={handleDownloadOriginal}
        />
      )}

      {/* Modals */}
      <OnboardingModal
        open={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        onAuthenticated={handleAuthenticatedSession}
      />

      <VaultUnlockModal
        open={vaultLocked}
        onUnlocked={(unlocked) => handleAuthenticatedSession(unlocked, true)}
        onSignInFresh={() => {
          setVaultLocked(false);
          setAuthModalOpen(true);
        }}
      />

      <UploadModal
        open={uploadModalOpen}
        defaultLocked={uploadDefaultLocked}
        albums={allAlbums}
        isConnected={Boolean(session)}
        channelTitle={session?.channelTitle}
        onClose={() => setUploadModalOpen(false)}
        onRequireAuth={() => setAuthModalOpen(true)}
        onUploadFiles={handleUploadFiles}
      />

      <TelegramAuthModal
        open={authModalOpen}
        session={session}
        onClose={() => setAuthModalOpen(false)}
        onSessionUpdated={(next) => handleAuthenticatedSession(next, true)}
        onLoggedOut={handleLoggedOut}
      />

      <RebuildIndexModal
        open={rebuildModalOpen}
        session={session}
        onClose={() => setRebuildModalOpen(false)}
        onRequireAuth={() => setAuthModalOpen(true)}
        onCompleted={(count) => {
          showToast(`Index rebuilt: ${count} media items synced from Telegram.`);
        }}
      />

      <SettingsModal
        open={settingsModalOpen}
        theme={theme}
        session={session}
        onThemeChange={onSetTheme}
        onClose={() => setSettingsModalOpen(false)}
        onOpenTelegramAuth={() => setAuthModalOpen(true)}
        onOpenRebuildIndex={() => setRebuildModalOpen(true)}
        onLockVault={handleLockVault}
        onLoggedOut={handleLoggedOut}
      />

      <AddToAlbumModal
        open={Boolean(albumAssignIds && albumAssignIds.length > 0)}
        albums={allAlbums}
        count={albumAssignIds?.length ?? 0}
        onClose={() => setAlbumAssignIds(null)}
        onAssignAlbum={handleAssignAlbum}
      />

      <TransfersModal
        open={transfersModalOpen}
        jobs={transferJobs}
        onClose={() => setTransfersModalOpen(false)}
      />

      <StorageQuotaModal
        open={storageModalOpen}
        usedBytes={totalUsedBytes}
        itemCount={allLibraryMedia.length}
        channelTitle={session?.channelTitle}
        onClose={() => setStorageModalOpen(false)}
      />

      {/* Tactile Keyboard Action Feedback HUD */}
      <AnimatePresence mode="wait">
        {tactileHud && (
          <motion.div
            key={tactileHud.id}
            data-testid="tactile-shortcut-hud"
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 18, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 460, damping: 28, mass: 0.7 }}
            className="fixed bottom-20 lg:bottom-7 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 rounded-2xl border border-slate-700/80 dark:border-slate-300/60 bg-[#1F1F1F]/95 dark:bg-white/95 text-white dark:text-[#1F1F1F] backdrop-blur-md pl-2.5 pr-4 py-2 shadow-2xl whitespace-nowrap"
          >
            <kbd className="inline-flex items-center justify-center min-w-[26px] h-6 px-1.5 rounded-md border border-white/25 dark:border-slate-300 border-b-2 bg-white/15 dark:bg-slate-100 text-[11px] font-mono font-bold tracking-tight shadow-xs">
              {tactileHud.keycap}
            </kbd>
            <span
              className={`inline-flex items-center justify-center w-6 h-6 rounded-full ${
                tactileHud.kind === 'favorite'
                  ? 'bg-rose-500/20 text-rose-400 dark:text-rose-600'
                  : tactileHud.kind === 'delete'
                    ? 'bg-red-500/20 text-red-400 dark:text-red-600'
                    : 'bg-[#A8C7FA]/20 text-[#A8C7FA] dark:bg-[#D3E3FD] dark:text-[#0B57D0]'
              }`}
            >
              {tactileHud.kind === 'favorite' ? (
                <Heart className="w-3.5 h-3.5 fill-current" />
              ) : tactileHud.kind === 'delete' ? (
                <Trash2 className="w-3.5 h-3.5" />
              ) : (
                <Archive className="w-3.5 h-3.5" />
              )}
            </span>
            <span className="text-xs font-semibold tracking-tight">{tactileHud.label}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Quiet Toast Feedback */}
      {toast && !tactileHud && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-[90vw] truncate rounded-full bg-[#1F1F1F] dark:bg-zinc-100 text-white dark:text-[#1F1F1F] px-5 py-2.5 text-xs font-medium shadow-xl"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
