import Dexie, { type Table } from 'dexie';
import type { AlbumItem, MediaItem, PersonGroup } from '../types';

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
    this.version(2).stores({
      media:
        'messageId, libraryId, kind, takenAt, placeName, isFavorite, isArchived, trashedAt, *albums, *tags',
      albums: '++id, name, coverMediaId, createdAt, libraryId',
      personGroups: 'id, name, faceUrl, count, libraryId',
    });
  }
}

export const db = new FramelyDatabase();

export async function clearAllIndexedDb(): Promise<void> {
  await db.transaction('rw', db.media, db.albums, db.personGroups, async () => {
    await db.media.clear();
    await db.albums.clear();
    await db.personGroups.clear();
  });
}
