// ============================================================
// U-WIN upload duration rules
//
// Every U-WIN upload (district and state) is declared Weekly or Monthly before any
// file is picked. That choice fixes how long each file's From-To window may be and
// how many files one upload may hold:
//
//   * Weekly  -> exactly 7 days per file, at most 4 files. Each week is analysed as
//                its own period ("1-7 April 2026").
//   * Monthly -> 28 to 31 days per file, at most 12 files. The window is analysed as
//                the calendar month holding most of its days, so 20 Apr - 20 May 2026
//                is May 2026. A tie goes to the later month.
//
// Any other length (1-6, 8-27 or 32+ days) is rejected. Day counts are inclusive,
// so 1-28 Feb is 28 days and every calendar month fits the monthly range. No date
// may fall after today.
//
// Files in one upload must be consecutive: sorted by From date, each starts the
// day after the previous one ends - no overlap (the same sessions counted twice)
// and no gap. Monthly files must also land on consecutive months, never the same
// month twice and never skipping one.
//
// The declared From-To dates are kept alongside the analysis month (see
// declaredWindow) so a saved review records exactly which days it covered.
// ============================================================

import {
  daysSpanInclusive,
  makePeriodKey,
  monthEndDay,
  monthLongLabel,
  periodMonths,
} from '../dqa/parseUtils';

export type UwinUploadDuration = 'WEEKLY' | 'MONTHLY';

export interface UwinDurationRule {
  label: string;
  minDays: number;
  maxDays: number;
  maxFiles: number;
}

export const UWIN_DURATION_RULES: Record<UwinUploadDuration, UwinDurationRule> = {
  WEEKLY: { label: 'Weekly', minDays: 7, maxDays: 7, maxFiles: 4 },
  MONTHLY: { label: 'Monthly', minDays: 28, maxDays: 31, maxFiles: 12 },
};

