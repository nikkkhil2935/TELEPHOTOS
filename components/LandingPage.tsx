'use client';

import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  Camera,
  Check,
  ChevronDown,
  HardDrive,
  KeyRound,
  Lock,
  MapPin,
  Monitor,
  Moon,
  Pause,
  Play,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import { PHOTO_ASSETS } from '@/lib/db/seedData';
import {
  base64ToBytes,
  bytesToBase64,
  decryptWithPassphrase,
  encryptWithPassphrase,
} from '@/lib/services/vaultService';
import type { EncryptedVaultEnvelope, GridDensity, ThemeMode } from '@/lib/types';
import { FramelyLogo } from './FramelyLogo';

interface LandingPageProps {
  theme: ThemeMode;
  onCycleTheme: () => void;
  onLaunchApp: (openAuth?: boolean) => void;
}

type StageTab = 'timeline' | 'places' | 'locked';

const STAGE_TABS: Array<{ id: StageTab; label: string }> = [
  { id: 'timeline', label: 'Photos Timeline' },
  { id: 'places', label: 'Smart Places' },
  { id: 'locked', label: 'Locked Folder' },
];

const COMPARISON_ROWS = [
  {
    feature: 'Cloud Storage Capacity',
    framely: 'Unlimited (Private Telegram Channel)',
    google: '15 GB free (2 TB = $9.99/mo)',
    icloud: '5 GB free (2 TB = $9.99/mo)',
  },
  {
    feature: 'Image & Video Quality',
    framely: '100% Bit-for-Bit Uncompressed Documents',
    google: 'Storage Saver re-encodes & strips bitrate',
    icloud: 'Original quality counts against paid tier',
  },
  {
    feature: 'Single File Size Limit',
    framely: '2,048 MB (4,096 MB w/ TG Premium)',
    google: '200 MB photos / 10 GB video',
    icloud: '50 GB (limited by paid quota)',
  },
  {
    feature: 'Zero-Knowledge Client Encryption',
    framely: 'PBKDF2 100k + AES-256-GCM in Browser',
    google: 'Server-managed keys (AI scanned)',
    icloud: 'Optional Advanced Data Protection',
  },
  {
    feature: 'Middleman Relay Servers',
    framely: '0 Servers — Direct Browser WSS',
    google: 'Proprietary Google Cloud Backend',
    icloud: 'Proprietary Apple CloudKit Backend',
  },
  {
    feature: 'Data Ownership & Lock-In',
    framely: 'Files stay in your Telegram forever',
    google: 'Requires Google Takeout exports',
    icloud: 'Locked to Apple ecosystem',
  },
];

const FAQ_ITEMS = [
  {
    q: 'Does Framely run any backend server that sees my photos or Telegram session?',
    a: 'No. Framely is a 100% client-only web application. Your browser establishes direct TLS WebSocket connections (MTProto 2.0) straight to official Telegram datacenters such as wss://flora-1.web.telegram.org:443. Your session string and API credentials stay strictly inside browser localStorage encrypted with Web Crypto AES-256-GCM.',
  },
  {
    q: 'Why does Framely upload media as Documents instead of Telegram Photos?',
    a: 'Telegram’s standard photo API aggressively downscales images and strips EXIF metadata (camera optics, lens, GPS coordinates, RAW bit depth). Framely enforces forceDocument: true with DocumentAttributeFilename and DocumentAttributeImageSize so every JPEG, DNG, ARW, and 4K video is preserved bit-for-bit with identical SHA-256 checksums.',
  },
  {
    q: 'How does the client-side AES-256-GCM tamper detection work?',
    a: 'Framely derives a 256-bit key locally using PBKDF2 with 100,000 SHA-256 iterations and a unique 16-byte random salt, then encrypts payloads with AES-256-GCM (12-byte IV, 128-bit authentication tag). Flipping even a single bit in the ciphertext invalidates the GCM tag and immediately aborts decryption without leaking plaintext.',
  },
  {
    q: 'Can I upload 4K videos or huge RAW masters without crashing my browser?',
    a: 'Yes. Framely patches GramJS upload streaming to slice browser File and Blob objects in 128 KB increments rather than buffering entire 2,048 MB files into RAM, and downloads large media using 4 concurrent 128 KB chunk workers with an LRU Blob URL cache.',
  },
  {
    q: 'What happens if I open Framely in two browser tabs at the same time?',
    a: 'Framely runs a BroadcastChannel and localStorage heartbeat lock (Single-Tab Protection) to prevent multiple tabs from issuing conflicting MTProto sequence numbers. If another tab is active, a clear banner lets you safely hand control over to the current tab.',
  },
  {
    q: 'How do I recover my encrypted session if I switch computers?',
    a: 'From Vault Settings, export your Emergency Recovery Kit containing your PBKDF2 salt, IV, and AES-256-GCM encrypted envelope. Your actual photos and videos always remain safely stored as original documents inside your private "Framely Photos Vault" Telegram Channel.',
  },
];

