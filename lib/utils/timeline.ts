import type { DayGroup, MediaItem } from '../types';

export interface MemoryHighlight {
  id: string;
  title: string;
  eyebrow: string;
  subtitle: string;
  badge: string;
  kind: 'anniversary' | 'seasonal' | 'collection';
  yearsAgo?: number;
  coverItem: MediaItem;
  items: MediaItem[];
}

export interface TimelineMonthNode {
  year: number;
  month: number; // 0-11 UTC
  monthKey: string; // YYYY-MM
  shortLabel: string; // Jan, Feb, ...
  fullLabel: string; // November 2026
  firstDateKey: string; // YYYY-MM-DD anchor
  itemCount: number;
}

export interface TimelineYearNode {
  year: number;
  firstDateKey: string;
  totalCount: number;
  months: TimelineMonthNode[];
}

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const FULL_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * Computes the circular calendar-day distance (0..183) between two UTC month/day pairs,
 * ignoring year so Dec 30 and Jan 2 are recognized as 3 days apart.
 */
function calendarDayDistance(
  monthA: number,
  dayA: number,
  monthB: number,
  dayB: number
): number {
  const refYear = 2024; // leap year handles Feb 29 cleanly
  const msA = Date.UTC(refYear, monthA, dayA);
  const msB = Date.UTC(refYear, monthB, dayB);
  const rawDays = Math.abs(msA - msB) / 86_400_000;
  return Math.min(rawDays, 366 - rawDays);
}

function pickBestCover(items: MediaItem[]): MediaItem {
  const sorted = [...items].sort((a, b) => {
    const favScore = Number(Boolean(b.isFavorite)) - Number(Boolean(a.isFavorite));
    if (favScore !== 0) return favScore;
    const photoBias = (b.kind === 'photo' ? 1 : 0) - (a.kind === 'photo' ? 1 : 0);
    if (photoBias !== 0) return photoBias;
    return new Date(b.takenAt).getTime() - new Date(a.takenAt).getTime();
  });
  return sorted[0];
}

function primaryPlaceSummary(items: MediaItem[]): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.placeName) {
      counts.set(item.placeName, (counts.get(item.placeName) ?? 0) + 1);
    }
  }
  let topPlace = '';
  let topCount = 0;
  for (const [place, count] of counts.entries()) {
    if (count > topCount) {
      topPlace = place;
      topCount = count;
    }
  }
  return topPlace;
}

/**
 * Builds curated horizontal Memories highlights grounded in the current calendar date
 * across previous years ("On this day", "This week · N years ago", same-month flashbacks),
 * complemented by seasonal & favorite spotlights when needed.
 */
