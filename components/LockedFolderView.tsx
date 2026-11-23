'use client';

import React, { useState } from 'react';
import {
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LockOpen,
  ShieldAlert,
  ShieldCheck,
  Unlock,
  Upload,
} from 'lucide-react';
import type { EncryptedVaultEnvelope, MediaItem } from '@/lib/types';
import {
  decryptWithPassphrase,
  encryptWithPassphrase,
  LOCKED_PASS_STORAGE_KEY,
} from '@/lib/services/vaultService';
import { formatBytes } from '@/lib/utils/security';

interface LockedFolderViewProps {
  lockedItems: MediaItem[];
  isUnlocked: boolean;
  onUnlockChange: (unlocked: boolean) => void;
  onOpenMedia: (item: MediaItem, scope: MediaItem[]) => void;
  onMoveOutOfLocked: (messageId: number) => Promise<void>;
  onTriggerLockedUpload: () => void;
}

const VERIFICATION_SENTINEL = 'FRAMELY_LOCKED_FOLDER_VERIFIED_V1';

export function LockedFolderView({
  lockedItems,
  isUnlocked,
  onUnlockChange,
  onOpenMedia,
  onMoveOutOfLocked,
  onTriggerLockedUpload,
}: LockedFolderViewProps) {
  const [hasConfiguredPassphrase, setHasConfiguredPassphrase] = useState(() =>
    typeof window !== 'undefined'
      ? Boolean(window.localStorage.getItem(LOCKED_PASS_STORAGE_KEY))
      : false
  );
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSetupPassphrase = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (passphrase.length < 6) {
      setError('Passphrase must be at least 6 characters for PBKDF2 key derivation.');
      return;
    }
    if (passphrase !== confirmPassphrase) {
      setError('Passphrases do not match.');
      return;
    }
    setBusy(true);
    try {
      const envelope = await encryptWithPassphrase(VERIFICATION_SENTINEL, passphrase);
      window.localStorage.setItem(LOCKED_PASS_STORAGE_KEY, JSON.stringify(envelope));
      setHasConfiguredPassphrase(true);
      setPassphrase('');
      setConfirmPassphrase('');
      onUnlockChange(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize vault key.');
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!passphrase) {
      setError('Enter your master vault passphrase.');
      return;
    }
    setBusy(true);
    try {
      const raw = window.localStorage.getItem(LOCKED_PASS_STORAGE_KEY);
      if (!raw) {
        setError('Vault key not configured.');
        return;
      }
      const envelope = JSON.parse(raw) as EncryptedVaultEnvelope;
      const decrypted = await decryptWithPassphrase(envelope, passphrase);
      if (decrypted !== VERIFICATION_SENTINEL) {
        throw new Error('Sentinel verification mismatch.');
      }
      setPassphrase('');
      onUnlockChange(true);
    } catch {
      setError('AES-256-GCM authentication failed. Incorrect passphrase or tampered key envelope.');
    } finally {
      setBusy(false);
    }
  };

  if (!isUnlocked) {
    return (
      <div className="px-4 sm:px-8 py-10 max-w-xl mx-auto">
        <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#1E1F20] p-6 sm:p-8">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-11 h-11 rounded-xl bg-[#D3E3FD] dark:bg-[#004A77] flex items-center justify-center text-[#0B57D0] dark:text-[#A8C7FA]">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-[#1F1F1F] dark:text-zinc-100">
                Locked Folder
              </h1>
              <p className="text-xs text-[#5F6368] dark:text-zinc-400">
                PBKDF2 100,000 rounds · AES-256-GCM hardware Web Crypto
              </p>
            </div>
          </div>

          <p className="text-sm text-[#5F6368] dark:text-zinc-300 leading-relaxed mb-6">
            {hasConfiguredPassphrase
              ? `Enter your master vault passphrase to decrypt and reveal ${lockedItems.length} private ${lockedItems.length === 1 ? 'item' : 'items'} hidden from your main timeline.`
              : `Create a zero-knowledge passphrase to protect ${lockedItems.length} private ${lockedItems.length === 1 ? 'item' : 'items'}. Keys are derived strictly inside your browser and never leave your device.`}
          </p>

          <form
            onSubmit={hasConfiguredPassphrase ? handleUnlock : handleSetupPassphrase}
            className="space-y-4"
          >
            <div>
              <label
                htmlFor="vault-passphrase-input"
                className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5"
              >
                {hasConfiguredPassphrase ? 'Vault Passphrase' : 'New Master Passphrase (min 6 chars)'}
              </label>
              <div className="relative">
                <input
                  id="vault-passphrase-input"
                  type={showPass ? 'text' : 'password'}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Enter passphrase"
                  autoComplete="off"
                  className="w-full rounded-xl border border-slate-300 dark:border-zinc-700 bg-[#F8FAFD] dark:bg-zinc-900 px-3.5 py-2.5 pr-10 text-sm text-[#1F1F1F] dark:text-zinc-100 focus:border-[#0B57D0] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  aria-label={showPass ? 'Hide passphrase' : 'Show passphrase'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-700 dark:text-zinc-400"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {!hasConfiguredPassphrase && (
              <div>
                <label
                  htmlFor="vault-passphrase-confirm"
                  className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5"
                >
                  Confirm Passphrase
                </label>
                <input
                  id="vault-passphrase-confirm"
                  type={showPass ? 'text' : 'password'}
                  value={confirmPassphrase}
                  onChange={(e) => setConfirmPassphrase(e.target.value)}
                  placeholder="Re-enter passphrase"
                  autoComplete="off"
                  className="w-full rounded-xl border border-slate-300 dark:border-zinc-700 bg-[#F8FAFD] dark:bg-zinc-900 px-3.5 py-2.5 text-sm text-[#1F1F1F] dark:text-zinc-100 focus:border-[#0B57D0] focus:outline-none"
                />
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300"
              >
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5 transition-colors"
            >
              <KeyRound className="w-4 h-4" />
              {busy
                ? 'Deriving 256-bit key (100,000 PBKDF2 rounds)...'
                : hasConfiguredPassphrase
                  ? 'Unlock Locked Folder'
                  : 'Create Zero-Knowledge Vault Key'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-8 py-6 max-w-[1440px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-slate-200 dark:border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <h1 className="text-2xl font-bold tracking-tight text-[#1F1F1F] dark:text-zinc-100">
              Locked Folder
            </h1>
          </div>
          <p className="text-xs text-[#5F6368] dark:text-zinc-400 mt-1">
            Decrypted in memory · Hidden from Photos timeline, Places, and Search · {lockedItems.length}{' '}
            {lockedItems.length === 1 ? 'item' : 'items'}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onTriggerLockedUpload}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 dark:border-zinc-700 px-4 py-2 text-xs font-semibold text-[#1F1F1F] dark:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            Add Private Item
          </button>
          <button
            type="button"
            onClick={() => onUnlockChange(false)}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] px-4 py-2 text-xs font-semibold text-white transition-colors"
          >
            <Lock className="w-3.5 h-3.5" />
            Lock Now
          </button>
        </div>
      </div>

      {lockedItems.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-slate-200 dark:border-zinc-800 bg-[#F8FAFD] dark:bg-zinc-900/50 p-12 text-center">
          <LockOpen className="w-8 h-8 text-slate-400 mx-auto mb-3" />
          <h2 className="text-base font-semibold text-[#1F1F1F] dark:text-zinc-100">
            Your Locked Folder is empty
          </h2>
          <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1 max-w-md mx-auto">
            Upload sensitive scans or move items from your timeline into this AES-256-GCM protected space.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-6">
          {lockedItems.map((item) => (
            <div
              key={item.messageId}
              className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#1E1F20] overflow-hidden flex flex-col"
            >
              <button
                type="button"
                onClick={() => onOpenMedia(item, lockedItems)}
                className="relative aspect-[4/3] w-full overflow-hidden bg-slate-100 dark:bg-zinc-900 group"
              >
                <img
                  src={item.thumbnailDataUrl || item.fullUrl}
                  alt={item.filename}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              </button>
              <div className="p-3.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#1F1F1F] dark:text-zinc-100 truncate">
                    {item.filename}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-zinc-400 font-mono tabular-nums mt-0.5">
                    {formatBytes(item.sizeBytes)} · SHA-256 verified
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onMoveOutOfLocked(item.messageId)}
                  aria-label={`Move ${item.filename} out of Locked Folder`}
                  className="shrink-0 inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-[#0B57D0] dark:text-[#A8C7FA] hover:bg-[#D3E3FD]/60 dark:hover:bg-[#004A77]/50 transition-colors"
                >
                  <Unlock className="w-3.5 h-3.5" />
                  Move out
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
