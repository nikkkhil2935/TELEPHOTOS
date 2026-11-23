'use client';

import React, { useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, Lock, ShieldAlert } from 'lucide-react';
import type { TelegramSessionPayload } from '@/lib/types';
import { tgClient } from '@/lib/services/tgClient';
import { FramelyLogo } from './FramelyLogo';

interface VaultUnlockModalProps {
  open: boolean;
  onUnlocked: (session: TelegramSessionPayload) => void;
  onSignInFresh: () => void;
}

export function VaultUnlockModal({
  open,
  onUnlocked,
  onSignInFresh,
}: VaultUnlockModalProps) {
  const [passphrase, setPassphrase] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase.trim()) {
      setError('Enter your AES-256-GCM vault passphrase.');
      return;
    }
    setUnlocking(true);
    setError(null);
    try {
      const session = await tgClient.unlockEncryptedSession(passphrase.trim());
      setPassphrase('');
      onUnlocked(session);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Decryption failed. Check your master vault passphrase.'
      );
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Unlock Encrypted Telegram Vault"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md rounded-3xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#1E1F20] shadow-2xl p-6 space-y-5">
        <div className="flex flex-col items-center text-center space-y-2">
          <FramelyLogo size={36} />
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0B57D0] dark:text-[#A8C7FA]">
            <Lock className="w-3.5 h-3.5" />
            AES-256-GCM Vault Locked
          </div>
          <h2 className="text-lg font-bold text-[#1F1F1F] dark:text-zinc-100">
            Unlock Your Telegram Session
          </h2>
          <p className="text-xs text-[#5F6368] dark:text-zinc-400 leading-relaxed">
            Your Telegram session is encrypted locally with PBKDF2 (100,000 SHA-256 iterations). Enter your passphrase to decrypt and reconnect MTProto WSS.
          </p>
        </div>

        <form onSubmit={handleUnlock} className="space-y-3.5">
          <div>
            <label
              htmlFor="session-vault-pass"
              className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5"
            >
              Master Vault Passphrase
            </label>
            <div className="relative">
              <input
                id="session-vault-pass"
                type={showPass ? 'text' : 'password'}
                autoFocus
                value={passphrase}
                onChange={(e) => {
                  setPassphrase(e.target.value);
                  setError(null);
                }}
                placeholder="Enter passphrase"
                className="w-full rounded-xl border border-slate-300 dark:border-zinc-700 bg-[#F8FAFD] dark:bg-zinc-900 px-3.5 py-2.5 pr-10 text-base sm:text-sm text-[#1F1F1F] dark:text-zinc-100 focus:border-[#0B57D0] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                aria-label={showPass ? 'Hide passphrase' : 'Show passphrase'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-500"
              >
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

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
            disabled={unlocking}
            className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] disabled:opacity-50 text-white py-2.5 text-xs font-semibold transition-colors"
          >
            {unlocking ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Decrypting & Reconnecting...
              </>
            ) : (
              <>
                <KeyRound className="w-4 h-4" />
                Unlock & Connect Telegram
              </>
            )}
          </button>
        </form>

        <div className="pt-2 border-t border-slate-200 dark:border-zinc-800 text-center">
          <button
            type="button"
            onClick={onSignInFresh}
            className="text-xs font-medium text-[#5F6368] dark:text-zinc-400 hover:text-[#0B57D0] dark:hover:text-[#A8C7FA] hover:underline"
          >
            Sign in with a different Telegram account
          </button>
        </div>
      </div>
    </div>
  );
}
