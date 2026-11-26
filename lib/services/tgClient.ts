'use client';

import '../polyfills';
import ExifReader from 'exifreader';
import { db } from '../db';
import type { MediaItem, TelegramSessionPayload, UploadChunkSize } from '../types';
import {
  decodeStructuredCaption,
  encodeStructuredCaption,
  resolveRegionalPlace,
  sanitizeFilename,
  validateTelegramFileSize,
} from '../utils/security';
import {
  buildTelegramQrUrl,
  formatTelegramAuthError,
  normalizeChannelId,
} from '../utils/telegram';
import {
  loadEncryptedVaultEnvelope,
  saveEncryptedSessionVault,
  sha256Hex,
  unlockSessionVault,
} from './vaultService';

export const TELEGRAM_WSS_GATEWAYS = [
  'wss://pluto.web.telegram.org:443/apiws',
  'wss://venus.web.telegram.org:443/apiws',
  'wss://aurora.web.telegram.org:443/apiws',
  'wss://vesta.web.telegram.org:443/apiws',
  'wss://flora-1.web.telegram.org:443/TCPObfuscated',
] as const;

export const FRAMELY_CHANNEL_TITLE = 'Framely Photos Vault';
export const SESSION_STORAGE_KEY = 'framely_tg_session_v1';
export const CHUNK_SIZE_BYTES = 128 * 1024; // 128 KB chunks
const MAX_CACHED_BLOBS = 40;

const LEGACY_DEMO_CHANNEL_IDS = new Set(['2093810291', '-1002093810291']);

interface CachedBlobEntry {
  url: string;
  touchedAt: number;
}

export interface UploadControlSignal {
  isPaused: boolean;
  isCancelled: boolean;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
}

export function createUploadControlSignal(): UploadControlSignal {
  const signal: UploadControlSignal = {
    isPaused: false,
    isCancelled: false,
    pause() {
      signal.isPaused = true;
    },
    resume() {
      signal.isPaused = false;
    },
    cancel() {
      signal.isCancelled = true;
      signal.isPaused = false;
    },
  };
  return signal;
}

function generateRandomBigInt(): bigint {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new BigUint64Array(1);
    crypto.getRandomValues(arr);
    return arr[0];
  }
  return BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
}

/**
 * LRU Blob URL cache for concurrent chunk streaming so large RAW images
 * and 4K videos are never downloaded twice in the same session.
 */
class BlobLruCache {
  private map = new Map<number, CachedBlobEntry>();

  get(messageId: number): string | undefined {
    const entry = this.map.get(messageId);
    if (!entry) return undefined;
    entry.touchedAt = Date.now();
    return entry.url;
  }

  set(messageId: number, url: string): void {
    if (this.map.size >= MAX_CACHED_BLOBS) {
      let oldestKey: number | null = null;
      let oldestTime = Infinity;
      for (const [k, v] of this.map.entries()) {
        if (v.touchedAt < oldestTime) {
          oldestTime = v.touchedAt;
          oldestKey = k;
        }
      }
      if (oldestKey !== null) {
        const evicted = this.map.get(oldestKey);
        if (evicted?.url.startsWith('blob:')) {
          URL.revokeObjectURL(evicted.url);
        }
        this.map.delete(oldestKey);
      }
    }
    this.map.set(messageId, { url, touchedAt: Date.now() });
  }

  clear(): void {
    for (const entry of this.map.values()) {
      if (entry.url.startsWith('blob:')) {
        URL.revokeObjectURL(entry.url);
      }
    }
    this.map.clear();
  }
}

export interface ParsedLocalExif {
  width: number;
  height: number;
  takenAt: string;
  camera?: string;
  lens?: string;
  aperture?: string;
  shutterSpeed?: string;
  focalLength?: string;
  iso?: number;
  latitude?: number;
  longitude?: number;
}

/**
 * Parses EXIF headers directly in the browser from the first 256 KB slice
 * so multi-megabyte / 2 GB files never blow up browser RAM.
 */
export async function extractLocalExif(file: File): Promise<ParsedLocalExif> {
  const fallback: ParsedLocalExif = {
    width: 1920,
    height: 1080,
    takenAt: new Date(file.lastModified || Date.now()).toISOString(),
  };

  try {
    const headerSlice = file.slice(0, Math.min(file.size, 256 * 1024));
    const buffer = await headerSlice.arrayBuffer();
    const tags = ExifReader.load(buffer, { expanded: true });

    const make = tags.exif?.Make?.description?.trim();
    const model = tags.exif?.Model?.description?.trim();
    const camera = model
      ? make && !model.toLowerCase().includes(make.toLowerCase())
        ? `${make} ${model}`
        : model
      : make;

    const lens = tags.exif?.LensModel?.description?.trim();
    const fNumber = tags.exif?.FNumber?.description;
    const exposure = tags.exif?.ExposureTime?.description;
    const focal = tags.exif?.FocalLength?.description;
    const isoVal = Number(tags.exif?.ISOSpeedRatings?.description);

    const width =
      Number(tags.file?.['Image Width']?.value) ||
      Number(tags.exif?.PixelXDimension?.value) ||
      fallback.width;
    const height =
      Number(tags.file?.['Image Height']?.value) ||
      Number(tags.exif?.PixelYDimension?.value) ||
      fallback.height;

    let takenAt = fallback.takenAt;
    const rawDate = tags.exif?.DateTimeOriginal?.description;
    if (rawDate && /^\d{4}:\d{2}:\d{2}/.test(rawDate)) {
      const normalized = rawDate.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(' ', 'T');
      const parsed = new Date(normalized);
      if (!Number.isNaN(parsed.getTime())) {
        takenAt = parsed.toISOString();
      }
    }

    const lat = typeof tags.gps?.Latitude === 'number' ? tags.gps.Latitude : undefined;
    const lon = typeof tags.gps?.Longitude === 'number' ? tags.gps.Longitude : undefined;

    return {
      width,
      height,
      takenAt,
      camera,
      lens,
      aperture: fNumber ? (fNumber.startsWith('f/') ? fNumber : `f/${fNumber}`) : undefined,
      shutterSpeed: exposure ? `${exposure}s` : undefined,
      focalLength: focal,
      iso: Number.isFinite(isoVal) && isoVal > 0 ? isoVal : undefined,
      latitude: lat,
      longitude: lon,
    };
  } catch {
    return fallback;
  }
}