/** One file's declared window, as entered on the upload form. */
export interface UwinPeriodEntry {
  fileName: string;
  from: string;
  to: string;
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Today on the user's own calendar, "YYYY-MM-DD" - the last day a file may cover. */
export function localToday(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** "YYYY-MM-DD" shifted by `days` calendar days (UTC, so no timezone drift). */
export function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function nextMonthKey(ym: string): string {
  const [year, month] = ym.split('-').map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}

/** "14 Oct 2026". */
export function dayLabel(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return `${day} ${MONTHS_SHORT[month - 1] ?? month} ${year}`;
}

/** Display label for a declared window, e.g. "20 Apr - 20 May 2026"; one day reads "1 May 2026". */
export function windowLabel(from: string, to: string): string {
  return from === to ? dayLabel(from) : monthLongLabel(`${from}..${to}`);
}

/** Days the window spends in each calendar month it touches, oldest first. */
export function monthDayCounts(from: string, to: string): { month: string; days: number }[] {
  const key = makePeriodKey(from, to);
  if (!key) return [];
  return periodMonths(key).map((month) => {
    const start = from > `${month}-01` ? from : `${month}-01`;
    const end = to < monthEndDay(month) ? to : monthEndDay(month);
    return { month, days: daysSpanInclusive(start, end) ?? 0 };
  });
}

/** Calendar month ("YYYY-MM") holding most of the window's days; a tie goes to the later month. */
export function analysisMonth(from: string, to: string): string | null {
  let best: { month: string; days: number } | null = null;
  for (const entry of monthDayCounts(from, to)) {
    if (!best || entry.days >= best.days) best = entry;
  }
  return best?.month ?? null;
}

/** Why a single window breaks the rules, or null when it is valid. */
export function checkUwinPeriod(
  duration: UwinUploadDuration,
  from: string,
  to: string,
  today: string = localToday(),
): string | null {
  if (!from || !to) return 'Enter both a From date and a To date.';
  if (from > to) return 'The From date must be on or before the To date.';
  const days = daysSpanInclusive(from, to);
  if (days === null) return 'Enter valid dates.';
  if (to > today) return `Dates cannot be in the future. The latest allowed date is today, ${dayLabel(today)}.`;
  const rule = UWIN_DURATION_RULES[duration];
  if (days >= rule.minDays && days <= rule.maxDays) return null;
  const covered = `This window covers ${days} day${days === 1 ? '' : 's'}.`;
  return duration === 'WEEKLY'
    ? `A weekly file must cover exactly 7 days. ${covered}`
    : `A monthly file must cover 28 to 31 days. ${covered}`;
}

/**
 * Analysis bucket for a valid window: the month key for a monthly file, the day
 * range for a weekly one. Null when the window breaks the rules.
 */
export function uwinPeriodKey(
  duration: UwinUploadDuration,
  from: string,
  to: string,
  today: string = localToday(),
): string | null {
  if (checkUwinPeriod(duration, from, to, today)) return null;
  return duration === 'MONTHLY' ? analysisMonth(from, to) : makePeriodKey(from, to);
}

/** Why the file count is over the limit for this duration, or null. */
export function checkUwinFileCount(duration: UwinUploadDuration, count: number): string | null {
  const rule = UWIN_DURATION_RULES[duration];
  if (count <= rule.maxFiles) return null;
  const unit = duration === 'WEEKLY' ? 'one per week' : 'one per month';
  return `${rule.label} uploads take at most ${rule.maxFiles} files (${unit}). You selected ${count}.`;
}

/**
 * Breaks in the consecutive sequence across one upload: overlapping windows, gaps
 * between them, and monthly files that repeat or skip a month. Only windows that
 * are valid on their own are compared.
 */
export function findUwinPeriodConflicts(
  duration: UwinUploadDuration,
  entries: UwinPeriodEntry[],
  today: string = localToday(),
): string[] {
  const sorted = entries
    .filter((entry) => checkUwinPeriod(duration, entry.from, entry.to, today) === null)
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  const conflicts: string[] = [];

  for (let index = 1; index < sorted.length; index += 1) {
    const prev = sorted[index - 1];
    const next = sorted[index];
    const pair = `"${prev.fileName}" (${windowLabel(prev.from, prev.to)}) and "${next.fileName}" (${windowLabel(next.from, next.to)})`;

    if (next.from <= prev.to) {
      conflicts.push(`${pair} overlap. Each file must cover different days.`);
      continue;
    }
    const expectedFrom = addDays(prev.to, 1);
    if (next.from !== expectedFrom) {
      conflicts.push(
        `${pair} are not consecutive: ${windowLabel(expectedFrom, addDays(next.from, -1))} is missing. ` +
        `Each file must start the day after the previous one ends.`,
      );
      continue;
    }
    if (duration === 'MONTHLY') {
      const prevMonth = analysisMonth(prev.from, prev.to)!;
      const nextMonth = analysisMonth(next.from, next.to)!;
      if (nextMonth === prevMonth) {
        conflicts.push(`${pair} are both analysed as ${monthLongLabel(prevMonth)}. Each monthly file must cover a different month.`);
      } else if (nextMonth !== nextMonthKey(prevMonth)) {
        conflicts.push(
          `${pair} are analysed as ${monthLongLabel(prevMonth)} and ${monthLongLabel(nextMonth)}, ` +
          `skipping ${monthLongLabel(nextMonthKey(prevMonth))}. Monthly files must cover consecutive months.`,
        );
      }
    }
  }

  return conflicts;
}

/** Every rule for one upload, in the order a user would fix them; empty when it may be analysed. */
export function checkUwinUpload(
  duration: UwinUploadDuration,
  entries: UwinPeriodEntry[],
  today: string = localToday(),
): string[] {
  const countError = checkUwinFileCount(duration, entries.length);
  if (countError) return [countError];
  const errors = entries.flatMap((entry) => {
    const error = checkUwinPeriod(duration, entry.from, entry.to, today);
    return error ? [`${entry.fileName}: ${error}`] : [];
  });
  return errors.length > 0 ? errors : findUwinPeriodConflicts(duration, entries, today);
}

/**
 * To date that pairs with a newly picked From date: From + 6 for a week; for a
 * month, the month end when From is the 1st, else the day before the same date
 * next month (clamped, so 31 Jan gives 27 Feb - still 28 days).
 */
export function suggestedPeriodEnd(duration: UwinUploadDuration, from: string): string {
  if (duration === 'WEEKLY') return addDays(from, 6);
  if (from.endsWith('-01')) return monthEndDay(from.slice(0, 7));
  const nextYm = nextMonthKey(from.slice(0, 7));
  const nextEnd = Number(monthEndDay(nextYm).slice(8, 10));
  const sameDayNext = `${nextYm}-${String(Math.min(Number(from.slice(8, 10)), nextEnd)).padStart(2, '0')}`;
  return addDays(sameDayNext, -1);
}

/** The From-To dates and duration behind a set of analysis periods. */
export interface DeclaredWindow {
  from: string;
  to: string;
  duration: UwinUploadDuration;
}

/**
 * First From and last To of the declared files behind `keys` (every file when
 * `keys` is empty), so a review narrowed to some periods records only their days.
 * Null when the upload declared no periods.
 */
export function declaredWindow(
  periods: { from: string; to: string; key: string; duration: UwinUploadDuration }[],
  keys: string[] = [],
): DeclaredWindow | null {
  const wanted = new Set(keys);
  const picked = keys.length > 0 ? periods.filter((period) => wanted.has(period.key)) : periods;
  if (picked.length === 0) return null;
  return {
    from: picked.reduce((min, period) => (period.from < min ? period.from : min), picked[0].from),
    to: picked.reduce((max, period) => (period.to > max ? period.to : max), picked[0].to),
    duration: picked[0].duration,
  };
}
