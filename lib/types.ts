export type MediaKind = 'photo' | 'video';

export type ThemeMode = 'light' | 'dark' | 'oled';

export type GridDensity = 'compact' | 'standard' | 'spacious';

export type GallerySection =
  | 'photos'
  | 'explore'
  | 'sharing'
  | 'albums'
  | 'documents'
  | 'screenshots'
  | 'favorites'
  | 'people'
  | 'places'
  | 'videos'
  | 'recent'
  | 'archive'
  | 'locked'
  | 'trash';

export interface MediaExifTelemetry {
  camera?: string;
  lens?: string;
  aperture?: string;
  shutterSpeed?: string;
  focalLength?: string;
  iso?: number;
}

export interface MediaItem {
  messageId: number;
  libraryId: string;
  kind: MediaKind;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  width: number;
  height: number;
  durationMs?: number;
  camera?: string;
  lens?: string;
  aperture?: string;
  shutterSpeed?: string;
  focalLength?: string;
  iso?: number;
  takenAt: string; // ISO string
  latitude?: number;
  longitude?: number;
  placeName?: string;
  thumbnailDataUrl: string;
  fullUrl?: string;
  isFavorite: boolean;
  isArchived: boolean;
  isLocked?: boolean;
  category?: 'photo' | 'document' | 'screenshot' | 'video';
  trashedAt?: string;
  uploadedAt: string;
  albums: string[];
  personIds?: string[];
  mtprotoDc?: string;
}

export interface AlbumItem {
  id?: number;
  name: string;
  coverMediaId?: number;
  createdAt: string;
  libraryId: string;
}

export interface PersonGroup {
  id: string;
  name: string;
  role: 'person' | 'pet';
  faceUrl: string;
  mediaIds: number[];
  count: number;
  libraryId: string;
}

export interface StructuredCaptionV1 {
  v: 1;
  name: string;
  taken: string;
  w: number;
  h: number;
  sha: string;
  camera?: string;
  lat?: number;
  lon?: number;
  fav: 0 | 1;
  albums: string[];
}

export interface EncryptedVaultEnvelope {
  v: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  cipher: 'AES-256-GCM';
  salt: string; // base64 16 bytes
  iv: string; // base64 12 bytes
  ciphertext: string; // base64 ciphertext + 128-bit tag
  updatedAt: string;
}

export interface TelegramSessionPayload {
  apiId: number;
  apiHash: string;
  sessionString: string;
  phoneNumber?: string;
  username?: string;
  displayName?: string;
  channelId: string;
  channelAccessHash?: string;
  channelTitle: string;
  dcEndpoint: string;
  connectedAt: string;
  mode: 'live-mtproto' | 'local-vault';
}

export interface TransferJob {
  id: string;
  filename: string;
  direction: 'upload' | 'download';
  sizeBytes: number;
  progress: number; // 0-100
  status: 'queued' | 'encrypting' | 'streaming' | 'completed' | 'error';
  detail?: string;
  startedAt: string;
}

export interface PlaceCluster {
  id: string;
  name: string;
  regionSubtitle: string;
  latitude: number;
  longitude: number;
  count: number;
  coverUrl: string;
  mediaIds: number[];
}

export interface DayGroup {
  dateKey: string;
  year: number;
  label: string;
  locationSummary: string;
  items: MediaItem[];
}