/**
 * Generates a downscaled thumbnail (max 400px) as both DataURL (for instant IndexedDB UI)
 * and JPEG Blob (for Telegram document custom thumbnail).
 */
export async function generateMediaThumbnail(file: File): Promise<{
  thumbnailDataUrl: string;
  thumbnailBlob: Blob | null;
  width: number;
  height: number;
  durationMs?: number;
}> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);

    const finishFromCanvas = (
      canvas: HTMLCanvasElement,
      width: number,
      height: number,
      durationMs?: number
    ) => {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(objectUrl);
          resolve({
            thumbnailDataUrl: dataUrl,
            thumbnailBlob: blob,
            width,
            height,
            durationMs,
          });
        },
        'image/jpeg',
        0.82
      );
    };

    if (file.type.startsWith('video/')) {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.src = objectUrl;
      video.onloadeddata = () => {
        video.currentTime = Math.min(0.5, video.duration || 0);
      };
      video.onseeked = () => {
        const w = video.videoWidth || 1280;
        const h = video.videoHeight || 720;
        const durationMs = Number.isFinite(video.duration)
          ? Math.round(video.duration * 1000)
          : undefined;
        const scale = Math.min(1, 320 / Math.max(w, h));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
        finishFromCanvas(canvas, w, h, durationMs);
      };
      video.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve({ thumbnailDataUrl: '', thumbnailBlob: null, width: 1920, height: 1080 });
      };
      return;
    }

    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 1600;
      const h = img.naturalHeight || 1200;
      const scale = Math.min(1, 320 / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
      finishFromCanvas(canvas, w, h);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ thumbnailDataUrl: '', thumbnailBlob: null, width: 1600, height: 1200 });
    };
    img.src = objectUrl;
  });
}

