import type { DayGroup, MediaItem, PlaceCluster, StructuredCaptionV1 } from '../types';

export const TELEGRAM_MAX_FILE_BYTES = 2048 * 1024 * 1024; // 2,048 MB (2 GB)
export const STORAGE_QUOTA_DISPLAY_BYTES = 5 * 1024 * 1024 * 1024 * 1024; // 5 TB visual meter

/**
 * Strips path traversal sequences, null bytes, control chars, and unsafe HTML chars.
 */
export function sanitizeFilename(raw: string): string {
  const cleaned = String(raw || 'untitled')
    .replace(/\0/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\.\.+/g, '.')
    .replace(/^\.+/, '')
    .trim();
  return cleaned.slice(0, 180) || 'untitled';
}

/**
 * Neutralizes HTML tags, script blocks, and javascript: URIs from captions/labels.
 */
export function sanitizeCaptionText(raw: string): string {
  return String(raw || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/javascript:/gi, '')
    .trim()
    .slice(0, 1024);
}

/**
 * Enforces Telegram's 2,048 MB single-file document upload cap.
 */
export function validateTelegramFileSize(sizeBytes: number): { valid: boolean; reason?: string } {
  if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { valid: false, reason: 'File appears to be empty or corrupted.' };
  }
  if (sizeBytes > TELEGRAM_MAX_FILE_BYTES) {
    return {
      valid: false,
      reason: `File size (${formatBytes(sizeBytes)}) exceeds Telegram's 2,048 MB single-document limit.`,
    };
  }
  return { valid: true };
}

/**
 * Ensures complete account isolation by Telegram channel libraryId.
 */
export function scopeMediaByLibrary<T extends { libraryId: string }>(
  records: T[],
  libraryId: string
): T[] {
  return records.filter((item) => item.libraryId === libraryId);
}

/**
 * Encodes a Schema v1 structured caption payload for Telegram channel storage.
 */
export function encodeStructuredCaption(item: MediaItem): string {
  const payload: StructuredCaptionV1 = {
    v: 1,
    name: sanitizeFilename(item.filename),
    taken: item.takenAt,
    w: item.width,
    h: item.height,
    sha: item.sha256,
    ...(item.camera ? { camera: sanitizeCaptionText(item.camera) } : {}),
    ...(typeof item.latitude === 'number' ? { lat: Number(item.latitude.toFixed(5)) } : {}),
    ...(typeof item.longitude === 'number' ? { lon: Number(item.longitude.toFixed(5)) } : {}),
    fav: item.isFavorite ? 1 : 0,
    albums: item.albums.map((a) => sanitizeCaptionText(a)).filter(Boolean),
  };
  return JSON.stringify(payload);
}

/**
 * Parses and sanitizes a Schema v1 caption JSON string from Telegram.
 */
export function decodeStructuredCaption(rawCaption: string): StructuredCaptionV1 | null {
  try {
    const parsed = JSON.parse(rawCaption);
    if (!parsed || parsed.v !== 1 || typeof parsed.name !== 'string') {
      return null;
    }
    return {
      v: 1,
      name: sanitizeFilename(parsed.name),
      taken: typeof parsed.taken === 'string' ? parsed.taken : new Date().toISOString(),
      w: Number(parsed.w) || 0,
      h: Number(parsed.h) || 0,
      sha: typeof parsed.sha === 'string' ? parsed.sha.slice(0, 128) : '',
      camera: typeof parsed.camera === 'string' ? sanitizeCaptionText(parsed.camera) : undefined,
      lat: typeof parsed.lat === 'number' && Number.isFinite(parsed.lat) ? parsed.lat : undefined,
      lon: typeof parsed.lon === 'number' && Number.isFinite(parsed.lon) ? parsed.lon : undefined,
      fav: parsed.fav === 1 ? 1 : 0,
      albums: Array.isArray(parsed.albums)
        ? parsed.albums.map((a: unknown) => sanitizeCaptionText(String(a))).filter(Boolean)
        : [],
    };
  } catch {
    return null;
  }
}

interface RegionDefinition {
  id: string;
  name: string;
  subtitle: string;
  lat: number;
  lon: number;
  radiusKm: number;
}

const KNOWN_REGIONS: RegionDefinition[] = [
  {
    id: 'mumbai-harbor',
    name: 'Mumbai City & Harbor',
    subtitle: 'Marine Drive · Colaba · Arabian Sea',
    lat: 18.9432,
    lon: 72.8235,
    radiusKm: 32,
  },
  {
    id: 'vasai-virar',
    name: 'Vasai & Virar Coast',
    subtitle: 'Arnala · Bassein Shoreline · Konkan',
    lat: 19.3919,
    lon: 72.8397,
    radiusKm: 35,
  },
  {
    id: 'pune-ghats',
    name: 'Pune & Western Ghats',
    subtitle: 'Sahyadri Ridges · Lonavala · Mulshi',
    lat: 18.5204,
    lon: 73.8567,
    radiusKm: 75,
  },
  {
    id: 'kyoto-arashiyama',
    name: 'Kyoto & Arashiyama',
    subtitle: 'Sagano Bamboo Grove · Kansai',
    lat: 35.0169,
    lon: 135.6713,
    radiusKm: 50,
  },
  {
    id: 'paris-leftbank',
    name: 'Paris & Marais Quarter',
    subtitle: 'Rue des Francs-Bourgeois · Île-de-France',
    lat: 48.8566,
    lon: 2.3522,
    radiusKm: 45,
  },
];

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Resolves GPS coordinates locally (zero external APIs) to a human geographical region.
 */
