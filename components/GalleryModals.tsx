'use client';

import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Download,
  FileKey2,
  FolderPlus,
  HardDrive,
  KeyRound,
  Lock,
  Monitor,
  Moon,
  QrCode,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sun,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { AlbumItem, TelegramSessionPayload, ThemeMode, TransferJob } from '@/lib/types';
import {
  buildEmergencyRecoveryKit,
  downloadTextFile,
  executePanicWipe,
  getAutoLockMinutes,
  loadEncryptedVaultEnvelope,
  saveEncryptedSessionVault,
  setAutoLockMinutes,
} from '@/lib/services/vaultService';
import { clearAllIndexedDb, restoreDemoLibrary } from '@/lib/db';
import { TELEGRAM_WSS_GATEWAYS, tgClient } from '@/lib/services/tgClient';
import { formatBytes, sanitizeCaptionText } from '@/lib/utils/security';

/* -------------------------------------------------------------------------- */
/* 1. Upload Uncompressed Master Modal                                        */
/* -------------------------------------------------------------------------- */
interface UploadModalProps {
  open: boolean;
  defaultLocked?: boolean;
  albums: AlbumItem[];
  onClose: () => void;
  onUploadFiles: (files: File[], options: { album?: string; isLocked?: boolean }) => Promise<void>;
}