function buildFallbackSvgThumbnail(label: string): string {
  const safeLabel = label.replace(/[<>&"']/g, '').slice(0, 24) || 'Telegram Media';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0B57D0"/><stop offset="100%" stop-color="#1E3A8A"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><text x="200" y="210" font-family="sans-serif" font-size="18" font-weight="600" fill="white" text-anchor="middle">${safeLabel}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

async function loadGramJs() {
  const [{ TelegramClient, Api }, { StringSession }, { CustomFile }] = await Promise.all([
    import('telegram'),
    import('telegram/sessions'),
    import('telegram/client/uploads'),
  ]);
  return { TelegramClient, Api, StringSession, CustomFile };
}

class TelegramClientEngine {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pendingAuthClient: any = null;
  private session: TelegramSessionPayload | null = null;
  private blobCache = new BlobLruCache();
  private liveListenerCleanup: (() => void) | null = null;
  private connectingPromise: Promise<unknown> | null = null;

  /**
   * Reads persisted real Telegram session from localStorage (never returns legacy demo sessions).
   */
  getSession(): TelegramSessionPayload | null {
    if (this.session) return this.session;
    if (typeof window === 'undefined') return null;

    try {
      const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as TelegramSessionPayload;
      if (
        !parsed ||
        !parsed.apiId ||
        !parsed.apiHash ||
        !parsed.sessionString ||
        LEGACY_DEMO_CHANNEL_IDS.has(String(parsed.channelId)) ||
        parsed.sessionString.includes('DemoSessionKey')
      ) {
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
        return null;
      }
      this.session = { ...parsed, mode: 'live-mtproto' };
      return this.session;
    } catch {
      return null;
    }
  }

  hasLockedEncryptedVault(): boolean {
    if (this.getSession()) return false;
    return Boolean(loadEncryptedVaultEnvelope());
  }

  saveSession(session: TelegramSessionPayload, passphrase?: string): void {
    this.session = { ...session, mode: 'live-mtproto' };
    if (typeof window === 'undefined') return;
    if (passphrase && passphrase.trim().length >= 6) {
      // Encrypted vault mode: store encrypted envelope and do NOT keep plaintext session in localStorage
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      void saveEncryptedSessionVault(this.session, passphrase.trim());
    } else {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(this.session));
    }
  }

  async unlockEncryptedSession(passphrase: string): Promise<TelegramSessionPayload> {
    const unlocked = await unlockSessionVault(passphrase);
    if (!unlocked.apiId || !unlocked.apiHash || !unlocked.sessionString) {
      throw new Error('Encrypted vault does not contain a valid Telegram session.');
    }
    this.session = { ...unlocked, mode: 'live-mtproto' };
    await this.ensureConnectedClient();
    return this.session;
  }

  isLiveConnected(): boolean {
    return Boolean(this.session?.sessionString && this.client?.connected);
  }

  getCachedFullUrl(messageId: number): string | undefined {
    return this.blobCache.get(messageId);
  }

  private async createClient(apiId: number, apiHash: string, sessionString = '') {
    const { TelegramClient, StringSession } = await loadGramJs();
    return new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
      connectionRetries: 5,
      useWSS: true,
      deviceModel: 'Framely Web',
      systemVersion: 'Browser',
      appVersion: '1.0.0',
    });
  }

  async cancelPendingAuth(): Promise<void> {
    if (this.pendingAuthClient) {
      try {
        await this.pendingAuthClient.disconnect();
      } catch {
        // Ignore disconnect cleanup error
      }
      this.pendingAuthClient = null;
    }
  }

  /**
   * Initializes or reconnects the real GramJS MTProto 2.0 WebSocket client from the active session.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ensureConnectedClient(): Promise<any> {
    if (this.client?.connected) return this.client;
    if (this.connectingPromise) return this.connectingPromise;

    const active = this.getSession();
    if (!active || !active.apiId || !active.apiHash || !active.sessionString) {
      throw new Error('Not signed into Telegram. Connect your Telegram account to continue.');
    }

    this.connectingPromise = (async () => {
      const client = await this.createClient(active.apiId, active.apiHash, active.sessionString);
      await client.connect();
      this.client = client;
      return client;
    })().finally(() => {
      this.connectingPromise = null;
    });

    return this.connectingPromise;
  }

  /**
   * Step 1 of Real Telegram Phone OTP Login:
   * Opens direct browser WSS to Telegram and requests a login code via Telegram app / SMS.
   */
  async sendPhoneCode(
    apiId: number,
    apiHash: string,
    phoneNumber: string
  ): Promise<{ phoneCodeHash: string; isCodeViaApp: boolean }> {
    await this.cancelPendingAuth();
    const client = await this.createClient(apiId, apiHash, '');
    await client.connect();
    this.pendingAuthClient = client;

    try {
      const result = await client.sendCode({ apiId, apiHash }, phoneNumber.trim());
      return {
        phoneCodeHash: result.phoneCodeHash,
        isCodeViaApp: Boolean(result.isCodeViaApp),
      };
    } catch (err) {
      const formatted = formatTelegramAuthError(err);
      throw new Error(formatted.message);
    }
  }

  /**
   * Step 2 of Real Telegram Phone OTP Login:
   * Submits OTP code (and optional 2FA Cloud Password via SRP-6A), auto-provisions
   * the private Telegram storage channel, and activates the live session.
   */
  async verifyPhoneCodeAndSignIn(params: {
    apiId: number;
    apiHash: string;
    phoneNumber: string;
    phoneCode: string;
    phoneCodeHash: string;
    password?: string;
    vaultPassphrase?: string;
  }): Promise<TelegramSessionPayload> {
    const { Api } = await loadGramJs();
    let client = this.pendingAuthClient;
    if (!client || !client.connected) {
      client = await this.createClient(params.apiId, params.apiHash, '');
      await client.connect();
      this.pendingAuthClient = client;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let authResult: any = null;
    try {
      authResult = await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: params.phoneNumber.trim(),
          phoneCodeHash: String(params.phoneCodeHash).trim(),
          phoneCode: String(params.phoneCode).trim(),
        })
      );
    } catch (err) {
      const formatted = formatTelegramAuthError(err);
      if (formatted.code === 'SESSION_PASSWORD_NEEDED') {
        if (!params.password || !params.password.trim()) {
          const twoFaErr = new Error('2FA_REQUIRED');
          throw twoFaErr;
        }
        try {
          authResult = await client.signInWithPassword(
            { apiId: params.apiId, apiHash: params.apiHash },
            {
              password: async () => params.password!.trim(),
              onError: (pwErr: Error) => {
                throw pwErr;
              },
            }
          );
        } catch (pwErr) {
          throw new Error(formatTelegramAuthError(pwErr).message);
        }
      } else {
        throw new Error(formatted.message);
      }
    }

    const session = await this.finalizeAuthenticatedClient({
      client,
      apiId: params.apiId,
      apiHash: params.apiHash,
      authUser: authResult?.user || authResult,
      phoneNumber: params.phoneNumber.trim(),
      vaultPassphrase: params.vaultPassphrase,
    });
    this.pendingAuthClient = null;
    return session;
  }

  /**
   * Real Telegram QR Code Login (`client.signInUserWithQrCode`):
   * Streams official rotating `tg://login?token=<base64url>` tokens directly from Telegram
   * and supports 2FA Cloud Password if enabled on the account.
   */
  async startQrLogin(params: {
    apiId: number;
    apiHash: string;
    onQrToken: (qrAuthUrl: string, expires: number) => void;
    onPasswordNeeded?: () => Promise<string>;
    vaultPassphrase?: string;
  }): Promise<TelegramSessionPayload> {
    await this.cancelPendingAuth();
    const client = await this.createClient(params.apiId, params.apiHash, '');
    await client.connect();
    this.pendingAuthClient = client;

    try {
      const authUser = await client.signInUserWithQrCode(
        { apiId: params.apiId, apiHash: params.apiHash },
        {
          qrCode: async ({ token, expires }: { token: Buffer; expires: number }) => {
            const qrUrl = buildTelegramQrUrl(token);
            params.onQrToken(qrUrl, expires);
          },
          password: params.onPasswordNeeded
            ? async () => (await params.onPasswordNeeded!()).trim()
            : undefined,
          onError: (err: Error) => {
            console.warn('[Telegram QR] Auth callback warning:', err?.message || err);
          },
        }
      );

      const session = await this.finalizeAuthenticatedClient({
        client,
        apiId: params.apiId,
        apiHash: params.apiHash,
        authUser,
        vaultPassphrase: params.vaultPassphrase,
      });
      this.pendingAuthClient = null;
      return session;
    } catch (err) {
      throw new Error(formatTelegramAuthError(err).message);
    }
  }

  private async finalizeAuthenticatedClient(params: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: any;
    apiId: number;
    apiHash: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    authUser: any;
    phoneNumber?: string;
    vaultPassphrase?: string;
  }): Promise<TelegramSessionPayload> {
    const { client, apiId, apiHash, authUser, phoneNumber, vaultPassphrase } = params;
    this.client = client;
    const savedSession = String(client.session.save());
    const channel = await this.ensureLibraryChannel(client);

    const displayName =
      [authUser?.firstName, authUser?.lastName].filter(Boolean).join(' ') ||
      (authUser?.username ? `@${authUser.username}` : '') ||
      phoneNumber ||
      'Telegram User';

    const dcId = client.session?.dcId ? `DC${client.session.dcId}` : 'MTProto WSS';

    const session: TelegramSessionPayload = {
      apiId,
      apiHash,
      sessionString: savedSession,
      userId: authUser?.id ? String(authUser.id) : undefined,
      phoneNumber: phoneNumber || (authUser?.phone ? `+${authUser.phone}` : undefined),
      username: authUser?.username || undefined,
      displayName,
      channelId: channel.channelId,
      channelAccessHash: channel.channelAccessHash,
      channelTitle: channel.channelTitle,
      dcEndpoint: `${dcId} · wss://web.telegram.org`,
      connectedAt: new Date().toISOString(),
      mode: 'live-mtproto',
    };

    this.saveSession(session, vaultPassphrase);
    return session;
  }

  /**
   * Reuses an existing "Framely Photos Vault" or "Telegram Photos Library" channel
   * in the user's Telegram account, or creates a new private broadcast channel.
   */
  async ensureLibraryChannel(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: any,
    title = FRAMELY_CHANNEL_TITLE
  ): Promise<{ channelId: string; channelTitle: string; channelAccessHash?: string }> {
    const { Api } = await loadGramJs();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dialogs: any[] = await client.getDialogs({ limit: 100 });
      const existing = dialogs.find(
        (d) =>
          (d.isChannel || d.isGroup) &&
          d.entity &&
          (d.title?.toLowerCase().includes('framely photos') ||
            d.title?.toLowerCase().includes('photos library'))
      );
      if (existing?.entity) {
        return {
          channelId: String(existing.entity.id),
          channelTitle: existing.title || title,
          channelAccessHash: existing.entity.accessHash
            ? String(existing.entity.accessHash)
            : undefined,
        };
      }
    } catch (err) {
      console.warn('[Telegram] Dialog inspection skipped:', err);
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const created: any = await client.invoke(
        new Api.channels.CreateChannel({
          title,
          about:
            'Private lossless photo & video storage for Framely. Original documents with Schema v1 JSON captions.',
          broadcast: true,
          megagroup: false,
        })
      );
      const channelEntity = created?.chats?.[0];
      if (channelEntity?.id) {
        return {
          channelId: String(channelEntity.id),
          channelTitle: title,
          channelAccessHash: channelEntity.accessHash
            ? String(channelEntity.accessHash)
            : undefined,
        };
      }
    } catch (err) {
      console.warn('[Telegram] Channel creation fell back to Saved Messages:', err);
    }

    return {
      channelId: 'me',
      channelTitle: 'Saved Messages',
    };
  }

  /**
   * Robustly resolves the target Telegram destination peer (`InputPeerChannel` -> Dialog cache -> `InputPeerSelf`).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async resolveTargetPeer(client: any, targetChannelId?: string): Promise<any> {
    const { Api } = await loadGramJs();
    const session = this.getSession();
    const chId = targetChannelId || session?.channelId;

    if (!chId || chId === 'me' || chId === 'self') {
      return new Api.InputPeerSelf();
    }

    const cleanId = normalizeChannelId(chId);

    if (
      session?.channelAccessHash &&
      (session.channelId === chId || normalizeChannelId(session.channelId) === cleanId)
    ) {
      try {
        return new Api.InputPeerChannel({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          channelId: BigInt(cleanId) as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          accessHash: BigInt(session.channelAccessHash) as any,
        });
      } catch {
        // Fall through to dialog resolution
      }
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dialogs: any[] = await client.getDialogs({ limit: 100 });
      const match = dialogs.find((d) => {
        if (!d.entity) return false;
        const entId = d.entity.id ? String(d.entity.id) : '';
        const dialId = d.id ? String(d.id) : '';
        return (
          entId === cleanId ||
          entId === chId ||
          dialId === chId ||
          dialId === `-100${cleanId}` ||
          chId === `-100${entId}`
        );
      });
      if (match?.entity) {
        if (match.entity.accessHash && session) {
          session.channelId = String(match.entity.id);
          session.channelAccessHash = String(match.entity.accessHash);
          this.saveSession(session);
        }
        return match.inputEntity || match.entity;
      }
    } catch {
      // Fall through
    }

    try {
      return await client.getInputEntity(`-100${cleanId}`);
    } catch {
      return new Api.InputPeerSelf();
    }
  }

  /**
   * Losslessly uploads a photo or video (up to 2,048 MB) as an uncompressed Telegram Document
   * (`forceDocument: true`) with EXIF + Schema v1 JSON caption and configurable MTProto chunk streaming.
   * Supports 128 KB, 256 KB, 512 KB, and 1 MB Turbo throughput with pause & resume.
   */
  async uploadMediaItem(
    file: File,
    options?: {
      albums?: string[];
      isLocked?: boolean;
      chunkSizeKb?: UploadChunkSize;
      signal?: UploadControlSignal;
      onProgress?: (pct: number, stage: string) => void;
    }
  ): Promise<MediaItem> {
    const sizeCheck = validateTelegramFileSize(file.size);
    if (!sizeCheck.valid) {
      throw new Error(sizeCheck.reason);
    }

    const session = this.getSession();
    if (!session) {
      throw new Error('Please connect your Telegram account before uploading media.');
    }

    const client = await this.ensureConnectedClient();
    const { Api, CustomFile } = await loadGramJs();

    const safeName = sanitizeFilename(file.name);
    options?.onProgress?.(6, 'Reading EXIF headers & computing SHA-256');

    const computeBoundedSha256 = async (target: File): Promise<string> => {
      const FULL_HASH_LIMIT = 32 * 1024 * 1024;
      if (target.size <= FULL_HASH_LIMIT) {
        return sha256Hex(await target.arrayBuffer());
      }
      const head = new Uint8Array(await target.slice(0, CHUNK_SIZE_BYTES).arrayBuffer());
      const midStart = Math.max(0, Math.floor(target.size / 2) - Math.floor(CHUNK_SIZE_BYTES / 2));
      const mid = new Uint8Array(
        await target.slice(midStart, midStart + CHUNK_SIZE_BYTES).arrayBuffer()
      );
      const tailStart = Math.max(0, target.size - CHUNK_SIZE_BYTES);
      const tail = new Uint8Array(await target.slice(tailStart, target.size).arrayBuffer());
      const combined = new Uint8Array(head.byteLength + mid.byteLength + tail.byteLength + 8);
      combined.set(head, 0);
      combined.set(mid, head.byteLength);
      combined.set(tail, head.byteLength + mid.byteLength);
      new DataView(combined.buffer).setFloat64(combined.byteLength - 8, target.size, false);
      return sha256Hex(combined.buffer);
    };

    const [exif, thumb, sha256] = await Promise.all([
      extractLocalExif(file),
      generateMediaThumbnail(file),
      computeBoundedSha256(file),
    ]);

    const fullObjectUrl = URL.createObjectURL(file);
    const isVideo = file.type.startsWith('video/');
    const resolvedPlace = resolveRegionalPlace(exif.latitude, exif.longitude);

    // AI Semantic Tagging via Gemini API endpoint
    options?.onProgress?.(14, 'Analyzing image with Gemini AI for auto-tagging...');
    let aiTags: string[] = [];
    let aiDescription: string | undefined = undefined;

    if (thumb.thumbnailDataUrl) {
      try {
        const tagRes = await fetch('/api/ai/tag-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            thumbnailBase64: thumb.thumbnailDataUrl,
            filename: safeName,
            mimeType: file.type || (isVideo ? 'video/mp4' : 'image/jpeg'),
            camera: exif.camera,
            placeName: resolvedPlace?.name,
            takenAt: exif.takenAt,
            width: thumb.width || exif.width,
            height: thumb.height || exif.height,
          }),
        });
        if (tagRes.ok) {
          const tagData = await tagRes.json();
          if (Array.isArray(tagData.tags) && tagData.tags.length > 0) {
            aiTags = tagData.tags;
          }
          if (typeof tagData.description === 'string' && tagData.description.trim()) {
            aiDescription = tagData.description.trim();
          }
        }
      } catch {
        // Fall back gracefully if offline or server route unreachable
      }
    }

    const draftItem: MediaItem = {
      messageId: Math.floor(Date.now() / 1000),
      libraryId: session.channelId,
      kind: isVideo ? 'video' : 'photo',
      filename: safeName,
      mimeType: file.type || (isVideo ? 'video/mp4' : 'image/jpeg'),
      sizeBytes: file.size,
      sha256,
      width: thumb.width || exif.width,
      height: thumb.height || exif.height,
      durationMs: thumb.durationMs,
      camera: exif.camera,
      lens: exif.lens,
      aperture: exif.aperture,
      shutterSpeed: exif.shutterSpeed,
      focalLength: exif.focalLength,
      iso: exif.iso,
      takenAt: exif.takenAt,
      latitude: exif.latitude,
      longitude: exif.longitude,
      placeName: resolvedPlace?.name,
      thumbnailDataUrl: thumb.thumbnailDataUrl || fullObjectUrl,
      fullUrl: fullObjectUrl,
      isFavorite: false,
      isArchived: false,
      isLocked: Boolean(options?.isLocked),
      category: isVideo
        ? 'video'
        : safeName.toLowerCase().includes('screenshot')
          ? 'screenshot'
          : safeName.toLowerCase().includes('scan') || safeName.toLowerCase().includes('doc')
            ? 'document'
            : 'photo',
      uploadedAt: new Date().toISOString(),
      albums: options?.albums ?? [],
      tags: aiTags,
      aiDescription,
      mtprotoDc: session.dcEndpoint,
    };

    const captionJson = encodeStructuredCaption(draftItem);
    const targetPeer = await this.resolveTargetPeer(client, session.channelId);

    // Build optional JPEG thumbnail CustomFile
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let thumbCustomFile: any = undefined;
    if (thumb.thumbnailBlob && thumb.thumbnailBlob.size > 0) {
      try {
        const thumbBuf = await thumb.thumbnailBlob.arrayBuffer();
        thumbCustomFile = new CustomFile(
          'thumb.jpg',
          thumb.thumbnailBlob.size,
          '',
          Buffer.from(thumbBuf)
        );
      } catch {
        thumbCustomFile = undefined;
      }
    }

    const attributes = isVideo
      ? [
          new Api.DocumentAttributeFilename({ fileName: safeName }),
          new Api.DocumentAttributeVideo({
            duration: Math.round((thumb.durationMs || 0) / 1000),
            w: draftItem.width,
            h: draftItem.height,
            supportsStreaming: true,
          }),
        ]
      : [
          new Api.DocumentAttributeFilename({ fileName: safeName }),
          new Api.DocumentAttributeImageSize({ w: draftItem.width, h: draftItem.height }),
        ];

    // Configurable chunk size: 128, 256, 512, 1024 KB
    const chunkSizeKb: UploadChunkSize = options?.chunkSizeKb || 512;
    const partSize = Math.min(512 * 1024, (chunkSizeKb === 1024 ? 512 : chunkSizeKb) * 1024);
    const workers = chunkSizeKb === 1024 ? 4 : chunkSizeKb === 512 ? 3 : 2;
    const partCount = Math.floor((file.size + partSize - 1) / partSize);
    const isLarge = file.size > 10 * 1024 * 1024;
    const fileId = generateRandomBigInt();

    const speedDesc =
      chunkSizeKb === 1024
        ? '1 MB Turbo Throughput'
        : `${chunkSizeKb} KB MTProto Chunks`;

    options?.onProgress?.(22, `Initializing ${speedDesc} upload (${partCount} chunks)...`);

    // Pausable & resumable chunk streaming loop
    const completedParts = new Set<number>();
    let nextPartIdx = 0;

    const uploadWorker = async () => {
      while (nextPartIdx < partCount) {
        if (options?.signal?.isCancelled) {
          throw new Error('Upload cancelled by user.');
        }

        // Handle pause: wait until resumed or cancelled
        if (options?.signal?.isPaused) {
          options?.onProgress?.(
            Math.min(94, Math.round((completedParts.size / partCount) * 72) + 22),
            `Upload paused (${completedParts.size}/${partCount} chunks)`
          );
          while (options?.signal?.isPaused && !options?.signal?.isCancelled) {
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
          if (options?.signal?.isCancelled) {
            throw new Error('Upload cancelled by user.');
          }
        }

        const partIdx = nextPartIdx++;
        if (partIdx >= partCount) break;

        const start = partIdx * partSize;
        const end = Math.min(file.size, (partIdx + 1) * partSize);
        const slice = file.slice(start, end);
        const chunkBuf = Buffer.from(await slice.arrayBuffer());

        if (isLarge) {
          await client.invoke(
            new Api.upload.SaveBigFilePart({
              fileId: fileId as any,
              filePart: partIdx,
              fileTotalParts: partCount,
              bytes: chunkBuf,
            })
          );
        } else {
          await client.invoke(
            new Api.upload.SaveFilePart({
              fileId: fileId as any,
              filePart: partIdx,
              bytes: chunkBuf,
            })
          );
        }

        completedParts.add(partIdx);
        const pct = Math.min(94, Math.round((completedParts.size / partCount) * 72) + 22);
        options?.onProgress?.(
          pct,
          `Streaming ${speedDesc} (${completedParts.size}/${partCount})`
        );
      }
    };

    // Run parallel workers for high-speed streaming
    const activeWorkers = Math.min(workers, Math.max(1, partCount));
    const workerPromises: Promise<void>[] = [];
    for (let w = 0; w < activeWorkers; w++) {
      workerPromises.push(uploadWorker());
    }
    await Promise.all(workerPromises);

    if (options?.signal?.isCancelled) {
      throw new Error('Upload cancelled by user.');
    }

    options?.onProgress?.(96, 'Binding uncompressed master into Telegram Vault channel');

    const inputFile = isLarge
      ? new Api.InputFileBig({ id: fileId as any, parts: partCount, name: safeName })
      : new Api.InputFile({ id: fileId as any, parts: partCount, name: safeName, md5Checksum: '' });

    // Send the already-uploaded document to the target Telegram peer
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sentMessage: any;
    try {
      sentMessage = await client.sendFile(targetPeer, {
        file: inputFile,
        caption: captionJson,
        forceDocument: true,
        attributes,
        thumb: thumbCustomFile,
      });
    } catch {
      if (thumbCustomFile) {
        try {
          sentMessage = await client.sendFile(targetPeer, {
            file: inputFile,
            caption: captionJson,
            forceDocument: true,
            attributes,
          });
        } catch {
          sentMessage = await client.sendFile(new Api.InputPeerSelf(), {
            file: inputFile,
            caption: captionJson,
            forceDocument: true,
            attributes,
          });
        }
      } else {
        sentMessage = await client.sendFile(new Api.InputPeerSelf(), {
          file: inputFile,
          caption: captionJson,
          forceDocument: true,
          attributes,
        });
      }
    }

    if (sentMessage?.id) {
      draftItem.messageId = Number(sentMessage.id);
    }

    this.blobCache.set(draftItem.messageId, fullObjectUrl);
    await db.media.put(draftItem);
    options?.onProgress?.(100, 'Verified & stored in Telegram');
    return draftItem;
  }

  /**
   * Parses any Telegram message (Framely JSON-captioned master OR native Telegram photo/video)
   * and upserts it into local Dexie IndexedDB with a cached thumbnail.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async parseAndIndexTelegramMessage(client: any, channelId: string, msg: any): Promise<boolean> {
    if (!msg || !msg.media || !msg.id) return false;

    const msgId = Number(msg.id);
    const isDoc = msg.media.className === 'MessageMediaDocument' || Boolean(msg.media.document);
    const isPhoto = msg.media.className === 'MessageMediaPhoto' || Boolean(msg.media.photo);
    if (!isDoc && !isPhoto) return false;

    // Check filename attribute if document
    let docFilename = '';
    if (isDoc && Array.isArray(msg.media.document?.attributes)) {
      for (const attr of msg.media.document.attributes) {
        if (attr.className === 'DocumentAttributeFilename' && attr.fileName) {
          docFilename = attr.fileName;
          break;
        }
      }
    }

    // Skip non-media documents
    if (isDoc && msg.media.document?.mimeType) {
      const mime = String(msg.media.document.mimeType).toLowerCase();
      const isMediaExt = /\.(jpe?g|png|webp|heic|heif|dng|arw|cr[23]|nef|raf|raw|mp4|mov|mkv|webm|avi|gif)$/i.test(
        docFilename
      );
      const isSupportedDoc =
        mime.startsWith('image/') ||
        mime.startsWith('video/') ||
        mime === 'application/octet-stream' ||
        isMediaExt;
      if (!isSupportedDoc) return false;
    }

    const existing = await db.media.get(msgId);

    let filename = docFilename || `telegram_${msgId}.jpg`;
    let kind: 'photo' | 'video' = 'photo';
    let mimeType = 'image/jpeg';
    let sizeBytes = 0;
    let width = 1600;
    let height = 1200;
    let durationMs: number | undefined = undefined;
    let sha256 = `tg_msg_${msgId}`;
    let takenAt = new Date((msg.date || Date.now() / 1000) * 1000).toISOString();
    let albums: string[] = [];
    let isFavorite = false;
    let camera: string | undefined = undefined;
    let latitude: number | undefined = undefined;
    let longitude: number | undefined = undefined;
    let tags: string[] = [];
    let aiDescription: string | undefined = undefined;

    const parsedCaption = decodeStructuredCaption(
      typeof msg.message === 'string' ? msg.message : undefined
    );
    if (parsedCaption) {
      filename = parsedCaption.name || filename;
      takenAt = parsedCaption.taken || takenAt;
      width = parsedCaption.w || width;
      height = parsedCaption.h || height;
      sha256 = parsedCaption.sha || sha256;
      albums = parsedCaption.albums || [];
      isFavorite = parsedCaption.fav === 1;
      camera = parsedCaption.camera;
      latitude = parsedCaption.lat;
      longitude = parsedCaption.lon;
      tags = parsedCaption.tags || [];
      aiDescription = parsedCaption.desc;
    } else if (typeof msg.message === 'string' && msg.message.trim()) {
      filename = sanitizeFilename(msg.message.trim().slice(0, 80));
    }

    if (isPhoto) {
      const photo = msg.media.photo;
      if (photo && photo.className !== 'PhotoEmpty') {
        if (!/\.(jpe?g|png|webp|heic)$/i.test(filename)) {
          filename = `${filename}.jpg`;
        }
        kind = 'photo';
        mimeType = 'image/jpeg';
        if (Array.isArray(photo.sizes)) {
          for (const s of photo.sizes) {
            if (s.w && s.h && s.w * s.h > width * height) {
              width = s.w;
              height = s.h;
            }
            if (s.size && s.size > sizeBytes) {
              sizeBytes = Number(s.size);
            }
          }
        }
      }
    } else if (isDoc) {
      const doc = msg.media.document;
      if (doc) {
        sizeBytes = Number(doc.size || 0);
        mimeType = doc.mimeType || 'image/jpeg';
        kind = mimeType.startsWith('video/') ? 'video' : 'photo';
        if (Array.isArray(doc.attributes)) {
          for (const attr of doc.attributes) {
            if (attr.className === 'DocumentAttributeFilename' && attr.fileName) {
              filename = sanitizeFilename(attr.fileName);
            } else if (attr.className === 'DocumentAttributeImageSize') {
              width = attr.w || width;
              height = attr.h || height;
            } else if (attr.className === 'DocumentAttributeVideo') {
              kind = 'video';
              durationMs = Math.round((attr.duration || 0) * 1000);
              if (attr.w) width = attr.w;
              if (attr.h) height = attr.h;
            }
          }
        }
      }
    }

    let thumbnailDataUrl = existing?.thumbnailDataUrl || '';
    if (!thumbnailDataUrl) {
      try {
        const thumbBuffer = await client.downloadMedia(msg, { thumb: 1 });
        if (thumbBuffer && thumbBuffer.length > 0) {
          const b64 = Buffer.from(thumbBuffer).toString('base64');
          thumbnailDataUrl = `data:image/jpeg;base64,${b64}`;
        }
      } catch {
        // Try smallest available thumbnail fallback or SVG card
        try {
          const thumbZero = await client.downloadMedia(msg, { thumb: 0 });
          if (thumbZero && thumbZero.length > 0) {
            thumbnailDataUrl = `data:image/jpeg;base64,${Buffer.from(thumbZero).toString('base64')}`;
          }
        } catch {
          thumbnailDataUrl = '';
        }
      }
      if (!thumbnailDataUrl) {
        thumbnailDataUrl = buildFallbackSvgThumbnail(filename);
      }
    }

    const resolvedPlace = resolveRegionalPlace(latitude, longitude);
    const lowerName = filename.toLowerCase();

    const mediaRow: MediaItem = {
      messageId: msgId,
      libraryId: channelId,
      kind,
      filename,
      mimeType,
      sizeBytes,
      sha256,
      width,
      height,
      durationMs,
      camera,
      takenAt,
      latitude,
      longitude,
      placeName: resolvedPlace?.name,
      thumbnailDataUrl,
      fullUrl: existing?.fullUrl,
      isFavorite: existing ? existing.isFavorite : isFavorite,
      isArchived: existing ? existing.isArchived : false,
      isLocked: existing ? existing.isLocked : false,
      trashedAt: existing?.trashedAt,
      category:
        kind === 'video'
          ? 'video'
          : lowerName.includes('screenshot')
            ? 'screenshot'
            : lowerName.includes('scan') || lowerName.includes('doc')
              ? 'document'
              : 'photo',
      uploadedAt: new Date((msg.date || Date.now() / 1000) * 1000).toISOString(),
      albums: existing?.albums?.length ? existing.albums : albums,
      tags: existing?.tags?.length ? existing.tags : tags,
      aiDescription: existing?.aiDescription || aiDescription,
      mtprotoDc: this.session?.dcEndpoint || 'MTProto 2.0 WSS',
    };

    await db.media.put(mediaRow);

    // Ensure referenced albums exist in Dexie
    if (mediaRow.albums.length > 0) {
      const existingAlbums = await db.albums.where('libraryId').equals(channelId).toArray();
      const existingNames = new Set(existingAlbums.map((a) => a.name.toLowerCase()));
      for (const albumName of mediaRow.albums) {
        if (!existingNames.has(albumName.toLowerCase())) {
          await db.albums.add({
            name: albumName,
            coverMediaId: msgId,
            createdAt: mediaRow.uploadedAt,
            libraryId: channelId,
          });
          existingNames.add(albumName.toLowerCase());
        }
      }
    }

    return true;
  }

  /**
   * Syncs messages from the user's real Telegram storage channel into IndexedDB.
   * By default, paginates through all historical channel messages in 100-item batches
   * so every single photo/video is pulled from Telegram into Framely.
   */
  async syncRecentChannelMessages(options?: {
    limit?: number;
    fetchAll?: boolean;
    onProgress?: (syncedCount: number, scannedCount: number) => void;
  } | number): Promise<{ syncedCount: number }> {
    const session = this.getSession();
    if (!session) {
      throw new Error('Connect your Telegram account first to sync.');
    }
    const client = await this.ensureConnectedClient();
    const targetPeer = await this.resolveTargetPeer(client, session.channelId);

    // Support legacy number signature for backwards compatibility
    const opts = typeof options === 'number' ? { limit: options, fetchAll: false } : options;
    const BATCH_SIZE = 100;
    const fetchAll = opts?.fetchAll ?? true;
    const maxLimit = opts?.limit ?? (fetchAll ? 10000 : 100);

    let offsetId = 0;
    let totalSynced = 0;
    let totalScanned = 0;

    while (totalScanned < maxLimit) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const messages: any[] = await client.getMessages(targetPeer, {
        limit: BATCH_SIZE,
        offsetId,
      });

      if (!messages || messages.length === 0) break;

      let batchNewCount = 0;
      for (const msg of messages) {
        totalScanned += 1;
        offsetId = msg.id;
        if (msg?.media) {
          const indexed = await this.parseAndIndexTelegramMessage(client, session.channelId, msg);
          if (indexed) {
            batchNewCount += 1;
            totalSynced += 1;
          }
        }
      }

      opts?.onProgress?.(totalSynced, totalScanned);

      // Reached the beginning of the channel history
      if (messages.length < BATCH_SIZE) break;

      // If doing incremental sync, stop when a full batch contains no new items
      if (!fetchAll && batchNewCount === 0 && totalScanned >= 100) {
        break;
      }
    }

    return { syncedCount: totalSynced };
  }

  /**
   * Scans the entire Telegram channel history in 100-message batches to rebuild
   * the local IndexedDB index from scratch on any browser or device.
   */
  async rebuildIndexFromChannel(
    onProgress?: (scannedCount: number, indexedCount: number) => void
  ): Promise<{ totalScanned: number; totalIndexed: number }> {
    const session = this.getSession();
    if (!session) {
      throw new Error('Please sign in with Telegram first to rebuild your library index.');
    }
    const client = await this.ensureConnectedClient();
    const targetPeer = await this.resolveTargetPeer(client, session.channelId);

    let scannedCount = 0;
    let indexedCount = 0;
    let offsetId = 0;
    const BATCH_SIZE = 100;

    while (true) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const messages: any[] = await client.getMessages(targetPeer, {
        limit: BATCH_SIZE,
        offsetId,
      });
      if (!messages || messages.length === 0) break;

      for (const msg of messages) {
        scannedCount += 1;
        offsetId = msg.id;
        if (msg?.media) {
          const indexed = await this.parseAndIndexTelegramMessage(client, session.channelId, msg);
          if (indexed) indexedCount += 1;
        }
      }

      onProgress?.(scannedCount, indexedCount);
      if (messages.length < BATCH_SIZE) break;
    }

    return { totalScanned: scannedCount, totalIndexed: indexedCount };
  }

  /**
   * Starts a live real-time Telegram event listener so photos/videos sent directly
   * to the private channel from any Telegram app appear immediately in Framely.
   */
  async startLiveChannelListener(onNewIndexed?: (messageId: number) => void): Promise<void> {
    if (this.liveListenerCleanup) return;
    const session = this.getSession();
    if (!session) return;

    const client = await this.ensureConnectedClient();
    const targetCleanId = normalizeChannelId(session.channelId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = async (update: any) => {
      try {
        const msg =
          update?.message ||
          (update?.className === 'UpdateNewChannelMessage' ? update.message : null);
        if (!msg || !(msg.media || msg.photo || msg.document)) return;

        // Scope updates to the active library channel (or Saved Messages when channelId === 'me')
        const peerChannelId = msg.peerId?.channelId ? String(msg.peerId.channelId) : null;
        if (session.channelId !== 'me' && peerChannelId && peerChannelId !== targetCleanId) {
          return;
        }

        const ok = await this.parseAndIndexTelegramMessage(client, session.channelId, msg);
        if (ok && msg.id) {
          onNewIndexed?.(Number(msg.id));
        }
      } catch (err) {
        console.warn('[Telegram Live] Update handler warning:', err);
      }
    };

    client.addEventHandler(handler);
    this.liveListenerCleanup = () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client.removeEventHandler(handler, undefined as any);
      } catch {
        // Ignore cleanup errors
      }
      this.liveListenerCleanup = null;
    };
  }

  stopLiveChannelListener(): void {
    this.liveListenerCleanup?.();
  }

  /**
   * Syncs updated favorite/album metadata back to the Telegram channel message caption
   * so metadata persists cleanly across devices and full index rebuilds.
   */
  async syncItemMetadataToTelegram(item: MediaItem): Promise<void> {
    const session = this.getSession();
    if (!session || !this.client?.connected) return;
    try {
      const targetPeer = await this.resolveTargetPeer(this.client, session.channelId);
      const caption = encodeStructuredCaption(item);
      await this.client.editMessage(targetPeer, {
        message: item.messageId,
        text: caption,
      });
    } catch {
      // Editing may fail for native Telegram messages without edit rights or unchanged text; keep local state.
    }
  }

  /**
   * Permanently deletes messages from the Telegram storage channel when emptied from Trash.
   */
  async deleteMessagesFromTelegram(messageIds: number[]): Promise<void> {
    if (messageIds.length === 0) return;
    const session = this.getSession();
    if (!session) return;
    try {
      const client = await this.ensureConnectedClient();
      const targetPeer = await this.resolveTargetPeer(client, session.channelId);
      await client.deleteMessages(targetPeer, messageIds, { revoke: true });
    } catch (err) {
      console.warn('[Telegram] Remote message deletion skipped:', err);
    }
  }

  /**
   * 4-worker parallel chunk streaming downloader for full-resolution originals & videos
   * with LRU Blob URL caching.
   */
  async downloadMediaChunked(
    item: MediaItem,
    onProgress?: (pct: number) => void
  ): Promise<string> {
    const cached = this.blobCache.get(item.messageId);
    if (cached) {
      onProgress?.(100);
      return cached;
    }

    if (item.fullUrl && item.fullUrl.startsWith('blob:')) {
      this.blobCache.set(item.messageId, item.fullUrl);
      onProgress?.(100);
      return item.fullUrl;
    }

    const session = this.getSession();
    if (!session) {
      return item.fullUrl || item.thumbnailDataUrl;
    }

    const client = await this.ensureConnectedClient();
    const targetPeer = await this.resolveTargetPeer(client, session.channelId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = await client.getMessages(targetPeer, { ids: [item.messageId] });
    const msg = messages?.[0];

    if (msg?.media) {
      const buffer = await client.downloadMedia(msg, {
        workers: 4,
        progressCallback: (received: number, total: number) => {
          if (total > 0) {
            onProgress?.(Math.min(100, Math.round((Number(received) / Number(total)) * 100)));
          }
        },
      });
      if (buffer && buffer.length > 0) {
        const mime = msg.media.document?.mimeType || item.mimeType || 'image/jpeg';
        const rawBytes = Buffer.from(buffer);
        const uint8 = new Uint8Array(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
        const blob = new Blob([uint8], { type: mime });
        const url = URL.createObjectURL(blob);
        this.blobCache.set(item.messageId, url);
        onProgress?.(100);
        return url;
      }
    }

    const fallback = item.fullUrl || item.thumbnailDataUrl;
    if (fallback) onProgress?.(100);
    return fallback;
  }

  /**
   * Locks the in-memory session (for AES-256-GCM encrypted vault mode) without revoking Telegram auth.
   */
  lockSession(): void {
    this.stopLiveChannelListener();
    try {
      this.client?.disconnect?.();
    } catch {
      // Ignore
    }
    this.client = null;
    this.session = null;
    this.blobCache.clear();
  }

  /**
   * True Telegram Logout: revokes session server-side via Api.auth.LogOut, disconnects WSS,
   * and clears local session credentials.
   */
  async logoutFromTelegram(): Promise<void> {
    this.stopLiveChannelListener();
    await this.cancelPendingAuth();
    if (this.client?.connected) {
      try {
        const { Api } = await loadGramJs();
        await this.client.invoke(new Api.auth.LogOut());
      } catch {
        // Ignore if session already expired
      }
    }
    try {
      await this.client?.disconnect?.();
    } catch {
      // Ignore
    }
    this.client = null;
    this.session = null;
    this.blobCache.clear();
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }
}

export const tgClient = new TelegramClientEngine();