export function LandingPage({ theme, onCycleTheme, onLaunchApp }: LandingPageProps) {
  const [stageTab, setStageTab] = useState<StageTab>('timeline');
  const [autoTour, setAutoTour] = useState(true);
  const [bentoDensity, setBentoDensity] = useState<GridDensity>('standard');
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);

  // Live Interactive AES-256-GCM Cipher Harness (Bento Card 1)
  const [cipherInput, setCipherInput] = useState('L1049201_MarineDrive.DNG · lat:18.9438');
  const [cipherPass, setCipherPass] = useState('framely-zero-knowledge-2026');
  const [cipherEnvelope, setCipherEnvelope] = useState<EncryptedVaultEnvelope | null>(null);
  const [tamperStatus, setTamperStatus] = useState<'idle' | 'verified' | 'tampered'>('idle');
  const [tamperMessage, setTamperMessage] = useState<string>('');

  // Auto-Tour Engine for Stageshow Mockup
  useEffect(() => {
    if (!autoTour) return;
    const order: StageTab[] = ['timeline', 'places', 'locked'];
    const id = window.setInterval(() => {
      setStageTab((curr) => order[(order.indexOf(curr) + 1) % order.length]);
    }, 4500);
    return () => window.clearInterval(id);
  }, [autoTour]);

  // Live real Web Crypto encryption whenever cipherInput or cipherPass changes
  useEffect(() => {
    let cancelled = false;
    if (!cipherInput || cipherPass.length < 4) return;
    encryptWithPassphrase(cipherInput, cipherPass)
      .then((env) => {
        if (!cancelled) {
          setCipherEnvelope(env);
          setTamperStatus('verified');
          setTamperMessage('128-bit GCM auth tag intact · 100,000 PBKDF2 rounds');
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cipherInput, cipherPass]);

  const handleTamperBitTest = async () => {
    if (!cipherEnvelope) return;
    const bytes = base64ToBytes(cipherEnvelope.ciphertext);
    bytes[0] = bytes[0] ^ 0x01;
    const mutated: EncryptedVaultEnvelope = {
      ...cipherEnvelope,
      ciphertext: bytesToBase64(bytes),
    };
    try {
      await decryptWithPassphrase(mutated, cipherPass);
    } catch {
      setTamperStatus('tampered');
      setTamperMessage(
        'Bit 0 flipped → AES-256-GCM tag verification rejected decryption loudly (0 bytes leaked).'
      );
    }
  };

  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;

  const bentoPreviewPhotos = [
    PHOTO_ASSETS.mumbaiHarbor,
    PHOTO_ASSETS.vasaiCoast,
    PHOTO_ASSETS.puneGhats,
    PHOTO_ASSETS.kyotoBamboo,
    PHOTO_ASSETS.studioPortrait,
    PHOTO_ASSETS.goldenRetriever,
  ];

  return (
    <div className="min-h-screen bg-white dark:bg-[#131314] text-[#1F1F1F] dark:text-zinc-100">
      {/* Sticky Navigation Bar — Clean 3-Zone Contract */}
      <header className="sticky top-0 z-40 border-b border-slate-200/80 dark:border-zinc-800/80 bg-white/90 dark:bg-[#131314]/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-6">
          {/* Zone 1: Pure Freestanding Logo + Brand Wordmark */}
          <a
            href="#top"
            className="flex items-center gap-2.5 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#0B57D0] rounded-lg"
          >
            <FramelyLogo size={28} />
            <span className="font-[family-name:var(--font-jakarta)] text-xl font-bold tracking-tight text-[#1F1F1F] dark:text-zinc-100">
              Framely
            </span>
          </a>

          {/* Zone 2: 5 Concise Single-Line Anchor Links */}
          <nav
            aria-label="Primary landing navigation"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-[#5F6368] dark:text-zinc-400"
          >
            <a
              href="#features"
              className="hover:text-[#1F1F1F] dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Features
            </a>
            <a
              href="#architecture"
              className="hover:text-[#1F1F1F] dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Architecture
            </a>
            <a
              href="#comparison"
              className="hover:text-[#1F1F1F] dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Comparison
            </a>
            <a
              href="#security"
              className="hover:text-[#1F1F1F] dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Zero-Knowledge
            </a>
            <a
              href="#faq"
              className="hover:text-[#1F1F1F] dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              FAQ
            </a>
          </nav>

          {/* Zone 3: Theme Switcher + Sign In + Primary Launch CTA */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              type="button"
              onClick={onCycleTheme}
              aria-label={`Switch appearance theme (current: ${theme})`}
              title={`Theme: ${theme}`}
              className="w-9 h-9 rounded-full flex items-center justify-center text-[#5F6368] dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <ThemeIcon className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onLaunchApp(true)}
              className="hidden sm:inline-flex items-center px-3 py-2 text-sm font-medium text-[#444746] dark:text-zinc-200 hover:text-[#0B57D0] dark:hover:text-[#A8C7FA] transition-colors whitespace-nowrap shrink-0"
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => onLaunchApp(false)}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] text-white px-4 sm:px-5 py-2 text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              <span>Launch Web App</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main id="top">
        {/* HERO SECTION */}
        <section id="features" className="pt-14 sm:pt-20 pb-20 sm:pb-24 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto">
            {/* Hero Copy Block */}
            <div className="max-w-3xl mx-auto text-center">
              <p className="text-xs sm:text-sm font-medium text-[#5F6368] dark:text-zinc-400 mb-4">
                Client-only Google Photos replica · Direct MTProto 2.0 WebSockets · Zero relay servers
              </p>

              <h1
                className="font-[family-name:var(--font-jakarta)] font-extrabold tracking-tight text-[#1F1F1F] dark:text-white leading-[1.08]"
                style={{
                  fontSize: 'clamp(2.45rem, 4.6vw, 4.1rem)',
                  textWrap: 'balance',
                }}
              >
                Your private photos, in your own Telegram.
              </h1>

              <p className="mt-5 text-base sm:text-lg text-[#5F6368] dark:text-zinc-300 leading-relaxed max-w-2xl mx-auto">
                Store unlimited RAW masters and 4K videos bit-for-bit inside your own private Telegram Channel. Stream directly from your browser with optional client-side AES-256-GCM encryption.
              </p>

              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => onLaunchApp(false)}
                  className="inline-flex items-center gap-2 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] text-white px-7 py-3.5 text-sm font-semibold transition-colors whitespace-nowrap"
                >
                  <span>Launch Web App</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onLaunchApp(true)}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-300 dark:border-zinc-700 bg-white dark:bg-[#1E1F20] hover:bg-[#F8FAFD] dark:hover:bg-zinc-800 text-[#1F1F1F] dark:text-zinc-100 px-6 py-3.5 text-sm font-semibold transition-colors whitespace-nowrap"
                >
                  Connect Telegram Channel
                </button>
              </div>
            </div>

            {/* 4-Metric Technical Proof Strip (Full-Width Row) */}
            <div className="mt-12 grid grid-cols-2 lg:grid-cols-4 gap-px rounded-2xl overflow-hidden border border-slate-200 dark:border-zinc-800 bg-slate-200 dark:bg-zinc-800">
              {[
                { value: '2,048 MB', label: 'Single File Cap (Uncompressed)' },
                { value: '$0.00 / mo', label: 'Free Cloud Storage Forever' },
                { value: '256-Bit', label: 'AES-GCM Web Crypto Vault' },
                { value: '0 Bytes', label: 'Transmitted via Relay Servers' },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="bg-[#F8FAFD] dark:bg-[#1E1F20] px-5 py-5 text-center"
                >
                  <p className="font-mono text-xl sm:text-2xl font-bold tracking-tight tabular-nums text-[#1F1F1F] dark:text-white">
                    {stat.value}
                  </p>
                  <p className="text-xs text-[#5F6368] dark:text-zinc-400 mt-1">
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>

            {/* STAGESHOW DESKTOP APP WINDOW MOCKUP + EDGE-STRADDLING SATELLITE CARD */}
            <div className="mt-12 relative">
              <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#18191B] shadow-[0_24px_64px_-24px_rgba(15,23,42,0.18)] overflow-hidden">
                {/* Simulated Desktop Browser Chrome */}
                <div className="px-4 sm:px-6 py-3 border-b border-slate-200 dark:border-zinc-800 bg-[#F8FAFD] dark:bg-[#1E1F20] flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5" aria-hidden="true">
                      <span className="w-2.5 h-2.5 rounded-full bg-slate-300 dark:bg-zinc-600" />
                      <span className="w-2.5 h-2.5 rounded-full bg-slate-300 dark:bg-zinc-600" />
                      <span className="w-2.5 h-2.5 rounded-full bg-slate-300 dark:bg-zinc-600" />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-[#5F6368] dark:text-zinc-400">
                      <FramelyLogo size={18} />
                      <span className="font-semibold text-[#1F1F1F] dark:text-zinc-100">
                        Framely
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="hidden sm:inline font-mono">
                        Framely Photos Vault (-1002198472310)
                      </span>
                    </div>
                  </div>

                  {/* Interactive Stage Tab Switcher + Auto-Tour Toggle */}
                  <div className="flex items-center gap-2">
                    <div
                      role="tablist"
                      aria-label="Product stage preview views"
                      className="inline-flex items-center gap-1 p-1 rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
                    >
                      {STAGE_TABS.map((tab) => {
                        const active = stageTab === tab.id;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => {
                              setAutoTour(false);
                              setStageTab(tab.id);
                            }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                              active
                                ? 'bg-[#0B57D0] text-white'
                                : 'text-[#5F6368] dark:text-zinc-400 hover:text-[#1F1F1F] dark:hover:text-zinc-100'
                            }`}
                          >
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={() => setAutoTour((v) => !v)}
                      aria-label={autoTour ? 'Pause Auto-Tour' : 'Resume Auto-Tour'}
                      className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium text-[#5F6368] dark:text-zinc-300 hover:text-[#1F1F1F] dark:hover:text-white"
                    >
                      {autoTour ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                      <span>{autoTour ? 'Auto-Tour' : 'Paused'}</span>
                    </button>
                  </div>
                </div>

                {/* Stageshow Interactive Viewport */}
                <div className="grid grid-cols-1 lg:grid-cols-[210px_1fr] min-h-[420px]">
                  {/* Mock Sidebar */}
                  <div className="hidden lg:flex flex-col justify-between border-r border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#131314] p-3">
                    <div className="space-y-1">
                      {[
                        { id: 'timeline' as StageTab, label: 'Photos', active: stageTab === 'timeline' },
                        { id: 'places' as StageTab, label: 'Places', active: stageTab === 'places' },
                        { id: 'locked' as StageTab, label: 'Locked Folder', active: stageTab === 'locked' },
                      ].map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setAutoTour(false);
                            setStageTab(item.id);
                          }}
                          className={`w-full text-left px-3.5 py-2 rounded-full text-xs font-semibold transition-colors ${
                            item.active
                              ? 'bg-[#D3E3FD] dark:bg-[#004A77] text-[#0B57D0] dark:text-[#C2E7FF]'
                              : 'text-[#5F6368] dark:text-zinc-400 hover:bg-[#F8FAFD] dark:hover:bg-zinc-900'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                      <div className="pt-3 px-3.5 text-[11px] text-[#5F6368] dark:text-zinc-500 space-y-2">
                        <p>Albums · 5</p>
                        <p>Favorites · 6</p>
                        <p>Documents · 2</p>
                        <p>4K Videos · 1</p>
                      </div>
                    </div>

                    <div className="px-3 pt-4 border-t border-slate-200 dark:border-zinc-800 space-y-1.5">
                      <div className="h-1.5 rounded-full bg-slate-200 dark:bg-zinc-800 overflow-hidden">
                        <div className="h-full w-1/4 rounded-full bg-gradient-to-r from-[#0B57D0] to-[#34A853]" />
                      </div>
                      <p className="text-[11px] font-mono tabular-nums text-[#5F6368] dark:text-zinc-400">
                        756 MB of 5 TB used
                      </p>
                    </div>
                  </div>

                  {/* Mock Interactive Stage Canvas */}
                  <div className="p-5 sm:p-6 bg-white dark:bg-[#131314]">
                    {stageTab === 'timeline' && (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-bold text-[#1F1F1F] dark:text-zinc-100">
                              Today — Monday, Nov 23
                            </p>
                            <p className="text-xs text-[#5F6368] dark:text-zinc-400">
                              Mumbai City & Harbor · Leica Q3 & Sony ILCE-7RM5
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => onLaunchApp(false)}
                            className="text-xs font-semibold text-[#0B57D0] dark:text-[#A8C7FA] hover:underline"
                          >
                            Open Full Gallery →
                          </button>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                          {[
                            { src: PHOTO_ASSETS.mumbaiHarbor, label: 'MarineDrive_GoldenHour.DNG', span: 'col-span-2' },
                            { src: PHOTO_ASSETS.studioPortrait, label: 'Studio_Portrait_RAW.JPG', span: '' },
                            { src: PHOTO_ASSETS.goldenRetriever, label: 'Milo_Veranda.JPG', span: '' },
                            { src: PHOTO_ASSETS.vasaiCoast, label: 'Vasai_Basalt_Tide.ARW', span: '' },
                            { src: PHOTO_ASSETS.puneGhats, label: 'Sahyadri_4K60.MOV', span: '' },
                            { src: PHOTO_ASSETS.kyotoBamboo, label: 'Arashiyama_Dawn.RAF', span: '' },
                            { src: PHOTO_ASSETS.nightStreet, label: 'Marais_Nocturne.JPG', span: '' },
                          ].map((tile) => (
                            <div
                              key={tile.label}
                              className={`relative aspect-[4/3] rounded-xl overflow-hidden bg-slate-100 dark:bg-zinc-900 ${tile.span}`}
                            >
                              <img
                                src={tile.src}
                                alt={tile.label}
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {stageTab === 'places' && (
                      <div className="space-y-4">
                        <div>
                          <p className="text-sm font-bold text-[#1F1F1F] dark:text-zinc-100">
                            Smart Regional Places
                          </p>
                          <p className="text-xs text-[#5F6368] dark:text-zinc-400">
                            Local EXIF GPS clustering — zero external map servers
                          </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                          {[
                            {
                              name: 'Mumbai City & Harbor',
                              coords: '18.94°N, 72.82°E',
                              count: '4 masters',
                              img: PHOTO_ASSETS.mumbaiHarbor,
                            },
                            {
                              name: 'Vasai & Virar Coast',
                              coords: '19.39°N, 72.81°E',
                              count: '2 masters',
                              img: PHOTO_ASSETS.vasaiCoast,
                            },
                            {
                              name: 'Pune & Western Ghats',
                              coords: '18.52°N, 73.85°E',
                              count: '2 masters',
                              img: PHOTO_ASSETS.puneGhats,
                            },
                          ].map((place) => (
                            <div
                              key={place.name}
                              className="relative aspect-[16/10] rounded-xl overflow-hidden bg-slate-100 dark:bg-zinc-900"
                            >
                              <img
                                src={place.img}
                                alt={place.name}
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover"
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
                              <div className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 rounded-full bg-black/55 backdrop-blur-sm px-2 py-0.5 text-[10px] font-mono text-white">
                                <MapPin className="w-3 h-3 text-[#A8C7FA]" />
                                {place.coords}
                              </div>
                              <div className="absolute inset-x-0 bottom-0 p-3.5">
                                <p className="text-sm font-bold text-white">{place.name}</p>
                                <p className="text-[11px] text-white/80">{place.count}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {stageTab === 'locked' && (
                      <div className="h-full flex flex-col items-center justify-center py-8 text-center max-w-md mx-auto">
                        <div className="w-12 h-12 rounded-2xl bg-[#D3E3FD] dark:bg-[#004A77] text-[#0B57D0] dark:text-[#A8C7FA] flex items-center justify-center mb-4">
                          <Lock className="w-6 h-6" />
                        </div>
                        <h3 className="text-lg font-bold text-[#1F1F1F] dark:text-white">
                          Zero-Knowledge Locked Folder
                        </h3>
                        <p className="text-xs text-[#5F6368] dark:text-zinc-400 mt-1.5 leading-relaxed">
                          Passphrase-derived PBKDF2 (100,000 SHA-256 rounds) + AES-256-GCM authenticated vault. Hidden from timelines, Places, and search, with configurable auto-lock and 1-click Panic Wipe.
                        </p>
                        <button
                          type="button"
                          onClick={() => onLaunchApp(false)}
                          className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] text-white px-5 py-2 text-xs font-semibold"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                          Try Locked Folder in App
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* EDGE-STRADDLING SATELLITE CARD (Bottom-Right Corner Overlap) */}
              <div className="mt-4 lg:mt-0 lg:absolute lg:-right-4 lg:-bottom-6 z-20 w-full lg:w-[340px] rounded-2xl border border-slate-200 dark:border-zinc-700 bg-white/95 dark:bg-[#1E1F20]/95 backdrop-blur-md p-4 shadow-[0_18px_40px_-14px_rgba(11,87,208,0.22)]">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#1F1F1F] dark:text-white">
                    <Radio className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span>Direct Telegram WSS Stream</span>
                  </div>
                  <span className="font-mono text-xs font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                    24 ms
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] font-mono text-[#5F6368] dark:text-zinc-400 truncate">
                  wss://flora-1.web.telegram.org:443
                </p>
                <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-zinc-800 flex items-center justify-between text-[11px] text-[#5F6368] dark:text-zinc-300">
                  <span>forceDocument: true · 4×128 KB</span>
                  <span className="font-mono text-[#0B57D0] dark:text-[#A8C7FA] font-semibold">
                    SHA-256 OK
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 6-CARD ASYMMETRIC ARCHITECTURE BENTO GRID */}
        <section
          id="architecture"
          className="py-20 px-4 sm:px-6 lg:px-8 border-t border-slate-200/80 dark:border-zinc-800/80 bg-[#F8FAFD] dark:bg-[#0D0E10]"
        >
          <div className="max-w-7xl mx-auto">
            <div className="max-w-2xl mb-12">
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#1F1F1F] dark:text-white">
                Engineered for bit-for-bit sovereignty
              </h2>
              <p className="mt-3 text-base text-[#5F6368] dark:text-zinc-400">
                Six core subsystems built to run entirely inside your browser with desktop-class speed.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Bento 1 (Wide): Live Interactive AES-256-GCM Zero-Knowledge Cipher Harness */}
              <div className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#1E1F20] p-6 sm:p-7 flex flex-col justify-between gap-5">
                <div>
                  <p className="text-xs font-semibold text-[#0B57D0] dark:text-[#A8C7FA]">
                    01. Zero-Knowledge Web Crypto Engine
                  </p>
                  <h3 className="text-xl font-bold tracking-tight text-[#1F1F1F] dark:text-white mt-1">
                    Live AES-256-GCM & Tamper-Detection Harness
                  </h3>
                  <p className="text-sm text-[#5F6368] dark:text-zinc-400 mt-1.5">
                    Type any filename or metadata below. Your browser runs real PBKDF2 (100,000 SHA-256 rounds) and AES-256-GCM encryption via <code className="font-mono text-xs">window.crypto.subtle</code>.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="live-cipher-input" className="block text-xs font-medium text-[#5F6368] dark:text-zinc-400 mb-1">
                      Plaintext Metadata Payload
                    </label>
                    <input
                      id="live-cipher-input"
                      type="text"
                      value={cipherInput}
                      onChange={(e) => setCipherInput(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-[#F8FAFD] dark:bg-zinc-900 px-3 py-2 text-xs font-mono text-[#1F1F1F] dark:text-zinc-100"
                    />
                  </div>
                  <div>
                    <label htmlFor="live-cipher-pass" className="block text-xs font-medium text-[#5F6368] dark:text-zinc-400 mb-1">
                      Master Passphrase
                    </label>
                    <input
                      id="live-cipher-pass"
                      type="text"
                      value={cipherPass}
                      onChange={(e) => setCipherPass(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-[#F8FAFD] dark:bg-zinc-900 px-3 py-2 text-xs font-mono text-[#1F1F1F] dark:text-zinc-100"
                    />
                  </div>
                </div>

                <div className="rounded-xl bg-[#F8FAFD] dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                    <span className="text-[#5F6368] dark:text-zinc-400">
                      IV (12B): {cipherEnvelope?.iv ?? 'deriving...'}
                    </span>
                    <button
                      type="button"
                      onClick={handleTamperBitTest}
                      className="inline-flex items-center gap-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 px-2.5 py-1 font-semibold transition-colors"
                    >
                      <ShieldAlert className="w-3.5 h-3.5" />
                      Flip 1 Bit (Tamper Test)
                    </button>
                  </div>
                  <p className="font-mono text-[11px] text-[#1F1F1F] dark:text-zinc-200 break-all">
                    Ciphertext: {cipherEnvelope?.ciphertext ?? 'computing...'}
                  </p>
                  <p
                    className={`text-xs font-medium flex items-center gap-1.5 pt-1 ${
                      tamperStatus === 'tampered'
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {tamperStatus === 'tampered' ? (
                      <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                    ) : (
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span>{tamperMessage || 'Ready'}</span>
                  </p>
                </div>
              </div>

              {/* Bento 2: Unlimited Free Cloud Storage */}
              <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#1E1F20] p-6 sm:p-7 flex flex-col justify-between gap-5">
                <div>
                  <p className="text-xs font-semibold text-[#0B57D0] dark:text-[#A8C7FA]">
                    02. Lossless Master Storage
                  </p>
                  <h3 className="text-xl font-bold tracking-tight text-[#1F1F1F] dark:text-white mt-1">
                    Unlimited Free Cloud Storage
                  </h3>
                  <p className="text-sm text-[#5F6368] dark:text-zinc-400 mt-1.5">
                    Upload 50 MP RAW files and 4K60 videos up to 2,048 MB per document with zero monthly subscription fees.
                  </p>
                </div>
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#5F6368] dark:text-zinc-400">Single Document Cap</span>
                    <span className="font-mono font-bold tabular-nums text-[#1F1F1F] dark:text-white">
                      2,048 MB
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-zinc-800 overflow-hidden">
                    <div className="h-full w-full rounded-full bg-gradient-to-r from-[#0B57D0] via-[#4285F4] to-[#34A853]" />
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-mono text-[#5F6368] dark:text-zinc-400">
                    <span className="inline-flex items-center gap-1">
                      <HardDrive className="w-3.5 h-3.5 text-[#0B57D0] dark:text-[#A8C7FA]" />
                      Bit-for-bit EXIF preserved
                    </span>
                    <span>$0.00/mo</span>
                  </div>
                </div>
              </div>

              {/* Bento 3: Direct MTProto 2.0 WSS Streaming */}
              <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#1E1F20] p-6 sm:p-7 flex flex-col justify-between gap-5">
                <div>
                  <p className="text-xs font-semibold text-[#0B57D0] dark:text-[#A8C7FA]">
                    03. Direct MTProto 2.0 WSS
                  </p>
                  <h3 className="text-xl font-bold tracking-tight text-[#1F1F1F] dark:text-white mt-1">
                    Zero Middleman Relay Servers
                  </h3>
                  <p className="text-sm text-[#5F6368] dark:text-zinc-400 mt-1.5">
                    4 parallel 128 KB chunk workers stream media directly between your browser and Telegram DCs.
                  </p>
                </div>

                <div className="space-y-2 font-mono text-[11px]">
                  <div className="rounded-lg border border-slate-200 dark:border-zinc-700 bg-[#F8FAFD] dark:bg-zinc-900 px-3 py-2 flex items-center justify-between">
                    <span>Browser Web Crypto</span>
                    <span className="text-[#0B57D0] dark:text-[#A8C7FA]">128 KB slice</span>
                  </div>
                  <div className="text-center text-[#5F6368] dark:text-zinc-500">
                    ↓ TLS 1.3 · wss://flora-1.web.telegram.org:443 ↓
                  </div>
                  <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 px-3 py-2 flex items-center justify-between text-emerald-800 dark:text-emerald-300">
                    <span>Framely Photos Vault</span>
                    <span>Private DC5</span>
                  </div>
                </div>
              </div>

              {/* Bento 4 (Wide): Authentic Google Photos Desktop Craft */}
              <div className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#1E1F20] p-6 sm:p-7 flex flex-col justify-between gap-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-[#0B57D0] dark:text-[#A8C7FA]">
                      04. Desktop Gallery Craft
                    </p>
                    <h3 className="text-xl font-bold tracking-tight text-[#1F1F1F] dark:text-white mt-1">
                      60 FPS Timeline, Density Control & Year Scrubber
                    </h3>
                  </div>

                  <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#F8FAFD] dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800">
                    {(['compact', 'standard', 'spacious'] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setBentoDensity(d)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium capitalize transition-colors ${
                          bentoDensity === d
                            ? 'bg-white dark:bg-zinc-800 text-[#0B57D0] dark:text-[#A8C7FA] shadow-xs'
                            : 'text-[#5F6368] dark:text-zinc-400'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3 items-center">
                  <div
                    className={`flex-1 grid gap-2 ${
                      bentoDensity === 'compact'
                        ? 'grid-cols-6'
                        : bentoDensity === 'standard'
                          ? 'grid-cols-3'
                          : 'grid-cols-2'
                    }`}
                  >
                    {bentoPreviewPhotos.slice(0, bentoDensity === 'spacious' ? 2 : 6).map((src, i) => (
                      <div key={src} className="aspect-[4/3] rounded-xl overflow-hidden bg-slate-100 dark:bg-zinc-900">
                        <img
                          src={src}
                          alt={`Timeline preview ${i + 1}`}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="hidden sm:flex flex-col items-center gap-1 rounded-full border border-slate-200 dark:border-zinc-700 bg-[#F8FAFD] dark:bg-zinc-900 px-2 py-2.5 text-[10px] font-mono font-semibold text-[#5F6368] dark:text-zinc-400">
                    <span className="text-[#0B57D0] dark:text-[#A8C7FA]">2026</span>
                    <span>2025</span>
                    <span>2024</span>
                  </div>
                </div>
              </div>

              {/* Bento 5: Smart Regional Places */}
              <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#1E1F20] p-6 sm:p-7 flex flex-col justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-[#0B57D0] dark:text-[#A8C7FA]">
                    05. On-Device Geotagging
                  </p>
                  <h3 className="text-xl font-bold tracking-tight text-[#1F1F1F] dark:text-white mt-1">
                    Smart Regional Places
                  </h3>
                  <p className="text-sm text-[#5F6368] dark:text-zinc-400 mt-1.5">
                    Clusters raw EXIF GPS coordinates locally into clean destination galleries.
                  </p>
                </div>
                <div className="relative aspect-[16/10] rounded-xl overflow-hidden bg-slate-100 dark:bg-zinc-900">
                  <img
                    src={PHOTO_ASSETS.vasaiCoast}
                    alt="Vasai & Virar Coast destination card"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-3.5 text-white">
                    <p className="text-sm font-bold">Vasai & Virar Coast</p>
                    <p className="text-[11px] font-mono text-white/80">19.39°N, 72.81°E · Local EXIF</p>
                  </div>
                </div>
              </div>

              {/* Bento 6 (Wide): Darkroom Cinema Lightbox & EXIF Studio */}
              <div className="lg:col-span-2 rounded-2xl border border-zinc-800 bg-[#111214] text-zinc-100 p-6 sm:p-7 grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-semibold text-[#A8C7FA]">
                      06. Darkroom Cinema & EXIF Studio
                    </p>
                    <h3 className="text-xl font-bold tracking-tight text-white mt-1">
                      0ms Camera Roll Filmstrip & Optical Telemetry
                    </h3>
                    <p className="text-sm text-zinc-400 mt-1.5 leading-relaxed">
                      Windowed filmstrip rendering (±18 frames) stays effortless on 5,000+ photo libraries, paired with full aperture, shutter, ISO, and Telegram SHA-256 verification.
                    </p>
                  </div>

                  <div className="grid grid-cols-4 gap-2 text-center font-mono text-xs tabular-nums">
                    <div className="rounded-lg bg-white/5 border border-white/10 p-2">
                      <p className="text-[10px] text-zinc-400">Aperture</p>
                      <p className="text-white mt-0.5">f/2.8</p>
                    </div>
                    <div className="rounded-lg bg-white/5 border border-white/10 p-2">
                      <p className="text-[10px] text-zinc-400">Shutter</p>
                      <p className="text-white mt-0.5">1/500s</p>
                    </div>
                    <div className="rounded-lg bg-white/5 border border-white/10 p-2">
                      <p className="text-[10px] text-zinc-400">Focal</p>
                      <p className="text-white mt-0.5">28mm</p>
                    </div>
                    <div className="rounded-lg bg-white/5 border border-white/10 p-2">
                      <p className="text-[10px] text-zinc-400">ISO</p>
                      <p className="text-white mt-0.5">100</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2.5">
                  <div className="aspect-[16/10] rounded-xl overflow-hidden border border-white/10">
                    <img
                      src={PHOTO_ASSETS.mumbaiHarbor}
                      alt="Darkroom Cinema Lightbox preview"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
                    <span className="inline-flex items-center gap-1.5">
                      <Camera className="w-3.5 h-3.5 text-[#A8C7FA]" />
                      Leica Q3 · 6000×3375 DNG
                    </span>
                    <span className="text-emerald-400">MTProto #49201</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* COMPARISON MATRIX TABLE */}
        <section id="comparison" className="py-20 px-4 sm:px-6 lg:px-8">
          <div className="max-w-6xl mx-auto">
            <div className="max-w-2xl mb-10">
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#1F1F1F] dark:text-white">
                How Framely compares
              </h2>
              <p className="mt-2.5 text-base text-[#5F6368] dark:text-zinc-400">
                An objective breakdown against mainstream consumer cloud photo subscriptions.
              </p>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-zinc-800">
              <table className="w-full text-left border-collapse min-w-[680px]">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-zinc-800 bg-[#F8FAFD] dark:bg-[#1E1F20] text-xs font-semibold text-[#5F6368] dark:text-zinc-400">
                    <th className="py-4 px-5">Capability</th>
                    <th className="py-4 px-5 text-[#0B57D0] dark:text-[#A8C7FA] font-bold">
                      Framely (Telegram MTProto)
                    </th>
                    <th className="py-4 px-5">Google Photos</th>
                    <th className="py-4 px-5">Apple iCloud Photos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-zinc-800 text-sm">
                  {COMPARISON_ROWS.map((row) => (
                    <tr
                      key={row.feature}
                      className="bg-white dark:bg-[#131314] hover:bg-[#F8FAFD] dark:hover:bg-[#1E1F20]/60 transition-colors"
                    >
                      <td className="py-4 px-5 font-semibold text-[#1F1F1F] dark:text-zinc-100">
                        {row.feature}
                      </td>
                      <td className="py-4 px-5 font-medium text-[#0B57D0] dark:text-[#A8C7FA] tabular-nums">
                        <span className="inline-flex items-start gap-2">
                          <Check className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                          <span>{row.framely}</span>
                        </span>
                      </td>
                      <td className="py-4 px-5 text-[#5F6368] dark:text-zinc-400 tabular-nums">
                        {row.google}
                      </td>
                      <td className="py-4 px-5 text-[#5F6368] dark:text-zinc-400 tabular-nums">
                        {row.icloud}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* 3-STEP ZERO-KNOWLEDGE ARCHITECTURE PIPELINE */}
        <section
          id="security"
          className="py-20 px-4 sm:px-6 lg:px-8 border-t border-slate-200/80 dark:border-zinc-800/80 bg-[#F8FAFD] dark:bg-[#0D0E10]"
        >
          <div className="max-w-6xl mx-auto">
            <div className="max-w-2xl mb-12">
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#1F1F1F] dark:text-white">
                Three-step client-only pipeline
              </h2>
              <p className="mt-2.5 text-base text-[#5F6368] dark:text-zinc-400">
                No sign-up forms, no cloud database hosted by us, and zero telemetry leaving your machine.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                {
                  step: '01. Allocate Your Private Channel',
                  body: 'Authenticate directly with Telegram MTProto 2.0 via Phone or QR. Framely creates or binds a private broadcast channel titled "Framely Photos Vault" owned exclusively by your account.',
                },
                {
                  step: '02. Index EXIF & Stream Uncompressed',
                  body: 'Your browser extracts EXIF optics, computes a SHA-256 bitstream hash, builds a 400px WebP thumbnail for IndexedDB, and streams the original file in 128 KB chunks with forceDocument: true.',
                },
                {
                  step: '03. Seal Keys & Browse at 60 FPS',
                  body: 'Your session string and Locked Folder keys are protected with 100,000-round PBKDF2 + AES-256-GCM. Export an Emergency Recovery Kit or run a 1-click Panic Wipe anytime.',
                },
              ].map((item) => (
                <div
                  key={item.step}
                  className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#1E1F20] p-6"
                >
                  <h3 className="text-base font-bold text-[#1F1F1F] dark:text-white">
                    {item.step}
                  </h3>
                  <p className="text-sm text-[#5F6368] dark:text-zinc-400 mt-2.5 leading-relaxed">
                    {item.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* INTERACTIVE FAQ ACCORDION */}
        <section id="faq" className="py-20 px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#1F1F1F] dark:text-white text-center mb-10">
              Technical FAQ
            </h2>

            <div className="divide-y divide-slate-200 dark:divide-zinc-800 border-y border-slate-200 dark:border-zinc-800">
              {FAQ_ITEMS.map((item, idx) => {
                const isOpen = openFaqIndex === idx;
                return (
                  <div key={item.q}>
                    <button
                      type="button"
                      onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                      aria-expanded={isOpen}
                      className="w-full py-5 flex items-center justify-between gap-4 text-left focus-visible:outline-2 focus-visible:outline-[#0B57D0]"
                    >
                      <span className="text-base font-semibold text-[#1F1F1F] dark:text-zinc-100">
                        {item.q}
                      </span>
                      <ChevronDown
                        className={`w-5 h-5 shrink-0 text-[#5F6368] dark:text-zinc-400 transition-transform duration-200 ${
                          isOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                    {isOpen && (
                      <p className="pb-5 text-sm text-[#5F6368] dark:text-zinc-400 leading-relaxed pr-8">
                        {item.a}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-12 text-center">
              <button
                type="button"
                onClick={() => onLaunchApp(false)}
                className="inline-flex items-center gap-2 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] text-white px-8 py-3.5 text-sm font-semibold transition-colors"
              >
                <span>Launch Framely Web App</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-slate-200 dark:border-zinc-800 py-10 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <FramelyLogo size={24} />
            <span className="font-[family-name:var(--font-jakarta)] text-base font-bold text-[#1F1F1F] dark:text-zinc-100">
              Framely
            </span>
            <span className="text-xs text-[#5F6368] dark:text-zinc-500">
              · Client-only zero-knowledge Telegram photo gallery
            </span>
          </div>

          <div className="flex items-center gap-6 text-xs text-[#5F6368] dark:text-zinc-400">
            <a href="#architecture" className="hover:text-[#1F1F1F] dark:hover:text-white">
              Architecture
            </a>
            <a href="#comparison" className="hover:text-[#1F1F1F] dark:hover:text-white">
              Comparison
            </a>
            <a href="#faq" className="hover:text-[#1F1F1F] dark:hover:text-white">
              FAQ
            </a>
            <button
              type="button"
              onClick={() => onLaunchApp(false)}
              className="font-semibold text-[#0B57D0] dark:text-[#A8C7FA] hover:underline"
            >
              Launch App
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