export function buildCuratedMemories(
  items: MediaItem[],
  referenceDate = new Date()
): MemoryHighlight[] {
  const eligible = items.filter((item) => !item.trashedAt && !item.isLocked);
  if (eligible.length === 0) return [];

  const refYear = referenceDate.getUTCFullYear();
  const refMonth = referenceDate.getUTCMonth();
  const refDay = referenceDate.getUTCDate();

  const memories: MemoryHighlight[] = [];
  const usedCoverIds = new Set<number>();

  // 1. Group previous-year items by year and evaluate proximity to current calendar date
  const byPrevYear = new Map<number, MediaItem[]>();
  for (const item of eligible) {
    const dt = new Date(item.takenAt);
    if (Number.isNaN(dt.getTime())) continue;
    const y = dt.getUTCFullYear();
    if (y < refYear) {
      const list = byPrevYear.get(y) ?? [];
      list.push(item);
      byPrevYear.set(y, list);
    }
  }

  const prevYearsDesc = Array.from(byPrevYear.keys()).sort((a, b) => b - a);

  for (const year of prevYearsDesc) {
    const yearItems = byPrevYear.get(year) ?? [];
    const yearsAgo = refYear - year;
    const unit = yearsAgo === 1 ? 'year' : 'years';

    // Exact day match or within ±14 days of current calendar date
    const exactMatches: MediaItem[] = [];
    const nearMatches: MediaItem[] = [];
    const sameMonthMatches: MediaItem[] = [];

    for (const item of yearItems) {
      const dt = new Date(item.takenAt);
      const m = dt.getUTCMonth();
      const d = dt.getUTCDate();
      const dist = calendarDayDistance(m, d, refMonth, refDay);
      if (dist === 0) {
        exactMatches.push(item);
      } else if (dist <= 14) {
        nearMatches.push(item);
      }
      if (m === refMonth) {
        sameMonthMatches.push(item);
      }
    }

    const anniversaryPool =
      exactMatches.length > 0
        ? [...exactMatches, ...nearMatches.filter((n) => !exactMatches.includes(n))]
        : nearMatches.length > 0
          ? nearMatches
          : sameMonthMatches;

    if (anniversaryPool.length > 0) {
      const cover = pickBestCover(anniversaryPool);
      usedCoverIds.add(cover.messageId);
      const place = primaryPlaceSummary(anniversaryPool);
      const isExact = exactMatches.length > 0;
      const isNear = !isExact && nearMatches.length > 0;

      memories.push({
        id: `anniversary-${year}`,
        title: isExact
          ? `${yearsAgo} ${unit} ago today`
          : isNear
            ? `${yearsAgo} ${unit} ago this week`
            : `${FULL_MONTHS[refMonth]} ${year}`,
        eyebrow: `${SHORT_MONTHS[refMonth]} ${refDay}, ${year}`,
        subtitle: place || `${anniversaryPool.length} ${anniversaryPool.length === 1 ? 'memory' : 'memories'}`,
        badge: isExact ? 'On This Day' : `${yearsAgo}Y Ago`,
        kind: 'anniversary',
        yearsAgo,
        coverItem: cover,
        items: anniversaryPool,
      });
    }
  }

  // 2. Cross-year same-month flashback ("November Through the Years") when >= 2 years match
  const sameMonthAllYears = eligible.filter((item) => {
    const dt = new Date(item.takenAt);
    return !Number.isNaN(dt.getTime()) && dt.getUTCMonth() === refMonth;
  });
  const sameMonthYears = new Set(
    sameMonthAllYears.map((i) => new Date(i.takenAt).getUTCFullYear())
  );
  if (sameMonthAllYears.length >= 2 && sameMonthYears.size >= 2) {
    const unusedCover =
      sameMonthAllYears.find((i) => !usedCoverIds.has(i.messageId)) ??
      pickBestCover(sameMonthAllYears);
    usedCoverIds.add(unusedCover.messageId);
    const minY = Math.min(...sameMonthYears);
    const maxY = Math.max(...sameMonthYears);
    memories.push({
      id: `month-flashback-${refMonth}`,
      title: `${FULL_MONTHS[refMonth]} Flashbacks`,
      eyebrow: `${minY} – ${maxY}`,
      subtitle: `${sameMonthAllYears.length} moments across ${sameMonthYears.size} years`,
      badge: 'Spotlight',
      kind: 'seasonal',
      coverItem: unusedCover,
      items: sameMonthAllYears,
    });
  }

  // 3. Curated destination & favorites spotlights so the carousel feels rich & scrollable
  const favorites = eligible.filter((i) => i.isFavorite);
  if (favorites.length > 0) {
    const favCover =
      favorites.find((i) => !usedCoverIds.has(i.messageId)) ?? pickBestCover(favorites);
    usedCoverIds.add(favCover.messageId);
    memories.push({
      id: 'spotlight-favorites',
      title: 'Best of Your Vault',
      eyebrow: `${favorites.length} Starred Masters`,
      subtitle: primaryPlaceSummary(favorites) || 'Uncompressed Originals',
      badge: 'Curated',
      kind: 'collection',
      coverItem: favCover,
      items: favorites,
    });
  }

  // Add up to 2 regional trip spotlights from distinct places
  const byPlace = new Map<string, MediaItem[]>();
  for (const item of eligible) {
    if (!item.placeName) continue;
    const list = byPlace.get(item.placeName) ?? [];
    list.push(item);
    byPlace.set(item.placeName, list);
  }
  const rankedPlaces = Array.from(byPlace.entries()).sort((a, b) => b[1].length - a[1].length);
  for (const [placeName, placeItems] of rankedPlaces) {
    if (memories.length >= 6) break;
    const cover = placeItems.find((i) => !usedCoverIds.has(i.messageId));
    if (!cover) continue;
    usedCoverIds.add(cover.messageId);
    const latestYear = new Date(placeItems[0].takenAt).getUTCFullYear();
    memories.push({
      id: `place-${placeName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title: placeName.split('&')[0].trim(),
      eyebrow: `${latestYear} · Trip Highlight`,
      subtitle: `${placeItems.length} ${placeItems.length === 1 ? 'original' : 'originals'}`,
      badge: 'Trip',
      kind: 'collection',
      coverItem: cover,
      items: placeItems,
    });
  }

  return memories;
}

/**
 * Extracts hierarchical descending Years -> Months jump targets from DayGroups
 * for the Floating Date Scrubber Rail.
 */
export function extractTimelineYearMonths(groups: DayGroup[]): TimelineYearNode[] {
  const yearMap = new Map<
    number,
    {
      year: number;
      firstDateKey: string;
      totalCount: number;
      monthMap: Map<number, TimelineMonthNode>;
    }
  >();

  for (const group of groups) {
    const dt = new Date(`${group.dateKey}T00:00:00.000Z`);
    const year = Number.isNaN(dt.getTime()) ? group.year : dt.getUTCFullYear();
    const month = Number.isNaN(dt.getTime()) ? 0 : dt.getUTCMonth();
    const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;

    let yearEntry = yearMap.get(year);
    if (!yearEntry) {
      yearEntry = {
        year,
        firstDateKey: group.dateKey,
        totalCount: 0,
        monthMap: new Map(),
      };
      yearMap.set(year, yearEntry);
    }
    yearEntry.totalCount += group.items.length;

    let monthEntry = yearEntry.monthMap.get(month);
    if (!monthEntry) {
      monthEntry = {
        year,
        month,
        monthKey,
        shortLabel: SHORT_MONTHS[month] ?? 'Jan',
        fullLabel: `${FULL_MONTHS[month] ?? 'January'} ${year}`,
        firstDateKey: group.dateKey,
        itemCount: 0,
      };
      yearEntry.monthMap.set(month, monthEntry);
    }
    monthEntry.itemCount += group.items.length;
  }

  return Array.from(yearMap.values())
    .sort((a, b) => b.year - a.year)
    .map((entry) => ({
      year: entry.year,
      firstDateKey: entry.firstDateKey,
      totalCount: entry.totalCount,
      months: Array.from(entry.monthMap.values()).sort((a, b) => b.month - a.month),
    }));
}
