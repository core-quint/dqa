import { ArrowDownRight, ArrowUpRight, ChevronRight, History, Minus } from "lucide-react";
import { scoreBadgeStyle, scoreGrade } from "../../lib/dqa/scoreUtils";

export interface ScoreStripRow {
  key: string;
  label: string;
  /** The component's own colour, as the tabs use it. */
  color: string;
  current: number;
  /** Same component in the last saved review, or null when never saved. */
  previous: number | null;
}

export interface ScoreStripLast {
  savedAt: string;
  overall: number;
}

interface Props {
  overall: number;
  rows: ScoreStripRow[];
  last: ScoreStripLast | null;
  /** Whether this review has been saved in this session. */
  saved?: boolean;
  /** Opens the full breakdown — a dialog on some portals, the Overall tab on others. */
  onOpenDetail?: () => void;
  detailLabel?: string;
}

/** The component scores every portal stores on a saved snapshot. */
export interface SavedComponentScores {
  availabilityScore?: number | null;
  completenessScore?: number | null;
  accuracyScore?: number | null;
  consistencyScore?: number | null;
}

const SAVED_SCORE_KEY: Record<string, keyof SavedComponentScores> = {
  availability: "availabilityScore",
  completeness: "completenessScore",
  accuracy: "accuracyScore",
  consistency: "consistencyScore",
};

/** One component's score in the last saved review, or null when it was never recorded. */
export function savedComponentScore(
  saved: SavedComponentScores | null,
  group: string,
): number | null {
  if (!saved) return null;
  const key = SAVED_SCORE_KEY[group];
  if (!key) return null;
  const value = saved[key];
  return typeof value === "number" ? value : null;
}

/** Deltas below this are noise from a re-filter, not a real movement. */
const DELTA_EPSILON = 0.05;

function formatDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Movement against the last saved review. A higher score is better, so a rise is
 * the good direction — coloured accordingly, and flat when nothing really moved.
 */
function Delta({ current, previous, size = "sm" }: { current: number; previous: number | null; size?: "sm" | "md" }) {
  if (previous === null) return null;
  const diff = current - previous;
  const flat = Math.abs(diff) < DELTA_EPSILON;
  const Icon = flat ? Minus : diff > 0 ? ArrowUpRight : ArrowDownRight;
  const tone = flat
    ? "bg-slate-100 text-slate-500"
    : diff > 0
      ? "bg-emerald-50 text-emerald-700"
      : "bg-red-50 text-red-700";
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-bold tabular-nums ${tone} ${
        size === "md" ? "text-[11px]" : "text-[10px]"
      }`}
      title={`${flat ? "No change" : diff > 0 ? "Up" : "Down"} versus the last saved review`}
    >
      <Icon className={size === "md" ? "h-3 w-3" : "h-2.5 w-2.5"} />
      {flat ? "0.0" : `${diff > 0 ? "+" : ""}${diff.toFixed(1)}`}
    </span>
  );
}

/**
 * The scores of the review on screen, with the last saved review kept on its own
 * clearly labelled line underneath.
 *
 * The two used to share one wrapping row of badges in the page header, where the
 * saved scores read as the current ones. Here the current score is the only large
 * number, every component carries its movement against the saved review, and what
 * was saved is a muted footnote that cannot be mistaken for now.
 */
export function ScoreStrip({
  overall,
  rows,
  last,
  saved = false,
  onOpenDetail,
  detailLabel = "Breakdown",
}: Props) {
  const badge = scoreBadgeStyle(overall);
  const grade = scoreGrade(overall);

  return (
    <div className="rounded-[20px] border border-slate-200 bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-stretch gap-2">
        {/* Current overall — the only large number on the page header. */}
        <button
          type="button"
          onClick={onOpenDetail}
          disabled={!onOpenDetail}
          className="group flex shrink-0 items-center gap-3 rounded-2xl px-3 py-2 text-left transition enabled:hover:brightness-95 disabled:cursor-default"
          style={{ background: badge.bg }}
        >
          <span className="text-[28px] font-extrabold leading-none tabular-nums" style={{ color: badge.text }}>
            {overall.toFixed(1)}
          </span>
          <span>
            <span className="block text-[9px] font-bold uppercase tracking-[0.18em]" style={{ color: badge.text }}>
              This review
            </span>
            <span className="mt-0.5 block text-[11px] font-semibold" style={{ color: badge.text }}>
              Grade {grade} · {saved ? "saved" : "not saved yet"}
            </span>
            {last ? (
              <span className="mt-1 block">
                <Delta current={overall} previous={last.overall} size="md" />
              </span>
            ) : null}
          </span>
          {onOpenDetail ? (
            <ChevronRight
              className="h-4 w-4 shrink-0 transition group-hover:translate-x-0.5"
              style={{ color: badge.text }}
            />
          ) : null}
        </button>

        {/* One tile per data quality component. */}
        <div className="flex min-w-0 flex-1 flex-wrap gap-2">
          {rows.map((row) => (
            <div
              key={row.key}
              className="min-w-[124px] flex-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                  {row.label}
                </span>
                <Delta current={row.current} previous={row.previous} />
              </div>
              <div className="mt-0.5 text-lg font-bold leading-none tabular-nums text-slate-900">
                {row.current.toFixed(1)}
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-slate-100">
                <div
                  className="h-1 rounded-full"
                  style={{
                    width: `${Math.max(0, Math.min(100, row.current))}%`,
                    background: row.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        {onOpenDetail ? (
          <button
            type="button"
            onClick={onOpenDetail}
            className="hidden shrink-0 items-center gap-1 self-center rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 lg:inline-flex"
          >
            {detailLabel}
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {/* The saved review, demoted onto its own labelled line. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-dashed border-slate-200 pt-2 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5 font-bold uppercase tracking-[0.14em] text-slate-400">
          <History className="h-3 w-3" />
          Last saved review
        </span>
        {last ? (
          <>
            <span>
              {formatDate(last.savedAt)} · Overall{" "}
              <strong className="font-bold tabular-nums text-slate-700">{last.overall.toFixed(1)}</strong>
            </span>
            {rows
              .filter((row) => row.previous !== null)
              .map((row) => (
                <span key={row.key} className="tabular-nums">
                  {row.label} <strong className="font-semibold text-slate-600">{row.previous!.toFixed(1)}</strong>
                </span>
              ))}
          </>
        ) : (
          <span className="italic">No earlier review saved for this geography.</span>
        )}
      </div>
    </div>
  );
}
