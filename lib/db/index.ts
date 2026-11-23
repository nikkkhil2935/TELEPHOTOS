import Dexie, { type Table } from 'dexie';
import type { AlbumItem, MediaItem, PersonGroup } from '../types';
import {
  DEFAULT_LIBRARY_ID,
  SEED_ALBUMS,
  SEED_MEDIA_ITEMS,
  SEED_PEOPLE,
} from './seedData';

export class FramelyDatabase extends Dexie {
  media!: Table<MediaItem, number>;
  albums!: Table<AlbumItem, number>;
  personGroups!: Table<PersonGroup, string>;

  constructor() {
    super('FramelyVaultDB');
    this.version(1).stores({
      media:
        'messageId, libraryId, kind, takenAt, placeName, isFavorite, isArchived, trashedAt, *albums',
      albums: '++id, name, coverMediaId, createdAt, libraryId',
      personGroups: 'id, name, faceUrl, count, libraryId',
    });
  }
}

export const db = new FramelyDatabase();

const SEED_FLAG_KEY = 'framely_seed_v2_memories';
let seedInFlight: Promise<void> | null = null;

export async function ensureSeedData(libraryId = DEFAULT_LIBRARY_ID): Promise<void> {
  if (typeof window === 'undefined') return;
  if (seedInFlight) return seedInFlight;

  seedInFlight = (async () => {
    const alreadyInitialized = window.localStorage.getItem(SEED_FLAG_KEY) === '1';
    const existingCount = await db.media.where('libraryId').equals(libraryId).count();

    if (!alreadyInitialized || existingCount === 0) {
      await db.transaction('rw', db.media, db.albums, db.personGroups, async () => {
        const existingMedia = await db.media.where('libraryId').equals(libraryId).toArray();
        const existingIds = new Set(existingMedia.map((m) => m.messageId));
        const missingMedia = SEED_MEDIA_ITEMS.filter((item) => !existingIds.has(item.messageId)).map(
          (item) => ({ ...item, libraryId })
        );
        if (missingMedia.length > 0) {
          await db.media.bulkPut(missingMedia);
        }
        const albumCount = await db.albums.where('libraryId').equals(libraryId).count();
        if (albumCount === 0) {
          await db.albums.bulkAdd(
            SEED_ALBUMS.map((album) => ({ ...album, libraryId }))
          );
        }
        const peopleCount = await db.personGroups.where('libraryId').equals(libraryId).count();
        if (peopleCount === 0) {
          await db.personGroups.bulkPut(
            SEED_PEOPLE.map((person) => ({ ...person, libraryId }))
          );
        }
      });
      window.localStorage.setItem(SEED_FLAG_KEY, '1');
    }
  })().finally(() => {
    seedInFlight = null;
  });

  return seedInFlight;
}

export async function restoreDemoLibrary(libraryId = DEFAULT_LIBRARY_ID): Promise<void> {
  await db.transaction('rw', db.media, db.albums, db.personGroups, async () => {
    await db.media.where('libraryId').equals(libraryId).delete();
    await db.albums.where('libraryId').equals(libraryId).delete();
    await db.personGroups.where('libraryId').equals(libraryId).delete();
    await db.media.bulkPut(SEED_MEDIA_ITEMS.map((item) => ({ ...item, libraryId })));
    await db.albums.bulkAdd(SEED_ALBUMS.map((album) => ({ ...album, libraryId })));
    await db.personGroups.bulkPut(SEED_PEOPLE.map((person) => ({ ...person, libraryId })));
  });
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(SEED_FLAG_KEY, '1');
  }
}

export async function clearAllIndexedDb(): Promise<void> {
  await db.transaction('rw', db.media, db.albums, db.personGroups, async () => {
    await db.media.clear();
    await db.albums.clear();
    await db.personGroups.clear();
  });
}