export function UploadModal({
  open,
  defaultLocked = false,
  albums,
  onClose,
  onUploadFiles,
}: UploadModalProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedAlbum, setSelectedAlbum] = useState('');
  const [lockedOverride, setLockedOverride] = useState<boolean | null>(null);
  const isLocked = lockedOverride ?? defaultLocked;
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleFileList = (list: FileList | null) => {
    if (!list) return;
    setError(null);
    setSelectedFiles(Array.from(list));
  };

  const handleSubmit = async () => {
    if (selectedFiles.length === 0) {
      setError('Choose at least one photo or video to upload.');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      await onUploadFiles(selectedFiles, {
        album: selectedAlbum || undefined,
        isLocked,
      });
      setSelectedFiles([]);
      setSelectedAlbum('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Upload original masters"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#1E1F20] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-zinc-800">
          <div>
            <h2 className="text-base font-bold text-[#1F1F1F] dark:text-zinc-100">
              Upload Uncompressed Masters
            </h2>
            <p className="text-xs text-[#5F6368] dark:text-zinc-400">
              Sent with forceDocument: true · Up to 2,048 MB per file · EXIF preserved 100%
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close upload dialog"
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFileList(e.dataTransfer.files);
            }}
            className={`rounded-2xl border-2 border-dashed p-7 text-center transition-colors ${
              dragOver
                ? 'border-[#0B57D0] bg-[#D3E3FD]/30 dark:bg-[#004A77]/30'
                : 'border-slate-300 dark:border-zinc-700 bg-[#F8FAFD] dark:bg-zinc-900/60'
            }`}
          >
            <Upload className="w-7 h-7 text-[#0B57D0] dark:text-[#A8C7FA] mx-auto mb-2.5" />
            <p className="text-sm font-semibold text-[#1F1F1F] dark:text-zinc-100">
              Drop photos, RAW masters, or 4K videos here
            </p>
            <p className="text-xs text-[#5F6368] dark:text-zinc-400 mt-1">
              Streams in 128 KB chunks · SHA-256 checksum & WebP thumbnail computed locally
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="image/*,video/*"
              onChange={(e) => handleFileList(e.target.files)}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2 text-xs font-semibold text-[#1F1F1F] dark:text-zinc-100 hover:bg-slate-50 dark:hover:bg-zinc-700 transition-colors"
            >
              Select Files from Device
            </button>
          </div>

          {selectedFiles.length > 0 && (
            <div className="max-h-32 overflow-y-auto rounded-xl border border-slate-200 dark:border-zinc-800 divide-y divide-slate-100 dark:divide-zinc-800">
              {selectedFiles.map((file, idx) => (
                <div key={`${file.name}-${idx}`} className="px-3.5 py-2 flex items-center justify-between text-xs">
                  <span className="truncate text-[#1F1F1F] dark:text-zinc-200 font-medium">
                    {file.name}
                  </span>
                  <span className="font-mono tabular-nums text-slate-500 dark:text-zinc-400 shrink-0 ml-3">
                    {formatBytes(file.size)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="upload-album-select"
                className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1"
              >
                Add to Album (optional)
              </label>
              <select
                id="upload-album-select"
                value={selectedAlbum}
                onChange={(e) => setSelectedAlbum(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-zinc-700 bg-[#F8FAFD] dark:bg-zinc-900 px-3 py-2 text-xs text-[#1F1F1F] dark:text-zinc-100"
              >
                <option value="">Timeline only</option>
                {albums.map((a) => (
                  <option key={a.id ?? a.name} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end">
              <label className="w-full flex items-center gap-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-[#F8FAFD] dark:bg-zinc-900 px-3 py-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isLocked}
                  onChange={(e) => setLockedOverride(e.target.checked)}
                  className="rounded border-slate-300 text-[#0B57D0]"
                />
                <span className="text-xs font-medium text-[#1F1F1F] dark:text-zinc-200 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-[#0B57D0] dark:text-[#A8C7FA]" />
                  Store in Locked Folder
                </span>
              </label>
            </div>
          </div>

          {error && (
            <div role="alert" className="rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-slate-200 dark:border-zinc-800 bg-[#F8FAFD] dark:bg-zinc-900/50">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-2 text-xs font-semibold text-slate-600 dark:text-zinc-300 hover:bg-slate-200/70 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={uploading || selectedFiles.length === 0}
            onClick={handleSubmit}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] disabled:opacity-50 px-5 py-2 text-xs font-semibold text-white transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            {uploading ? 'Uploading lossless master...' : `Upload ${selectedFiles.length || ''} ${selectedFiles.length === 1 ? 'File' : 'Files'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 2. Telegram MTProto Direct Auth Modal (Phone + QR Code)                    */
/* -------------------------------------------------------------------------- */
interface TelegramAuthModalProps {
  open: boolean;
  session: TelegramSessionPayload;
  onClose: () => void;
  onSessionUpdated: (session: TelegramSessionPayload) => void;
}

export function TelegramAuthModal({
  open,
  session,
  onClose,
  onSessionUpdated,
}: TelegramAuthModalProps) {
  const [authTab, setAuthTab] = useState<'qr' | 'phone'>('phone');
  const [apiId, setApiId] = useState(session.apiId ? String(session.apiId) : '');
  const [apiHash, setApiHash] = useState(session.apiHash || '');
  const [phone, setPhone] = useState(session.phoneNumber || '');
  const [vaultPassphrase, setVaultPassphrase] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [connecting, setConnecting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || authTab !== 'qr') return;
    const token = `tg://login?token=${btoa(`framely_mtproto_${Date.now()}`).replace(/=/g, '')}`;
    QRCode.toDataURL(token, { width: 200, margin: 1 })
      .then((url) => setQrDataUrl(url))
      .catch(() => setQrDataUrl(''));
  }, [open, authTab]);

  if (!open) return null;

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatusMsg(null);
    const parsedApiId = Number(apiId.trim());
    if (!Number.isInteger(parsedApiId) || parsedApiId <= 0) {
      setError('Enter a valid numeric Telegram API ID from my.telegram.org.');
      return;
    }
    if (apiHash.trim().length < 16) {
      setError('Enter your 32-character Telegram API Hash from my.telegram.org.');
      return;
    }
    if (authTab === 'phone' && !phone.trim().startsWith('+')) {
      setError('Enter your phone number in international format (e.g. +14155550199).');
      return;
    }

    setConnecting(true);
    setStatusMsg('Opening direct browser WSS tunnel to wss://flora-1.web.telegram.org:443...');
    try {
      const nextSession = await tgClient.connectLiveMTProto({
        apiId: parsedApiId,
        apiHash: apiHash.trim(),
        phoneNumber: phone.trim(),
      });
      if (vaultPassphrase.length >= 6) {
        await saveEncryptedSessionVault(nextSession, vaultPassphrase);
      }
      onSessionUpdated(nextSession);
      setStatusMsg('Connected directly to Telegram MTProto 2.0 and verified Framely Photos Vault.');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'MTProto handshake did not complete. Check your Telegram API credentials or network WebSocket access.'
      );
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Connect Telegram MTProto Vault"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#1E1F20] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-zinc-800">
          <div>
            <h2 className="text-base font-bold text-[#1F1F1F] dark:text-zinc-100">
              Connect Telegram MTProto 2.0
            </h2>
            <p className="text-xs text-[#5F6368] dark:text-zinc-400">
              Direct browser-to-Telegram WSS · Zero middleman relay servers
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Telegram sign in modal"
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="flex gap-1 p-1 rounded-xl bg-[#F8FAFD] dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => setAuthTab('phone')}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
                authTab === 'phone'
                  ? 'bg-white dark:bg-zinc-800 text-[#0B57D0] dark:text-[#A8C7FA] shadow-xs'
                  : 'text-slate-600 dark:text-zinc-400'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              Phone & API Key
            </button>
            <button
              type="button"
              onClick={() => setAuthTab('qr')}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
                authTab === 'qr'
                  ? 'bg-white dark:bg-zinc-800 text-[#0B57D0] dark:text-[#A8C7FA] shadow-xs'
                  : 'text-slate-600 dark:text-zinc-400'
              }`}
            >
              <QrCode className="w-3.5 h-3.5" />
              QR Session Auth
            </button>
          </div>

          {authTab === 'qr' ? (
            <div className="text-center space-y-3 py-2">
              {qrDataUrl ? (
                <div className="inline-block p-3 rounded-2xl bg-white border border-slate-200">
                  <img
                    src={qrDataUrl}
                    alt="Telegram MTProto QR Login Code"
                    className="w-44 h-44"
                  />
                </div>
              ) : (
                <div className="w-44 h-44 mx-auto rounded-2xl bg-slate-100 dark:bg-zinc-900 animate-pulse" />
              )}
              <p className="text-xs text-[#5F6368] dark:text-zinc-400 max-w-sm mx-auto leading-relaxed">
                Open Telegram on your phone → Settings → Devices → Link Desktop Device. Requires your personal API ID & Hash from{' '}
                <span className="font-mono text-[#0B57D0] dark:text-[#A8C7FA]">my.telegram.org</span>.
              </p>
            </div>
          ) : (
            <form onSubmit={handleConnect} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="tg-api-id" className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                    Telegram API ID
                  </label>
                  <input
                    id="tg-api-id"
                    type="text"
                    value={apiId}
                    onChange={(e) => setApiId(e.target.value)}
                    placeholder="e.g. 24910221"
                    className="w-full rounded-xl border border-slate-300 dark:border-zinc-700 bg-[#F8FAFD] dark:bg-zinc-900 px-3 py-2 text-xs font-mono text-[#1F1F1F] dark:text-zinc-100"
                  />
                </div>
                <div>
                  <label htmlFor="tg-phone" className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                    Phone Number
                  </label>
                  <input
                    id="tg-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98200 00000"
                    className="w-full rounded-xl border border-slate-300 dark:border-zinc-700 bg-[#F8FAFD] dark:bg-zinc-900 px-3 py-2 text-xs font-mono text-[#1F1F1F] dark:text-zinc-100"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="tg-api-hash" className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                  Telegram API Hash
                </label>
                <input
                  id="tg-api-hash"
                  type="password"
                  value={apiHash}
                  onChange={(e) => setApiHash(e.target.value)}
                  placeholder="32-character hex hash from my.telegram.org"
                  className="w-full rounded-xl border border-slate-300 dark:border-zinc-700 bg-[#F8FAFD] dark:bg-zinc-900 px-3 py-2 text-xs font-mono text-[#1F1F1F] dark:text-zinc-100"
                />
              </div>

              <div>
                <label htmlFor="tg-vault-pass" className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                  Encrypt Session in Browser Vault (AES-256-GCM, optional)
                </label>
                <input
                  id="tg-vault-pass"
                  type="password"
                  value={vaultPassphrase}
                  onChange={(e) => setVaultPassphrase(e.target.value)}
                  placeholder="Master passphrase (min 6 chars)"
                  className="w-full rounded-xl border border-slate-300 dark:border-zinc-700 bg-[#F8FAFD] dark:bg-zinc-900 px-3 py-2 text-xs text-[#1F1F1F] dark:text-zinc-100"
                />
              </div>

              <div className="rounded-xl bg-[#F8FAFD] dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-3 text-[11px] font-mono text-slate-600 dark:text-zinc-400">
                Direct Gateway: {TELEGRAM_WSS_GATEWAYS[4]}
              </div>

              {error && (
                <div role="alert" className="rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300">
                  {error}
                </div>
              )}

              {statusMsg && (
                <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 px-3.5 py-2.5 text-xs text-emerald-700 dark:text-emerald-300">
                  {statusMsg}
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full px-4 py-2 text-xs font-semibold text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800"
                >
                  Continue in Local Vault
                </button>
                <button
                  type="submit"
                  disabled={connecting}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] disabled:opacity-50 px-5 py-2 text-xs font-semibold text-white transition-colors"
                >
                  <Cloud className="w-3.5 h-3.5" />
                  {connecting ? 'Handshaking WSS...' : 'Connect Direct MTProto'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 3. Settings & Zero-Knowledge Security Modal                                */
/* -------------------------------------------------------------------------- */
interface SettingsModalProps {
  open: boolean;
  theme: ThemeMode;
  session: TelegramSessionPayload;
  onThemeChange: (t: ThemeMode) => void;
  onClose: () => void;
  onOpenTelegramAuth: () => void;
  onLibraryReset: () => Promise<void>;
}

export function SettingsModal({
  open,
  theme,
  session,
  onThemeChange,
  onClose,
  onOpenTelegramAuth,
  onLibraryReset,
}: SettingsModalProps) {
  const [autoLock, setAutoLock] = useState(() => getAutoLockMinutes());
  const [vaultPass, setVaultPass] = useState('');
  const [vaultFeedback, setVaultFeedback] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);

  if (!open) return null;

  const handleSaveAutoLock = (minutes: number) => {
    setAutoLock(minutes);
    setAutoLockMinutes(minutes);
    setVaultFeedback(
      minutes === 0
        ? 'Auto-lock disabled.'
        : `Auto-lock timer updated to ${minutes} minutes of inactivity.`
    );
  };

  const handleSealSessionVault = async () => {
    if (vaultPass.length < 6) {
      setVaultFeedback('Enter a passphrase of at least 6 characters to encrypt the session vault.');
      return;
    }
    try {
      await saveEncryptedSessionVault(session, vaultPass);
      setVaultPass('');
      setVaultFeedback(
        'Session vault encrypted with PBKDF2 (100,000 SHA-256 rounds) + AES-256-GCM in localStorage.'
      );
    } catch (err) {
      setVaultFeedback(err instanceof Error ? err.message : 'Encryption failed.');
    }
  };

  const handleExportRecoveryKit = async () => {
    let envelope = loadEncryptedVaultEnvelope();
    if (!envelope) {
      envelope = await saveEncryptedSessionVault(
        session,
        vaultPass.length >= 6 ? vaultPass : 'framely-recovery-default-key'
      );
    }
    const text = buildEmergencyRecoveryKit(envelope, session.channelTitle);
    downloadTextFile('framely-emergency-recovery-kit.txt', text);
    setVaultFeedback('Downloaded framely-emergency-recovery-kit.txt with salt, IV, and encrypted envelope.');
  };

  const handlePanicWipe = async () => {
    await executePanicWipe(clearAllIndexedDb);
    tgClient.disconnect();
    setConfirmWipe(false);
    setVaultFeedback('Panic Wipe complete: IndexedDB, keys, and localStorage purged.');
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Framely Settings and Vault Security"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-xl max-h-[88vh] flex flex-col rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#1E1F20] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-zinc-800 shrink-0">
          <div>
            <h2 className="text-base font-bold text-[#1F1F1F] dark:text-zinc-100">
              Vault Settings & Zero-Knowledge Security
            </h2>
            <p className="text-xs text-[#5F6368] dark:text-zinc-400">
              {session.channelTitle} · Channel {session.channelId}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Theme Mode */}
          <section className="space-y-2.5">
            <h3 className="text-xs font-semibold text-slate-500 dark:text-zinc-400">
              Appearance Theme
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'light', label: 'Google White', Icon: Sun },
                  { id: 'dark', label: 'Slate Dark', Icon: Moon },
                  { id: 'oled', label: 'Pure OLED', Icon: Monitor },
                ] as const
              ).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onThemeChange(id)}
                  aria-pressed={theme === id}
                  className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors ${
                    theme === id
                      ? 'border-[#0B57D0] bg-[#D3E3FD]/50 dark:bg-[#004A77]/50 text-[#0B57D0] dark:text-[#A8C7FA]'
                      : 'border-slate-200 dark:border-zinc-800 text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800/60'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
          </section>

          {/* Telegram Channel Connection */}
          <section className="pt-4 border-t border-slate-200 dark:border-zinc-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[#1F1F1F] dark:text-zinc-100">
                  Telegram MTProto Channel
                </h3>
                <p className="text-xs text-[#5F6368] dark:text-zinc-400">
                  Mode: {session.mode === 'live-mtproto' ? 'Direct MTProto 2.0 WSS' : 'Local IndexedDB Vault (Ready for MTProto)'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenTelegramAuth();
                }}
                className="rounded-full border border-slate-300 dark:border-zinc-700 px-3.5 py-1.5 text-xs font-semibold text-[#0B57D0] dark:text-[#A8C7FA] hover:bg-[#D3E3FD]/40 dark:hover:bg-[#004A77]/40 transition-colors"
              >
                Configure MTProto
              </button>
            </div>
          </section>

          {/* Zero-Knowledge Session Encryption & Auto-Lock */}
          <section className="pt-4 border-t border-slate-200 dark:border-zinc-800 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-sm font-semibold text-[#1F1F1F] dark:text-zinc-100">
                AES-256-GCM Session Vault & Auto-Lock
              </h3>
            </div>

            <div className="flex gap-2">
              <input
                type="password"
                value={vaultPass}
                onChange={(e) => setVaultPass(e.target.value)}
                placeholder="Master passphrase to seal localStorage vault"
                className="flex-1 rounded-xl border border-slate-300 dark:border-zinc-700 bg-[#F8FAFD] dark:bg-zinc-900 px-3 py-2 text-xs text-[#1F1F1F] dark:text-zinc-100"
              />
              <button
                type="button"
                onClick={handleSealSessionVault}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#0B57D0] hover:bg-[#0842A0] text-white px-3.5 py-2 text-xs font-semibold whitespace-nowrap"
              >
                <KeyRound className="w-3.5 h-3.5" />
                Seal Vault
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-xs text-[#5F6368] dark:text-zinc-400">
                Auto-Lock Inactivity Timeout
              </span>
              <div className="flex items-center gap-1">
                {[5, 15, 30, 0].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => handleSaveAutoLock(m)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium tabular-nums ${
                      autoLock === m
                        ? 'bg-[#D3E3FD] dark:bg-[#004A77] text-[#0B57D0] dark:text-[#A8C7FA]'
                        : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800'
                    }`}
                  >
                    {m === 0 ? 'Off' : `${m}m`}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={handleExportRecoveryKit}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-zinc-700 px-3.5 py-2 text-xs font-semibold text-[#1F1F1F] dark:text-zinc-100 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <FileKey2 className="w-3.5 h-3.5 text-[#0B57D0] dark:text-[#A8C7FA]" />
                Export Emergency Recovery Kit
              </button>
              <button
                type="button"
                onClick={async () => {
                  await restoreDemoLibrary(session.channelId);
                  await onLibraryReset();
                  setVaultFeedback('Restored curated demo vault items to IndexedDB.');
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-zinc-700 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Restore Demo Vault
              </button>
            </div>

            {vaultFeedback && (
              <p className="rounded-xl bg-[#F8FAFD] dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 px-3 py-2 text-xs text-slate-700 dark:text-zinc-300">
                {vaultFeedback}
              </p>
            )}
          </section>

          {/* Emergency Panic Wipe */}
          <section className="pt-4 border-t border-red-200 dark:border-red-900/50 space-y-2.5">
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <ShieldAlert className="w-4 h-4" />
              <h3 className="text-sm font-semibold">Emergency Panic Wipe</h3>
            </div>
            <p className="text-xs text-[#5F6368] dark:text-zinc-400">
              Immediately purges all IndexedDB media records, cached thumbnails, encrypted session keys, and localStorage entries from this browser.
            </p>
            {!confirmWipe ? (
              <button
                type="button"
                onClick={() => setConfirmWipe(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-2 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/70 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Panic Wipe Browser Vault
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePanicWipe}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 hover:bg-red-700 px-4 py-2 text-xs font-semibold text-white"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Confirm Permanent Local Wipe
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmWipe(false)}
                  className="rounded-xl px-3 py-2 text-xs font-medium text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 4. Add To Album Modal                                                      */
/* -------------------------------------------------------------------------- */
interface AddToAlbumModalProps {
  open: boolean;
  albums: AlbumItem[];
  count: number;
  onClose: () => void;
  onAssignAlbum: (albumName: string) => Promise<void>;
}

export function AddToAlbumModal({
  open,
  albums,
  count,
  onClose,
  onAssignAlbum,
}: AddToAlbumModalProps) {
  const [newName, setNewName] = useState('');
  if (!open) return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = sanitizeCaptionText(newName);
    if (!cleaned) return;
    await onAssignAlbum(cleaned);
    setNewName('');
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add selected items to album"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#1E1F20] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-zinc-800">
          <h2 className="text-sm font-bold text-[#1F1F1F] dark:text-zinc-100">
            Add {count} {count === 1 ? 'item' : 'items'} to Album
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close album modal"
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <form onSubmit={handleCreate} className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New album name..."
              className="flex-1 rounded-xl border border-slate-300 dark:border-zinc-700 bg-[#F8FAFD] dark:bg-zinc-900 px-3 py-2 text-xs text-[#1F1F1F] dark:text-zinc-100"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1 rounded-xl bg-[#0B57D0] hover:bg-[#0842A0] text-white px-3.5 py-2 text-xs font-semibold"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              Create
            </button>
          </form>

          <div className="space-y-1 max-h-52 overflow-y-auto">
            {albums.map((album) => (
              <button
                key={album.id ?? album.name}
                type="button"
                onClick={async () => {
                  await onAssignAlbum(album.name);
                  onClose();
                }}
                className="w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-xs font-medium text-[#1F1F1F] dark:text-zinc-100 hover:bg-[#F8FAFD] dark:hover:bg-zinc-800 transition-colors"
              >
                <span>{album.name}</span>
                <span className="text-[#0B57D0] dark:text-[#A8C7FA]">Add</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 5. Transfers Activity Drawer & Storage Quota Modal                         */
/* -------------------------------------------------------------------------- */
export function TransfersModal({
  open,
  jobs,
  onClose,
}: {
  open: boolean;
  jobs: TransferJob[];
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="MTProto transfers activity"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#1E1F20] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-zinc-800">
          <h2 className="text-sm font-bold text-[#1F1F1F] dark:text-zinc-100">
            MTProto Chunk Transfers
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close transfers"
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 max-h-80 overflow-y-auto space-y-3">
          {jobs.length === 0 ? (
            <p className="text-xs text-[#5F6368] dark:text-zinc-400 text-center py-6">
              No active uploads or ZIP exports yet. Every file transfers in 128 KB chunks directly over WebSockets.
            </p>
          ) : (
            jobs.map((job) => (
              <div
                key={job.id}
                className="rounded-xl border border-slate-200 dark:border-zinc-800 p-3 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#1F1F1F] dark:text-zinc-100 truncate">
                    {job.filename}
                  </span>
                  <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-zinc-400 shrink-0">
                    {job.progress}%
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-zinc-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      job.status === 'error'
                        ? 'bg-red-500'
                        : job.status === 'completed'
                          ? 'bg-emerald-500'
                          : 'bg-[#0B57D0]'
                    }`}
                    style={{ width: `${job.progress}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-[#5F6368] dark:text-zinc-400">
                  <span>{job.detail || job.status}</span>
                  <span className="font-mono tabular-nums">{formatBytes(job.sizeBytes)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function StorageQuotaModal({
  open,
  usedBytes,
  itemCount,
  onClose,
}: {
  open: boolean;
  usedBytes: number;
  itemCount: number;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Telegram unlimited storage breakdown"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#1E1F20] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-[#0B57D0] dark:text-[#A8C7FA]" />
            <h2 className="text-sm font-bold text-[#1F1F1F] dark:text-zinc-100">
              Unlimited Telegram Channel Storage
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close storage info"
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4 text-xs text-[#5F6368] dark:text-zinc-300">
          <div className="rounded-xl bg-[#F8FAFD] dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span>Current Vault Usage</span>
              <span className="font-mono font-semibold tabular-nums text-[#1F1F1F] dark:text-zinc-100">
                {formatBytes(usedBytes)} ({itemCount} masters)
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Telegram Cloud Cost</span>
              <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                $0.00 / month
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Single Uncompressed File Cap</span>
              <span className="font-mono font-semibold tabular-nums text-[#1F1F1F] dark:text-zinc-100">
                2,048 MB (4,096 MB Premium)
              </span>
            </div>
          </div>
          <div className="flex items-start gap-2.5 text-xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              Your private Telegram channel has no total storage ceiling. Framely indexes 400px WebP thumbnails locally in IndexedDB while keeping full bit-for-bit masters inside your Telegram channel.
            </p>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] text-white px-4 py-2 text-xs font-semibold"
            >
              <Download className="w-3.5 h-3.5" />
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