export function resolveRegionalPlace(
  latitude?: number,
  longitude?: number,
  fallbackName?: string
): { id: string; name: string; subtitle: string } | null {
  if (typeof latitude === 'number' && typeof longitude === 'number') {
    let best: { region: RegionDefinition; dist: number } | null = null;
    for (const region of KNOWN_REGIONS) {
      const dist = haversineKm(latitude, longitude, region.lat, region.lon);
      if (dist <= region.radiusKm && (!best || dist < best.dist)) {
        best = { region, dist };
      }
    }
    if (best) {
      return { id: best.region.id, name: best.region.name, subtitle: best.region.subtitle };
    }
    const latLabel = `${Math.abs(latitude).toFixed(2)}°${latitude >= 0 ? 'N' : 'S'}`;
    const lonLabel = `${Math.abs(longitude).toFixed(2)}°${longitude >= 0 ? 'E' : 'W'}`;
    return {
      id: `geo-${latitude.toFixed(1)}-${longitude.toFixed(1)}`,
      name: fallbackName || `Coordinates ${latLabel}, ${lonLabel}`,
      subtitle: `${latLabel} · ${lonLabel}`,
    };
  }
  if (fallbackName) {
    return {
      id: fallbackName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name: fallbackName,
      subtitle: 'Local EXIF Metadata',
    };
  }
  return null;
}

/**
 * Clusters geotagged media into Smart Regional Places cards.
 */
export function buildPlaceClusters(items: MediaItem[]): PlaceCluster[] {
  const map = new Map<string, PlaceCluster>();

  for (const item of items) {
    if (item.trashedAt || item.isLocked) continue;
    const resolved = resolveRegionalPlace(item.latitude, item.longitude, item.placeName);
    if (!resolved) continue;

    const existing = map.get(resolved.id);
    if (existing) {
      existing.count += 1;
      existing.mediaIds.push(item.messageId);
    } else {
      map.set(resolved.id, {
        id: resolved.id,
        name: resolved.name,
        regionSubtitle: resolved.subtitle,
        latitude: item.latitude ?? 0,
        longitude: item.longitude ?? 0,
        count: 1,
        coverUrl: item.thumbnailDataUrl || item.fullUrl || '',
        mediaIds: [item.messageId],
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

/**
 * Groups sorted media items into Google Photos style day sections.
 */
export function groupMediaByDay(items: MediaItem[], referenceNow = new Date()): DayGroup[] {
  const sorted = [...items].sort(
    (a, b) => new Date(b.takenAt).getTime() - new Date(a.takenAt).getTime()
  );

  const todayKey = referenceNow.toISOString().slice(0, 10);
  const yesterday = new Date(referenceNow.getTime() - 86400000);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);

  const groupsMap = new Map<string, DayGroup>();

  for (const item of sorted) {
    const dt = new Date(item.takenAt);
    const dateKey = Number.isNaN(dt.getTime()) ? todayKey : dt.toISOString().slice(0, 10);
    const year = dt.getUTCFullYear() || referenceNow.getUTCFullYear();

    let group = groupsMap.get(dateKey);
    if (!group) {
      const formatted = dt.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: year !== referenceNow.getUTCFullYear() ? 'numeric' : undefined,
        timeZone: 'UTC',
      });

      let label = formatted;
      if (dateKey === todayKey) {
        label = `Today — ${formatted}`;
      } else if (dateKey === yesterdayKey) {
        label = `Yesterday — ${formatted}`;
      }

      group = {
        dateKey,
        year,
        label,
        locationSummary: item.placeName || '',
        items: [],
      };
      groupsMap.set(dateKey, group);
    }

    group.items.push(item);
    if (!group.locationSummary && item.placeName) {
      group.locationSummary = item.placeName;
    }
  }

  return Array.from(groupsMap.values());
}

/**
 * Extracts distinct descending years for the floating Date Scrubber Rail.
 */
export function extractTimelineYears(groups: DayGroup[]): number[] {
  const seen = new Set<number>();
  for (const g of groups) {
    seen.add(g.year);
  }
  return Array.from(seen).sort((a, b) => b - a);
}

/**
 * Windowed slice calculator for the 0ms Camera Roll Filmstrip (active ± radius).
 */
export function getWindowedFilmstripIndices(
  totalCount: number,
  activeIndex: number,
  radius = 18
): { start: number; end: number } {
  if (totalCount <= 0) return { start: 0, end: 0 };
  const clamped = Math.max(0, Math.min(activeIndex, totalCount - 1));
  const start = Math.max(0, clamped - radius);
  const end = Math.min(totalCount, clamped + radius + 1);
  return { start, end };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exp);
  return `${value >= 100 || exp === 0 ? value.toFixed(0) : value.toFixed(exp >= 2 ? 1 : 0)} ${units[exp]}`;
}

export function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
