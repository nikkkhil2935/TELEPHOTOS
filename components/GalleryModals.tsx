'use client';

import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Cloud,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileKey2,
  FolderPlus,
  HardDrive,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
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
import { clearAllIndexedDb } from '@/lib/db';
import { tgClient } from '@/lib/services/tgClient';
import { formatBytes, sanitizeCaptionText } from '@/lib/utils/security';
import {
  validateInternationalPhone,
  validateTelegramCredentials,
} from '@/lib/utils/telegram';

/* -------------------------------------------------------------------------- */
/* 1. Upload Uncompressed Master Modal                                        */
/* -------------------------------------------------------------------------- */
interface UploadModalProps {
  open: boolean;
  defaultLocked?: boolean;
  albums: AlbumItem[];
  isConnected: boolean;
  channelTitle?: string;
  onClose: () => void;
  onRequireAuth: () => void;
  onUploadFiles: (files: File[], options: { album?: string; isLocked?: boolean }) => Promise<void>;
}

export function UploadModal({
  open,
  defaultLocked = false,
  albums,
  isConnected,
  channelTitle,
  onClose,
  onRequireAuth,
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
    if (!isConnected) {
      onClose();
      onRequireAuth();
      return;
    }
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-3 sm:p-4"
    >
      <div className="w-full max-w-lg max-h-[92dvh] flex flex-col rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#1E1F20] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-zinc-800 shrink-0">
          <div className="min-w-0 pr-2">
            <h2 className="text-base font-bold text-[#1F1F1F] dark:text-zinc-100 truncate">
              Upload Uncompressed Masters
            </h2>
            <p className="text-xs text-[#5F6368] dark:text-zinc-400 truncate">
              {isConnected
                ? `Target: ${channelTitle || 'Telegram Vault'} · 128 KB chunk stream`
                : 'Connect Telegram first to store files losslessly'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close upload dialog"
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-4 overflow-y-auto">
          {!isConnected && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 p-3.5 flex items-center justify-between gap-3">
              <p className="text-xs text-amber-800 dark:text-amber-200">
                Sign in with your Telegram account to stream uncompressed masters into your private channel.
              </p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onRequireAuth();
                }}
                className="shrink-0 rounded-full bg-[#0B57D0] text-white px-3.5 py-1.5 text-xs font-semibold"
              >
                Connect
              </button>
            </div>
          )}

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
            className={`rounded-2xl border-2 border-dashed p-6 sm:p-7 text-center transition-colors ${
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
              Uploaded with forceDocument: true · Up to 2,048 MB per file · EXIF preserved 100%
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
                className="w-full rounded-xl border border-slate-300 dark:border-zinc-700 bg-[#F8FAFD] dark:bg-zinc-900 px-3 py-2 text-base sm:text-xs text-[#1F1F1F] dark:text-zinc-100"
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

        <div className="flex items-center justify-end gap-2.5 px-5 sm:px-6 py-4 border-t border-slate-200 dark:border-zinc-800 bg-[#F8FAFD] dark:bg-zinc-900/50 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-2 text-xs font-semibold text-slate-600 dark:text-zinc-300 hover:bg-slate-200/70 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={uploading || (isConnected && selectedFiles.length === 0)}
            onClick={handleSubmit}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] disabled:opacity-50 px-5 py-2 text-xs font-semibold text-white transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            {!isConnected
              ? 'Connect Telegram'
              : uploading
                ? 'Streaming to Telegram...'
                : `Upload ${selectedFiles.length || ''} ${selectedFiles.length === 1 ? 'File' : 'Files'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 2. Real Telegram MTProto Direct Auth Modal (Phone OTP + 2FA & Live QR)     */
/* -------------------------------------------------------------------------- */
interface TelegramAuthModalProps {
  open: boolean;
  session: TelegramSessionPayload | null;
  onClose: () => void;
  onSessionUpdated: (session: TelegramSessionPayload) => void;
  onLoggedOut: () => void;
}

export function TelegramAuthModal({
  open,
  session,
  onClose,
  onSessionUpdated,
  onLoggedOut,
}: TelegramAuthModalProps) {
  const envApiId = process.env.NEXT_PUBLIC_TELEGRAM_API_ID || '';
  const envApiHash = process.env.NEXT_PUBLIC_TELEGRAM_API_HASH || '';

  const [authTab, setAuthTab] = useState<'phone' | 'qr'>('phone');
  const [apiId, setApiId] = useState(session?.apiId ? String(session.apiId) : envApiId);
  const [apiHash, setApiHash] = useState(session?.apiHash || envApiHash);
  const [showApiHash, setShowApiHash] = useState(false);

  // Phone OTP + 2FA state
  const [phone, setPhone] = useState(session?.phoneNumber || '');
  const [phoneStep, setPhoneStep] = useState<'creds' | 'code' | '2fa'>('creds');
  const [phoneCodeHash, setPhoneCodeHash] = useState('');
  const [isCodeViaApp, setIsCodeViaApp] = useState(true);
  const [otpCode, setOtpCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [vaultPassphrase, setVaultPassphrase] = useState('');

  // Live QR state
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrExpiresIn, setQrExpiresIn] = useState(0);
  const [qrNeeds2fa, setQrNeeds2fa] = useState(false);
  const [qrPassword, setQrPassword] = useState('');
  const qrPasswordResolverRef = useRef<((pw: string) => void) | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      void tgClient.cancelPendingAuth();
      setError(null);
      setLoading(false);
      setQrDataUrl(null);
      setQrExpiresIn(0);
      setQrNeeds2fa(false);
      setQrPassword('');
      setPhoneStep('creds');
      setOtpCode('');
      setPassword('');
    }
  }, [open]);

  useEffect(() => {
    if (qrExpiresIn <= 0) return;
    const timer = window.setInterval(() => {
      setQrExpiresIn((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [qrExpiresIn]);

  if (!open) return null;

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const credCheck = validateTelegramCredentials(apiId, apiHash);
    if (!credCheck.valid) {
      setError(credCheck.error);
      return;
    }
    const phoneCheck = validateInternationalPhone(phone);
    if (!phoneCheck.valid) {
      setError(phoneCheck.error);
      return;
    }

    setLoading(true);
    try {
      const res = await tgClient.sendPhoneCode(
        credCheck.apiId,
        credCheck.apiHash,
        phoneCheck.phone
      );
      setPhone(phoneCheck.phone);
      setPhoneCodeHash(res.phoneCodeHash);
      setIsCodeViaApp(res.isCodeViaApp);
      setPhoneStep('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request Telegram login code.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const credCheck = validateTelegramCredentials(apiId, apiHash);
    if (!credCheck.valid) {
      setError(credCheck.error);
      return;
    }
    if (!otpCode.trim()) {
      setError('Enter the verification code sent to your Telegram app or SMS.');
      return;
    }
    if (phoneStep === '2fa' && !password.trim()) {
      setError('Enter your Telegram 2FA Cloud Password.');
      return;
    }

    setLoading(true);
    try {
      const nextSession = await tgClient.verifyPhoneCodeAndSignIn({
        apiId: credCheck.apiId,
        apiHash: credCheck.apiHash,
        phoneNumber: phone.trim(),
        phoneCode: otpCode.trim(),
        phoneCodeHash,
        password: password.trim() || undefined,
        vaultPassphrase: vaultPassphrase.trim().length >= 6 ? vaultPassphrase.trim() : undefined,
      });
      onSessionUpdated(nextSession);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Verification failed.';
      if (msg === '2FA_REQUIRED') {
        setPhoneStep('2fa');
        setError('Two-Step Verification is enabled on this account. Enter your 2FA Cloud Password.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleStartQr = async () => {
    setError(null);
    const credCheck = validateTelegramCredentials(apiId, apiHash);
    if (!credCheck.valid) {
      setError(credCheck.error);
      return;
    }

    setLoading(true);
    setQrDataUrl(null);
    setQrNeeds2fa(false);
    setQrPassword('');

    try {
      const nextSession = await tgClient.startQrLogin({
        apiId: credCheck.apiId,
        apiHash: credCheck.apiHash,
        vaultPassphrase: vaultPassphrase.trim().length >= 6 ? vaultPassphrase.trim() : undefined,
        onQrToken: async (qrUrl, expires) => {
          try {
            const url = await QRCode.toDataURL(qrUrl, {
              width: 240,
              margin: 1,
              color: { dark: '#0f172a', light: '#ffffff' },
            });
            setQrDataUrl(url);
            setQrExpiresIn(Math.max(10, expires - Math.floor(Date.now() / 1000)));
            setLoading(false);
          } catch {
            setError('Failed to render QR code.');
            setLoading(false);
          }
        },
        onPasswordNeeded: async () => {
          setQrNeeds2fa(true);
          setLoading(false);
          return new Promise<string>((resolve) => {
            qrPasswordResolverRef.current = resolve;
          });
        },
      });
      onSessionUpdated(nextSession);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'QR login expired or cancelled.');
      setLoading(false);
    }
  };

  const handleQr2faSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!qrPassword.trim()) {
      setError('Enter your 2FA Cloud Password.');
      return;
    }
    setError(null);
    setLoading(true);
    qrPasswordResolverRef.current?.(qrPassword.trim());
    qrPasswordResolverRef.current = null;
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await tgClient.logoutFromTelegram();
      onLoggedOut();
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Connect Telegram MTProto Vault"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-3 sm:p-4"
    >
      <div className="w-full max-w-lg max-h-[92dvh] flex flex-col rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#1E1F20] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-zinc-800 shrink-0">
          <div className="min-w-0 pr-2">
            <h2 className="text-base font-bold text-[#1F1F1F] dark:text-zinc-100 truncate">
              {session ? 'Telegram MTProto Account' : 'Sign In with Telegram'}
            </h2>
            <p className="text-xs text-[#5F6368] dark:text-zinc-400 truncate">
              Direct browser-to-Telegram MTProto 2.0 WSS · Zero relay servers
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Telegram sign in modal"
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-4 overflow-y-auto">
          {session && (
            <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="w-4 h-4" />
                  Connected: {session.displayName}
                </div>
                <p className="text-[11px] font-mono text-emerald-800/80 dark:text-emerald-400/80 mt-0.5 truncate">
                  Channel: {session.channelTitle} ({session.channelId})
                </p>
              </div>
              <button
                type="button"
                disabled={loading}
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 rounded-full border border-red-300 dark:border-red-800 bg-white dark:bg-zinc-900 px-3.5 py-1.5 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          )}

          {/* Shared API Credentials Box */}
          <div className="space-y-3 rounded-2xl border border-slate-200 dark:border-zinc-800 bg-[#F8FAFD] dark:bg-zinc-900/60 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#1F1F1F] dark:text-zinc-100">
                Telegram API Credentials
              </span>
              <a
                href="https://my.telegram.org/apps"
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0B57D0] dark:text-[#A8C7FA] hover:underline"
              >
                Get keys at my.telegram.org
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="tg-api-id" className="block text-[11px] font-semibold text-slate-600 dark:text-zinc-400 mb-1">
                  API ID
                </label>
                <input
                  id="tg-api-id"
                  type="text"
                  inputMode="numeric"
                  value={apiId}
                  onChange={(e) => {
                    setApiId(e.target.value);
                    setError(null);
                  }}
                  placeholder="e.g. 24910221"
                  className="w-full rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-base sm:text-xs font-mono text-[#1F1F1F] dark:text-zinc-100"
                />
              </div>
              <div>
                <label htmlFor="tg-api-hash" className="block text-[11px] font-semibold text-slate-600 dark:text-zinc-400 mb-1">
                  API Hash (32 hex)
                </label>
                <div className="relative">
                  <input
                    id="tg-api-hash"
                    type={showApiHash ? 'text' : 'password'}
                    value={apiHash}
                    onChange={(e) => {
                      setApiHash(e.target.value);
                      setError(null);
                    }}
                    placeholder="32-char hex hash"
                    className="w-full rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 pr-8 text-base sm:text-xs font-mono text-[#1F1F1F] dark:text-zinc-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiHash((v) => !v)}
                    aria-label={showApiHash ? 'Hide API Hash' : 'Show API Hash'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500"
                  >
                    {showApiHash ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Auth Method Switcher */}
          <div className="flex gap-1 p-1 rounded-xl bg-[#F8FAFD] dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => {
                void tgClient.cancelPendingAuth();
                setAuthTab('phone');
                setError(null);
                setLoading(false);
              }}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
                authTab === 'phone'
                  ? 'bg-white dark:bg-zinc-800 text-[#0B57D0] dark:text-[#A8C7FA] shadow-xs'
                  : 'text-slate-600 dark:text-zinc-400'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              Phone OTP
            </button>
            <button
              type="button"
              onClick={() => {
                void tgClient.cancelPendingAuth();
                setAuthTab('qr');
                setError(null);
                setLoading(false);
              }}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
                authTab === 'qr'
                  ? 'bg-white dark:bg-zinc-800 text-[#0B57D0] dark:text-[#A8C7FA] shadow-xs'
                  : 'text-slate-600 dark:text-zinc-400'
              }`}
            >
              <QrCode className="w-3.5 h-3.5" />
              Live QR Code
            </button>
          </div>

          {authTab === 'qr' ? (
            <div className="flex flex-col items-center text-center space-y-3 py-1">
              {loading && !qrDataUrl ? (
                <div className="w-48 h-48 rounded-2xl border border-dashed border-slate-300 dark:border-zinc-700 bg-[#F8FAFD] dark:bg-zinc-900 flex flex-col items-center justify-center gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-[#0B57D0] dark:text-[#A8C7FA]" />
                  <span className="text-xs text-[#5F6368] dark:text-zinc-400">
                    Connecting Telegram WSS...
                  </span>
                </div>
              ) : qrDataUrl ? (
                <>
                  <div className="p-3 rounded-2xl bg-white border border-slate-200 shadow-xs">
                    <img
                      src={qrDataUrl}
                      alt="Live Telegram MTProto QR Login Code"
                      className="w-44 h-44 object-contain"
                    />
                  </div>
                  <p className="text-xs text-[#5F6368] dark:text-zinc-400 max-w-xs leading-relaxed">
                    Open Telegram on your phone → Settings → Devices → <strong>Link Desktop Device</strong>.
                  </p>
                  <div className="flex items-center gap-3 text-xs">
                    {qrExpiresIn > 0 ? (
                      <span className="font-mono tabular-nums font-semibold text-[#0B57D0] dark:text-[#A8C7FA]">
                        Expires in {qrExpiresIn}s
                      </span>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400 font-medium">Expired</span>
                    )}
                    <button
                      type="button"
                      onClick={handleStartQr}
                      className="inline-flex items-center gap-1 font-semibold text-[#0B57D0] dark:text-[#A8C7FA] hover:underline"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Refresh QR
                    </button>
                  </div>
                </>
              ) : (
                <div className="space-y-3 py-3">
                  <p className="text-xs text-[#5F6368] dark:text-zinc-400 max-w-xs mx-auto">
                    Enter your API ID & API Hash above, then generate a real rotating Telegram login QR token directly over MTProto WSS.
                  </p>
                  <button
                    type="button"
                    onClick={handleStartQr}
                    className="inline-flex items-center gap-2 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] text-white px-5 py-2.5 text-xs font-semibold transition-colors"
                  >
                    <QrCode className="w-4 h-4" />
                    Generate Telegram QR Code
                  </button>
                </div>
              )}

              {qrNeeds2fa && (
                <form onSubmit={handleQr2faSubmit} className="w-full max-w-xs space-y-2 text-left pt-1">
                  <label htmlFor="auth-qr-2fa" className="text-xs font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5" />
                    2FA Cloud Password Required
                  </label>
                  <input
                    id="auth-qr-2fa"
                    type="password"
                    value={qrPassword}
                    onChange={(e) => setQrPassword(e.target.value)}
                    placeholder="Enter 2FA Cloud Password"
                    className="w-full rounded-xl border border-amber-300 dark:border-amber-700 bg-[#F8FAFD] dark:bg-zinc-900 px-3 py-2 text-base sm:text-xs text-[#1F1F1F] dark:text-zinc-100"
                  />
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-full bg-amber-600 hover:bg-amber-700 text-white py-2 text-xs font-semibold"
                  >
                    {loading ? 'Verifying 2FA...' : 'Verify 2FA Password'}
                  </button>
                </form>
              )}
            </div>
          ) : phoneStep === 'creds' ? (
            <form onSubmit={handleRequestOtp} className="space-y-3.5">
              <div>
                <label htmlFor="tg-phone" className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                  Phone Number (International Format)
                </label>
                <input
                  id="tg-phone"
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setError(null);
                  }}
                  placeholder="+1 415 555 0199"
                  className="w-full rounded-xl border border-slate-300 dark:border-zinc-700 bg-[#F8FAFD] dark:bg-zinc-900 px-3.5 py-2.5 text-base sm:text-xs font-mono text-[#1F1F1F] dark:text-zinc-100"
                />
              </div>

              <div>
                <label htmlFor="tg-vault-pass" className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                  Encrypt Session with AES-256-GCM Passphrase (optional)
                </label>
                <input
                  id="tg-vault-pass"
                  type="password"
                  value={vaultPassphrase}
                  onChange={(e) => setVaultPassphrase(e.target.value)}
                  placeholder="Min 6 chars (leave empty for instant unlock)"
                  className="w-full rounded-xl border border-slate-300 dark:border-zinc-700 bg-[#F8FAFD] dark:bg-zinc-900 px-3.5 py-2.5 text-base sm:text-xs text-[#1F1F1F] dark:text-zinc-100"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full px-4 py-2 text-xs font-semibold text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] disabled:opacity-50 px-5 py-2 text-xs font-semibold text-white transition-colors"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Sending Code...
                    </>
                  ) : (
                    <>
                      <Cloud className="w-3.5 h-3.5" />
                      Send Login Code
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-3.5">
              <div className="rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/60 px-3.5 py-2.5 text-xs text-[#0B57D0] dark:text-[#A8C7FA]">
                Login code sent to <strong className="font-mono">{phone}</strong>{' '}
                {isCodeViaApp ? 'in your Telegram app.' : 'via SMS.'}
              </div>

              <div>
                <label htmlFor="tg-otp-code" className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                  Verification Code
                </label>
                <input
                  id="tg-otp-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otpCode}
                  onChange={(e) => {
                    setOtpCode(e.target.value);
                    setError(null);
                  }}
                  placeholder="12345"
                  className="w-full rounded-xl border border-slate-300 dark:border-zinc-700 bg-[#F8FAFD] dark:bg-zinc-900 px-4 py-2.5 text-center text-lg font-mono tracking-[0.35em] font-bold text-[#1F1F1F] dark:text-zinc-100"
                />
              </div>

              {phoneStep === '2fa' && (
                <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 p-3 space-y-2">
                  <label htmlFor="tg-2fa-pass" className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                    <Lock className="w-3.5 h-3.5" />
                    2FA Cloud Password
                  </label>
                  <div className="relative">
                    <input
                      id="tg-2fa-pass"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setError(null);
                      }}
                      placeholder="Enter your 2FA Cloud Password"
                      className="w-full rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-zinc-900 px-3 py-2 pr-9 text-base sm:text-xs text-[#1F1F1F] dark:text-zinc-100"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500"
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setPhoneStep('creds');
                    setOtpCode('');
                    setPassword('');
                    setError(null);
                  }}
                  className="rounded-full border border-slate-300 dark:border-zinc-700 px-4 py-2 text-xs font-semibold text-slate-600 dark:text-zinc-300"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] disabled:opacity-50 px-5 py-2 text-xs font-semibold text-white transition-colors"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      {phoneStep === '2fa' ? 'Verify 2FA & Sign In' : 'Sign In'}
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {error && (
            <div role="alert" className="rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
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
  session: TelegramSessionPayload | null;
  onThemeChange: (t: ThemeMode) => void;
  onClose: () => void;
  onOpenTelegramAuth: () => void;
  onOpenRebuildIndex: () => void;
  onLockVault: () => void;
  onLoggedOut: () => void;
}

export function SettingsModal({
  open,
  theme,
  session,
  onThemeChange,
  onClose,
  onOpenTelegramAuth,
  onOpenRebuildIndex,
  onLockVault,
  onLoggedOut,
}: SettingsModalProps) {
  const [autoLock, setAutoLock] = useState(() => getAutoLockMinutes());
  const [vaultPass, setVaultPass] = useState('');
  const [vaultFeedback, setVaultFeedback] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);

  if (!open) return null;

  const hasEncryptedVault = Boolean(loadEncryptedVaultEnvelope());

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
    if (!session) {
      setVaultFeedback('Sign in with Telegram first to encrypt your session vault.');
      return;
    }
    if (vaultPass.length < 6) {
      setVaultFeedback('Enter a passphrase of at least 6 characters to encrypt the session vault.');
      return;
    }
    try {
      await saveEncryptedSessionVault(session, vaultPass);
      tgClient.saveSession(session, vaultPass);
      setVaultPass('');
      setVaultFeedback(
        'Session vault encrypted with PBKDF2 (100,000 SHA-256 rounds) + AES-256-GCM.'
      );
    } catch (err) {
      setVaultFeedback(err instanceof Error ? err.message : 'Encryption failed.');
    }
  };

  const handleExportRecoveryKit = async () => {
    const envelope = loadEncryptedVaultEnvelope();
    if (!envelope) {
      setVaultFeedback('Seal your session with a passphrase above first, then export the Recovery Kit.');
      return;
    }
    const text = buildEmergencyRecoveryKit(envelope, session?.channelTitle || 'Framely Photos Vault');
    downloadTextFile('framely-emergency-recovery-kit.txt', text);
    setVaultFeedback('Downloaded framely-emergency-recovery-kit.txt with salt, IV, and encrypted envelope.');
  };

  const handlePanicWipe = async () => {
    await tgClient.logoutFromTelegram();
    await executePanicWipe(clearAllIndexedDb);
    setConfirmWipe(false);
    onLoggedOut();
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Framely Settings and Vault Security"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-3 sm:p-4"
    >
      <div className="w-full max-w-xl max-h-[90dvh] flex flex-col rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#1E1F20] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-zinc-800 shrink-0">
          <div className="min-w-0 pr-2">
            <h2 className="text-base font-bold text-[#1F1F1F] dark:text-zinc-100 truncate">
              Settings & Vault Security
            </h2>
            <p className="text-xs text-[#5F6368] dark:text-zinc-400 truncate">
              {session
                ? `${session.channelTitle} · Channel ${session.channelId}`
                : 'Not connected to Telegram'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-6 overflow-y-auto">
          {/* Theme Mode */}
          <section className="space-y-2.5">
            <h3 className="text-xs font-semibold text-slate-500 dark:text-zinc-400">
              Appearance Theme
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'light', label: 'White', Icon: Sun },
                  { id: 'dark', label: 'Dark', Icon: Moon },
                  { id: 'oled', label: 'OLED', Icon: Monitor },
                ] as const
              ).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onThemeChange(id)}
                  aria-pressed={theme === id}
                  className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors ${
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

          {/* Telegram Channel Connection & Index Rebuild */}
          <section className="pt-4 border-t border-slate-200 dark:border-zinc-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[#1F1F1F] dark:text-zinc-100">
                  Telegram MTProto Cloud
                </h3>
                <p className="text-xs text-[#5F6368] dark:text-zinc-400">
                  {session
                    ? `Signed in as ${session.displayName} (${session.dcEndpoint})`
                    : 'No active Telegram session'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenTelegramAuth();
                  }}
                  className="rounded-full border border-slate-300 dark:border-zinc-700 px-3.5 py-1.5 text-xs font-semibold text-[#0B57D0] dark:text-[#A8C7FA] hover:bg-[#D3E3FD]/40 dark:hover:bg-[#004A77]/40 transition-colors"
                >
                  {session ? 'Manage Account' : 'Sign In'}
                </button>
                {session && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenRebuildIndex();
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 dark:border-zinc-700 px-3.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Rebuild Index
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* Zero-Knowledge Session Encryption & Auto-Lock */}
          <section className="pt-4 border-t border-slate-200 dark:border-zinc-800 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <h3 className="text-sm font-semibold text-[#1F1F1F] dark:text-zinc-100">
                  AES-256-GCM Session Vault & Auto-Lock
                </h3>
              </div>
              {hasEncryptedVault && session && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onLockVault();
                  }}
                  className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-zinc-800 px-3 py-1 text-[11px] font-semibold text-[#1F1F1F] dark:text-zinc-200"
                >
                  <Lock className="w-3 h-3" />
                  Lock Now
                </button>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="password"
                value={vaultPass}
                onChange={(e) => setVaultPass(e.target.value)}
                placeholder="Master passphrase (min 6 chars)"
                className="flex-1 rounded-xl border border-slate-300 dark:border-zinc-700 bg-[#F8FAFD] dark:bg-zinc-900 px-3 py-2 text-base sm:text-xs text-[#1F1F1F] dark:text-zinc-100"
              />
              <button
                type="button"
                onClick={handleSealSessionVault}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#0B57D0] hover:bg-[#0842A0] text-white px-4 py-2 text-xs font-semibold whitespace-nowrap"
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
              Revokes the Telegram session and immediately purges all IndexedDB media caches, encrypted session keys, and localStorage entries from this browser.
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
              <div className="flex flex-wrap items-center gap-2">
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-3 sm:p-4"
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
              className="flex-1 rounded-xl border border-slate-300 dark:border-zinc-700 bg-[#F8FAFD] dark:bg-zinc-900 px-3 py-2 text-base sm:text-xs text-[#1F1F1F] dark:text-zinc-100"
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-3 sm:p-4"
    >
      <div className="w-full max-w-md max-h-[85dvh] flex flex-col rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#1E1F20] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-zinc-800 shrink-0">
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
        <div className="p-5 overflow-y-auto space-y-3">
          {jobs.length === 0 ? (
            <p className="text-xs text-[#5F6368] dark:text-zinc-400 text-center py-6">
              No active uploads or ZIP exports yet. Every file transfers in 128 KB chunks directly over Telegram MTProto WebSockets.
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
  channelTitle,
  onClose,
}: {
  open: boolean;
  usedBytes: number;
  itemCount: number;
  channelTitle?: string;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Telegram unlimited storage breakdown"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-3 sm:p-4"
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
            <div className="flex items-center justify-between gap-2">
              <span>Storage Channel</span>
              <span className="font-semibold text-[#1F1F1F] dark:text-zinc-100 truncate">
                {channelTitle || 'Not connected'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Indexed Masters</span>
              <span className="font-mono font-semibold tabular-nums text-[#1F1F1F] dark:text-zinc-100">
                {formatBytes(usedBytes)} ({itemCount})
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Telegram Cloud Cost</span>
              <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                $0.00 / month
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Single File Limit</span>
              <span className="font-mono font-semibold tabular-nums text-[#1F1F1F] dark:text-zinc-100">
                2,048 MB (4,096 MB Premium)
              </span>
            </div>
          </div>
          <div className="flex items-start gap-2.5 text-xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              Your private Telegram channel has no total storage ceiling. Framely caches thumbnails locally in IndexedDB while keeping full bit-for-bit masters inside your Telegram channel.
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
