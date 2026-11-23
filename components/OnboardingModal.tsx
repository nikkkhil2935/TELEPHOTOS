'use client';

import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Upload,
  X,
} from 'lucide-react';
import type { TelegramSessionPayload } from '@/lib/types';
import { tgClient } from '@/lib/services/tgClient';
import {
  buildEmergencyRecoveryKit,
  downloadTextFile,
  saveEncryptedSessionVault,
} from '@/lib/services/vaultService';
import {
  validateInternationalPhone,
  validateTelegramCredentials,
} from '@/lib/utils/telegram';
import { FramelyLogo } from './FramelyLogo';

export const ONBOARDING_COMPLETED_KEY = 'framely_onboarding_completed';

interface OnboardingModalProps {
  open: boolean;
  onClose: () => void;
  onAuthenticated: (session: TelegramSessionPayload, runInitialSync?: boolean) => void;
}

export function OnboardingModal({
  open,
  onClose,
  onAuthenticated,
}: OnboardingModalProps) {
  const envApiId = process.env.NEXT_PUBLIC_TELEGRAM_API_ID || '';
  const envApiHash = process.env.NEXT_PUBLIC_TELEGRAM_API_HASH || '';

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Step 2: Telegram API credentials
  const [apiId, setApiId] = useState(envApiId);
  const [apiHash, setApiHash] = useState(envApiHash);
  const [showApiHash, setShowApiHash] = useState(false);

  // Step 3: Real Telegram Login (Phone OTP + 2FA or Live QR + 2FA)
  const [authMethod, setAuthMethod] = useState<'phone' | 'qr'>('phone');
  const [phone, setPhone] = useState('');
  const [phoneStep, setPhoneStep] = useState<'phone' | 'code' | '2fa'>('phone');
  const [phoneCodeHash, setPhoneCodeHash] = useState('');
  const [isCodeViaApp, setIsCodeViaApp] = useState(true);
  const [otpCode, setOtpCode] = useState('');
  const [twoFaPassword, setTwoFaPassword] = useState('');
  const [showTwoFa, setShowTwoFa] = useState(false);

  // QR state
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrExpiresIn, setQrExpiresIn] = useState(0);
  const [qrNeeds2fa, setQrNeeds2fa] = useState(false);
  const [qrPassword, setQrPassword] = useState('');
  const qrPasswordResolverRef = useRef<((pw: string) => void) | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Authenticated session held between Step 3 -> Step 5
  const [connectedSession, setConnectedSession] = useState<TelegramSessionPayload | null>(null);

  // Step 4: Optional AES-256-GCM vault encryption
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [recoveryDownloaded, setRecoveryDownloaded] = useState(false);
  const [sealing, setSealing] = useState(false);

  // QR expiry countdown
  useEffect(() => {
    if (qrExpiresIn <= 0) return;
    const interval = window.setInterval(() => {
      setQrExpiresIn((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [qrExpiresIn]);

  // Cancel pending MTProto auth socket if modal closes early
  useEffect(() => {
    if (!open) {
      void tgClient.cancelPendingAuth();
    }
  }, [open]);

  if (!open) return null;

  const passStrength = (() => {
    let score = 0;
    if (passphrase.length >= 6) score += 25;
    if (passphrase.length >= 12) score += 25;
    if (/[A-Z]/.test(passphrase) && /[a-z]/.test(passphrase)) score += 25;
    if (/[0-9]/.test(passphrase) || /[^A-Za-z0-9]/.test(passphrase)) score += 25;
    return score;
  })();

  const handleClose = () => {
    void tgClient.cancelPendingAuth();
    onClose();
  };

  const handleContinueFromCredentials = (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateTelegramCredentials(apiId, apiHash);
    if (!check.valid) {
      setError(check.error);
      return;
    }
    setError(null);
    setStep(3);
  };

  const handleSendPhoneCode = async (e: React.FormEvent) => {
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

  const handleVerifyPhoneOtp = async (e: React.FormEvent) => {
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
    if (phoneStep === '2fa' && !twoFaPassword.trim()) {
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
        password: twoFaPassword.trim() || undefined,
      });
      setConnectedSession(nextSession);
      setStep(4);
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

  const handleStartQrLogin = async () => {
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
            setError('Failed to render QR code image.');
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

      setConnectedSession(nextSession);
      setStep(4);
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

  const handleSealAndDownloadKit = async () => {
    if (!connectedSession) return;
    if (passphrase.length < 6) {
      setError('Choose a passphrase with at least 6 characters.');
      return;
    }
    if (passphrase !== confirmPassphrase) {
      setError('Passphrases do not match.');
      return;
    }
    setSealing(true);
    setError(null);
    try {
      const envelope = await saveEncryptedSessionVault(connectedSession, passphrase);
      tgClient.saveSession(connectedSession, passphrase);
      const kit = buildEmergencyRecoveryKit(envelope, connectedSession.channelTitle);
      downloadTextFile(
        `framely-recovery-kit-${new Date().toISOString().slice(0, 10)}.txt`,
        kit
      );
      setRecoveryDownloaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not encrypt session vault.');
    } finally {
      setSealing(false);
    }
  };

  const handleFinishVaultStep = async () => {
    if (!connectedSession) return;
    setError(null);
    if (passphrase.length > 0) {
      if (passphrase.length < 6) {
        setError('Passphrase must be at least 6 characters (or leave blank to skip).');
        return;
      }
      if (passphrase !== confirmPassphrase) {
        setError('Passphrases do not match.');
        return;
      }
      if (!recoveryDownloaded) {
        setSealing(true);
        try {
          await saveEncryptedSessionVault(connectedSession, passphrase);
          tgClient.saveSession(connectedSession, passphrase);
        } finally {
          setSealing(false);
        }
      }
    }
    setStep(5);
  };

  const handleCompleteOnboarding = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true');
    }
    if (connectedSession) {
      onAuthenticated(connectedSession, true);
    }
    onClose();
  };

  const stepLabels = ['Welcome', 'API Keys', 'Telegram Auth', 'Vault Lock', 'Ready'];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Framely Telegram Setup Wizard"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4"
    >
      <div className="w-full max-w-xl max-h-[92dvh] flex flex-col rounded-3xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#1E1F20] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-slate-200 dark:border-zinc-800 shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <FramelyLogo size={26} />
              <div className="min-w-0">
                <h2 className="text-base font-bold text-[#1F1F1F] dark:text-zinc-100 truncate">
                  Connect Your Telegram Cloud
                </h2>
                <p className="text-xs text-[#5F6368] dark:text-zinc-400">
                  Step {step} of 5 · {stepLabels[step - 1]}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close setup wizard"
              className="w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Step progress bar */}
          <div className="mt-3.5 grid grid-cols-5 gap-1.5" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((idx) => (
              <div
                key={idx}
                className={`h-1 rounded-full transition-colors ${
                  idx <= step ? 'bg-[#0B57D0] dark:bg-[#A8C7FA]' : 'bg-slate-200 dark:bg-zinc-800'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-4">
          {/* STEP 1: WELCOME */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <h3 className="text-lg font-bold tracking-tight text-[#1F1F1F] dark:text-zinc-100">
                  Unlimited lossless photo storage in your own Telegram
                </h3>
                <p className="text-sm text-[#5F6368] dark:text-zinc-300 leading-relaxed">
                  Framely connects directly from your browser to official Telegram datacenters over MTProto 2.0 WebSockets. No middleman backend ever touches your photos or session keys.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-[#F8FAFD] dark:bg-zinc-900/60 p-3.5 space-y-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#0B57D0] dark:text-[#A8C7FA]">
                    <ShieldCheck className="w-4 h-4" />
                    Direct MTProto WSS
                  </div>
                  <p className="text-xs text-[#5F6368] dark:text-zinc-400 leading-relaxed">
                    Sign in with Phone OTP or Live QR scan. Your private channel is provisioned automatically.
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-[#F8FAFD] dark:bg-zinc-900/60 p-3.5 space-y-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#0B57D0] dark:text-[#A8C7FA]">
                    <Upload className="w-4 h-4" />
                    Bit-for-Bit Masters
                  </div>
                  <p className="text-xs text-[#5F6368] dark:text-zinc-400 leading-relaxed">
                    Every photo & video up to 2 GB uploads as an uncompressed document with full EXIF preserved.
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-[#F8FAFD] dark:bg-zinc-900/60 p-3.5 space-y-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#0B57D0] dark:text-[#A8C7FA]">
                    <RefreshCw className="w-4 h-4" />
                    Real-Time Channel Sync
                  </div>
                  <p className="text-xs text-[#5F6368] dark:text-zinc-400 leading-relaxed">
                    Photos sent to your vault channel from Telegram mobile appear in Framely automatically.
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-[#F8FAFD] dark:bg-zinc-900/60 p-3.5 space-y-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#0B57D0] dark:text-[#A8C7FA]">
                    <Lock className="w-4 h-4" />
                    Optional AES-256-GCM Vault
                  </div>
                  <p className="text-xs text-[#5F6368] dark:text-zinc-400 leading-relaxed">
                    Optionally lock your browser session with PBKDF2 (100k rounds) and export a Recovery Kit.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: TELEGRAM API KEYS */}
          {step === 2 && (
            <form id="onboarding-creds-form" onSubmit={handleContinueFromCredentials} className="space-y-4">
              <div className="rounded-2xl border border-blue-200/80 dark:border-blue-900/50 bg-[#F8FAFD] dark:bg-zinc-900/70 p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#1F1F1F] dark:text-zinc-100 flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-[#0B57D0] dark:text-[#A8C7FA]" />
                    Get your personal Telegram API keys (30 seconds)
                  </span>
                  <a
                    href="https://my.telegram.org/apps"
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#0B57D0] dark:text-[#A8C7FA] hover:underline shrink-0"
                  >
                    my.telegram.org
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <ol className="text-xs text-[#5F6368] dark:text-zinc-400 space-y-1 list-decimal list-inside leading-relaxed">
                  <li>Sign in at <span className="font-mono text-[#1F1F1F] dark:text-zinc-200">my.telegram.org/apps</span> with your Telegram phone number.</li>
                  <li>Open <strong>API development tools</strong> and create an app (Platform: Web).</li>
                  <li>Paste your <strong>App api_id</strong> and <strong>App api_hash</strong> below. They stay strictly in this browser.</li>
                </ol>
              </div>

              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="onboarding-api-id"
                    className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5"
                  >
                    Telegram API ID
                  </label>
                  <input
                    id="onboarding-api-id"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={apiId}
                    onChange={(e) => {
                      setApiId(e.target.value);
                      setError(null);
                    }}
                    placeholder="e.g. 24910221"
                    className="w-full rounded-xl border border-slate-300 dark:border-zinc-700 bg-[#F8FAFD] dark:bg-zinc-900 px-3.5 py-2.5 text-base sm:text-sm font-mono text-[#1F1F1F] dark:text-zinc-100 focus:border-[#0B57D0] focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="onboarding-api-hash"
                    className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5"
                  >
                    Telegram API Hash (32 hex chars)
                  </label>
                  <div className="relative">
                    <input
                      id="onboarding-api-hash"
                      type={showApiHash ? 'text' : 'password'}
                      autoComplete="off"
                      value={apiHash}
                      onChange={(e) => {
                        setApiHash(e.target.value);
                        setError(null);
                      }}
                      placeholder="32-character hexadecimal hash"
                      className="w-full rounded-xl border border-slate-300 dark:border-zinc-700 bg-[#F8FAFD] dark:bg-zinc-900 px-3.5 py-2.5 pr-10 text-base sm:text-sm font-mono text-[#1F1F1F] dark:text-zinc-100 focus:border-[#0B57D0] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiHash((v) => !v)}
                      aria-label={showApiHash ? 'Hide API Hash' : 'Show API Hash'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-700 dark:text-zinc-400"
                    >
                      {showApiHash ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className="rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300"
                >
                  {error}
                </div>
              )}
            </form>
          )}

          {/* STEP 3: REAL TELEGRAM LOGIN (PHONE OTP + 2FA OR LIVE QR CODE) */}
          {step === 3 && (
            <div className="space-y-4">
              {/* Method Tabs */}
              <div
                role="tablist"
                aria-label="Telegram sign-in method"
                className="flex gap-1 p-1 rounded-xl bg-[#F8FAFD] dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={authMethod === 'phone'}
                  onClick={() => {
                    void tgClient.cancelPendingAuth();
                    setAuthMethod('phone');
                    setError(null);
                    setLoading(false);
                  }}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
                    authMethod === 'phone'
                      ? 'bg-white dark:bg-zinc-800 text-[#0B57D0] dark:text-[#A8C7FA] shadow-xs'
                      : 'text-slate-600 dark:text-zinc-400'
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  Phone OTP
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={authMethod === 'qr'}
                  onClick={() => {
                    void tgClient.cancelPendingAuth();
                    setAuthMethod('qr');
                    setError(null);
                    setLoading(false);
                  }}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
                    authMethod === 'qr'
                      ? 'bg-white dark:bg-zinc-800 text-[#0B57D0] dark:text-[#A8C7FA] shadow-xs'
                      : 'text-slate-600 dark:text-zinc-400'
                  }`}
                >
                  <QrCode className="w-3.5 h-3.5" />
                  Live QR Code
                </button>
              </div>

              {authMethod === 'phone' ? (
                phoneStep === 'phone' ? (
                  <form id="onboarding-phone-form" onSubmit={handleSendPhoneCode} className="space-y-3.5">
                    <div>
                      <label
                        htmlFor="onboarding-phone-input"
                        className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5"
                      >
                        Telegram Phone Number (International Format)
                      </label>
                      <input
                        id="onboarding-phone-input"
                        type="tel"
                        autoComplete="tel"
                        value={phone}
                        onChange={(e) => {
                          setPhone(e.target.value);
                          setError(null);
                        }}
                        placeholder="+1 415 555 0199 or +91 98200 12345"
                        className="w-full rounded-xl border border-slate-300 dark:border-zinc-700 bg-[#F8FAFD] dark:bg-zinc-900 px-3.5 py-2.5 text-base sm:text-sm font-mono text-[#1F1F1F] dark:text-zinc-100 focus:border-[#0B57D0] focus:outline-none"
                      />
                      <p className="text-[11px] text-[#5F6368] dark:text-zinc-400 mt-1.5">
                        Telegram will send an official 5-digit login code to your active Telegram app or SMS.
                      </p>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] disabled:opacity-50 text-white py-2.5 px-5 text-xs font-semibold transition-colors"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Sending OTP via Telegram MTProto...
                        </>
                      ) : (
                        <>
                          <Smartphone className="w-4 h-4" />
                          Send Verification Code
                        </>
                      )}
                    </button>
                  </form>
                ) : (
                  <form id="onboarding-otp-form" onSubmit={handleVerifyPhoneOtp} className="space-y-3.5">
                    <div className="rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200/80 dark:border-blue-900/50 px-3.5 py-2.5 text-xs text-[#0B57D0] dark:text-[#A8C7FA]">
                      Code sent to <strong className="font-mono">{phone}</strong>{' '}
                      {isCodeViaApp ? 'via your Telegram app.' : 'via SMS.'}
                    </div>

                    <div>
                      <label
                        htmlFor="onboarding-otp-input"
                        className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5"
                      >
                        5-Digit Telegram Login Code
                      </label>
                      <input
                        id="onboarding-otp-input"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={otpCode}
                        onChange={(e) => {
                          setOtpCode(e.target.value);
                          setError(null);
                        }}
                        placeholder="12345"
                        className="w-full rounded-xl border border-slate-300 dark:border-zinc-700 bg-[#F8FAFD] dark:bg-zinc-900 px-4 py-3 text-center text-lg font-mono tracking-[0.35em] font-bold text-[#1F1F1F] dark:text-zinc-100 focus:border-[#0B57D0] focus:outline-none"
                      />
                    </div>

                    {phoneStep === '2fa' && (
                      <div className="rounded-2xl border border-amber-300/80 dark:border-amber-800/60 bg-amber-50/70 dark:bg-amber-950/30 p-3.5 space-y-2">
                        <label
                          htmlFor="onboarding-2fa-input"
                          className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300"
                        >
                          <Lock className="w-3.5 h-3.5" />
                          Telegram 2FA Cloud Password (SRP-6A)
                        </label>
                        <div className="relative">
                          <input
                            id="onboarding-2fa-input"
                            type={showTwoFa ? 'text' : 'password'}
                            autoComplete="current-password"
                            value={twoFaPassword}
                            onChange={(e) => {
                              setTwoFaPassword(e.target.value);
                              setError(null);
                            }}
                            placeholder="Enter your 2FA Cloud Password"
                            className="w-full rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-zinc-900 px-3.5 py-2.5 pr-10 text-base sm:text-sm text-[#1F1F1F] dark:text-zinc-100 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => setShowTwoFa((v) => !v)}
                            aria-label={showTwoFa ? 'Hide 2FA password' : 'Show 2FA password'}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-500"
                          >
                            {showTwoFa ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setPhoneStep('phone');
                          setOtpCode('');
                          setTwoFaPassword('');
                          setError(null);
                        }}
                        className="rounded-full border border-slate-300 dark:border-zinc-700 px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800"
                      >
                        Change Phone
                      </button>
                      <button
                        type="submit"
                        disabled={loading}
                        className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] disabled:opacity-50 text-white py-2.5 px-5 text-xs font-semibold transition-colors"
                      >
                        {loading ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Verifying with Telegram...
                          </>
                        ) : (
                          <>
                            <Check className="w-4 h-4" />
                            {phoneStep === '2fa' ? 'Verify 2FA & Sign In' : 'Verify Code & Sign In'}
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                )
              ) : (
                <div className="flex flex-col items-center text-center space-y-3.5 py-1">
                  {loading && !qrDataUrl ? (
                    <div className="w-52 h-52 rounded-2xl border border-dashed border-slate-300 dark:border-zinc-700 bg-[#F8FAFD] dark:bg-zinc-900 flex flex-col items-center justify-center gap-2.5">
                      <Loader2 className="w-7 h-7 animate-spin text-[#0B57D0] dark:text-[#A8C7FA]" />
                      <span className="text-xs text-[#5F6368] dark:text-zinc-400">
                        Opening Telegram MTProto WSS...
                      </span>
                    </div>
                  ) : qrDataUrl ? (
                    <>
                      <div className="p-3 rounded-2xl bg-white border border-slate-200 shadow-sm">
                        <img
                          src={qrDataUrl}
                          alt="Live Telegram MTProto QR Login Code"
                          className="w-48 h-48 object-contain"
                        />
                      </div>
                      <div className="space-y-1 max-w-xs">
                        <p className="text-xs font-semibold text-[#1F1F1F] dark:text-zinc-100">
                          Scan with Telegram on your phone
                        </p>
                        <p className="text-[11px] text-[#5F6368] dark:text-zinc-400">
                          Telegram → Settings → Devices → <strong>Link Desktop Device</strong>
                        </p>
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        {qrExpiresIn > 0 ? (
                          <span className="font-mono tabular-nums text-[#0B57D0] dark:text-[#A8C7FA] font-semibold">
                            Expires in {qrExpiresIn}s
                          </span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400 font-medium">
                            QR token expired
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={handleStartQrLogin}
                          className="inline-flex items-center gap-1 font-semibold text-[#0B57D0] dark:text-[#A8C7FA] hover:underline"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          Refresh QR
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-3 py-4">
                      <div className="w-14 h-14 mx-auto rounded-2xl bg-[#D3E3FD]/70 dark:bg-[#004A77]/60 text-[#0B57D0] dark:text-[#A8C7FA] flex items-center justify-center">
                        <QrCode className="w-7 h-7" />
                      </div>
                      <p className="text-xs text-[#5F6368] dark:text-zinc-400 max-w-xs mx-auto leading-relaxed">
                        Generate a live rotating Telegram MTProto QR token directly from Telegram datacenters—no phone number typing required.
                      </p>
                      <button
                        type="button"
                        onClick={handleStartQrLogin}
                        className="inline-flex items-center gap-2 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] text-white px-5 py-2.5 text-xs font-semibold transition-colors"
                      >
                        <QrCode className="w-4 h-4" />
                        Generate Live Telegram QR Code
                      </button>
                    </div>
                  )}

                  {qrNeeds2fa && (
                    <form onSubmit={handleQr2faSubmit} className="w-full max-w-xs space-y-2 text-left pt-2">
                      <label
                        htmlFor="onboarding-qr-2fa"
                        className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300"
                      >
                        <Lock className="w-3.5 h-3.5" />
                        2FA Cloud Password Required
                      </label>
                      <input
                        id="onboarding-qr-2fa"
                        type="password"
                        value={qrPassword}
                        onChange={(e) => setQrPassword(e.target.value)}
                        placeholder="Enter Telegram 2FA Password"
                        className="w-full rounded-xl border border-amber-300 dark:border-amber-700 bg-[#F8FAFD] dark:bg-zinc-900 px-3.5 py-2 text-base sm:text-sm text-[#1F1F1F] dark:text-zinc-100"
                      />
                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full rounded-full bg-amber-600 hover:bg-amber-700 text-white py-2 text-xs font-semibold"
                      >
                        {loading ? 'Verifying 2FA...' : 'Submit 2FA Password'}
                      </button>
                    </form>
                  )}
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300"
                >
                  {error}
                </div>
              )}
            </div>
          )}

          {/* STEP 4: OPTIONAL AES-256-GCM SESSION ENCRYPTION */}
          {step === 4 && connectedSession && (
            <div className="space-y-4">
              <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60 p-3.5 flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <div className="min-w-0 text-xs">
                  <p className="font-semibold text-emerald-800 dark:text-emerald-300">
                    Signed in as {connectedSession.displayName}
                  </p>
                  <p className="text-emerald-700/80 dark:text-emerald-400/80 truncate">
                    Storage Channel: {connectedSession.channelTitle} ({connectedSession.channelId})
                  </p>
                </div>
              </div>

              <div className="space-y-1">
                <h3 className="text-sm font-bold text-[#1F1F1F] dark:text-zinc-100">
                  Protect Browser Session with AES-256-GCM (Optional)
                </h3>
                <p className="text-xs text-[#5F6368] dark:text-zinc-400 leading-relaxed">
                  Add a master passphrase to encrypt your Telegram session key in this browser (PBKDF2 100,000 SHA-256 rounds), or leave blank to stay signed in immediately.
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="onboarding-vault-pass"
                    className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1"
                  >
                    Vault Passphrase (Optional, min 6 chars)
                  </label>
                  <div className="relative">
                    <input
                      id="onboarding-vault-pass"
                      type={showPassphrase ? 'text' : 'password'}
                      value={passphrase}
                      onChange={(e) => {
                        setPassphrase(e.target.value);
                        setError(null);
                      }}
                      placeholder="Leave empty to skip passphrase lock"
                      className="w-full rounded-xl border border-slate-300 dark:border-zinc-700 bg-[#F8FAFD] dark:bg-zinc-900 px-3.5 py-2.5 pr-10 text-base sm:text-sm text-[#1F1F1F] dark:text-zinc-100"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassphrase((v) => !v)}
                      aria-label={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-500"
                    >
                      {showPassphrase ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {passphrase.length > 0 && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-zinc-800 overflow-hidden">
                        <div
                          className={`h-full transition-all ${
                            passStrength >= 75
                              ? 'bg-emerald-500'
                              : passStrength >= 50
                                ? 'bg-amber-500'
                                : 'bg-red-500'
                          }`}
                          style={{ width: `${passStrength}%` }}
                        />
                      </div>
                      <span className="text-[11px] font-mono text-slate-500">
                        {passStrength >= 75 ? 'Strong' : passStrength >= 50 ? 'Medium' : 'Weak'}
                      </span>
                    </div>
                  )}
                </div>

                {passphrase.length > 0 && (
                  <>
                    <div>
                      <label
                        htmlFor="onboarding-vault-confirm"
                        className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1"
                      >
                        Confirm Passphrase
                      </label>
                      <input
                        id="onboarding-vault-confirm"
                        type={showPassphrase ? 'text' : 'password'}
                        value={confirmPassphrase}
                        onChange={(e) => {
                          setConfirmPassphrase(e.target.value);
                          setError(null);
                        }}
                        placeholder="Re-enter passphrase"
                        className="w-full rounded-xl border border-slate-300 dark:border-zinc-700 bg-[#F8FAFD] dark:bg-zinc-900 px-3.5 py-2.5 text-base sm:text-sm text-[#1F1F1F] dark:text-zinc-100"
                      />
                    </div>

                    <button
                      type="button"
                      disabled={sealing}
                      onClick={handleSealAndDownloadKit}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-zinc-700 px-3.5 py-2 text-xs font-semibold text-[#0B57D0] dark:text-[#A8C7FA] hover:bg-slate-50 dark:hover:bg-zinc-800"
                    >
                      <Download className="w-3.5 h-3.5" />
                      {recoveryDownloaded
                        ? 'Recovery Kit Downloaded ✓'
                        : 'Encrypt Vault & Download Recovery Kit'}
                    </button>
                  </>
                )}
              </div>

              {error && (
                <div
                  role="alert"
                  className="rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300"
                >
                  {error}
                </div>
              )}
            </div>
          )}

          {/* STEP 5: READY */}
          {step === 5 && connectedSession && (
            <div className="text-center space-y-4 py-2">
              <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-[#1F1F1F] dark:text-zinc-100">
                  Your Telegram Vault Is Live
                </h3>
                <p className="text-xs text-[#5F6368] dark:text-zinc-400 max-w-sm mx-auto leading-relaxed">
                  Connected to <strong>{connectedSession.channelTitle}</strong> over direct MTProto 2.0 WebSockets. Framely will immediately index existing media in your channel and listen for new uploads in real time.
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-[#F8FAFD] dark:bg-zinc-900/60 p-4 text-left space-y-2 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="text-[#5F6368] dark:text-zinc-400">Account</span>
                  <span className="font-semibold text-[#1F1F1F] dark:text-zinc-100">
                    {connectedSession.displayName}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-[#5F6368] dark:text-zinc-400">Private Channel</span>
                  <span className="font-mono text-[#1F1F1F] dark:text-zinc-100 truncate">
                    {connectedSession.channelTitle}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-[#5F6368] dark:text-zinc-400">Gateway</span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-400">
                    {connectedSession.dcEndpoint}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Controls */}
        <div className="px-5 sm:px-6 py-4 border-t border-slate-200 dark:border-zinc-800 bg-[#F8FAFD] dark:bg-zinc-900/50 flex items-center justify-between gap-3 shrink-0">
          {step === 1 ? (
            <button
              type="button"
              onClick={handleClose}
              className="rounded-full px-3.5 py-2 text-xs font-semibold text-slate-600 dark:text-zinc-400 hover:bg-slate-200/70 dark:hover:bg-zinc-800"
            >
              Later
            </button>
          ) : step < 4 ? (
            <button
              type="button"
              onClick={() => {
                void tgClient.cancelPendingAuth();
                setError(null);
                setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4 | 5) : 1));
              }}
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold text-slate-600 dark:text-zinc-300 hover:bg-slate-200/70 dark:hover:bg-zinc-800"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </button>
          ) : (
            <div />
          )}

          {step === 1 && (
            <button
              type="button"
              onClick={() => setStep(2)}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] text-white px-5 py-2 text-xs font-semibold transition-colors"
            >
              Get Started
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}

          {step === 2 && (
            <button
              type="submit"
              form="onboarding-creds-form"
              className="inline-flex items-center gap-1.5 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] text-white px-5 py-2 text-xs font-semibold transition-colors"
            >
              Continue to Sign In
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}

          {step === 3 && (
            <span className="text-[11px] text-[#5F6368] dark:text-zinc-400">
              Direct WSS · Zero relay servers
            </span>
          )}

          {step === 4 && (
            <button
              type="button"
              disabled={sealing}
              onClick={handleFinishVaultStep}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] disabled:opacity-50 text-white px-5 py-2 text-xs font-semibold transition-colors"
            >
              {passphrase.length > 0 ? 'Save & Continue' : 'Skip & Continue'}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}

          {step === 5 && (
            <button
              type="button"
              onClick={handleCompleteOnboarding}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] text-white px-6 py-2 text-xs font-semibold transition-colors"
            >
              Open My Photos
              <Check className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
