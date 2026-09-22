import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronRight, Info, Minus } from "lucide-react";
import { scoreBadgeStyle, scoreGrade } from "../../lib/dqa/scoreUtils";
import { periodRangeLabel, type ReviewBaseline } from "../../lib/snapshots";

export interface ScoreStripRow {
  key: string;
  label: string;
  /** The component's own colour, as the tabs use it. */
  color: string;
  /** null = N/A: none of this component's checks could be run on this selection. */
  current: number | null;
}

interface Props {
  /** null = nothing could be scored (for example, the filters leave no units). */
  overall: number | null;
  rows: ScoreStripRow[];
  /** e.g. "Based on 3 of 4 components" when a component is N/A. */
  coverageNote?: string | null;
  /** The reviewer changed analysis settings; the score still uses the standard ones. */
  customSettings?: boolean;
  /** Earlier reviews saved under the previous scoring method (not compared). */
  legacyReviewCount?: number;
  /** Past reviews to measure against, preferred first; empty when none exist. */
  baselines: ReviewBaseline[];
  /** Whether this review has been saved in this session. */
  saved?: boolean;
  /** Opens the full breakdown — a dialog on some portals, the Overall tab on others. */
  onOpenDetail?: () => void;
  detailLabel?: string;
}

/** Deltas below this are noise from a re-filter, not a real movement. */
const DELTA_EPSILON = 0.05;

const BASELINE_TITLE: Record<ReviewBaseline["kind"], string> = {
  samePeriod: "Same period",
  latest: "Latest DQA",
  both: "Latest DQA · same period",
};

const BASELINE_HINT: Record<ReviewBaseline["kind"], string> = {
  samePeriod: "The last review of these same months — a like-for-like comparison.",
  latest: "The most recent review of this geography, covering different months.",
  both: "The most recent review of this geography, and it covers these same months.",
};

const SCORE_KEY: Record<string, keyof ReviewBaseline> = {
  availability: "availabilityScore",
  completeness: "completenessScore",
  accuracy: "accuracyScore",
  consistency: "consistencyScore",
};

/** One component's score in a past review, or null when it was never recorded. */
export function baselineComponentScore(
  baseline: ReviewBaseline | null,
  group: string,
): number | null {
  if (!baseline) return null;
  const key = SCORE_KEY[group];
  if (!key) return null;
  const value = baseline[key];
  return typeof value === "number" ? value : null;
}

function formatDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function baselinePeriodLabel(baseline: ReviewBaseline): string {
  return baseline.period
    ? periodRangeLabel(baseline.period.start, baseline.period.end)
    : "period not recorded";
}

/**
 * Movement against the chosen baseline. A higher score is better, so a rise is
 * the good direction — coloured accordingly, and flat when nothing really moved.
 */
function Delta({
  current,
  previous,
  size = "sm",
}: {
  current: number | null;
  previous: number | null;
  size?: "sm" | "md";
}) {
  if (previous === null || current === null) return null;
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
    >
      <Icon className={size === "md" ? "h-3 w-3" : "h-2.5 w-2.5"} />
      {flat ? "0.0" : `${diff > 0 ? "+" : ""}${diff.toFixed(1)}`}
    </span>
  );
}

/**
 * The score of the review on screen, and what it is being measured against.
 *
 * The saved scores used to sit in the page header's context line, where they read
 * as the current ones. Here the current overall is the only large number, and the
 * past review lives inside the same card as a baseline the reader picks — so the
 * two can never be confused, and the comparison is always an explicit choice.
 *
 * When an earlier review covered the same months as this upload, that one is
 * offered alongside the merely-most-recent one and selected by default: comparing
 * Jan–Apr against Jan–Apr says something, comparing it against Jun–Aug does not.
 */
export function ScoreStrip({
  overall,
  rows,
  coverageNote = null,
  customSettings = false,
  legacyReviewCount = 0,
  baselines,
  saved = false,
  onOpenDetail,
  detailLabel = "Breakdown",
}: Props) {
  const [activeId, setActiveId] = useState<string | null>(baselines[0]?.id ?? null);

  // Saving a review, or switching geography, changes what there is to compare against.
  useEffect(() => {
    setActiveId((current) =>
      current && baselines.some((baseline) => baseline.id === current)
        ? current
        : (baselines[0]?.id ?? null),
    );
  }, [baselines]);

  const active = baselines.find((baseline) => baseline.id === activeId) ?? null;
  const badge = scoreBadgeStyle(overall);
  const grade = scoreGrade(overall);

  return (
    <div className="rounded-[20px] border border-slate-200 bg-white p-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-stretch gap-2">
        {/* Current score, with the comparison folded into the same card. */}
        <div
          className="flex w-full shrink-0 flex-col gap-2 rounded-2xl px-3 py-2.5 sm:w-[320px]"
          style={{ background: badge.bg }}
        >
          <button
            type="button"
            onClick={onOpenDetail}
            disabled={!onOpenDetail}
            className="group flex items-center gap-3 text-left transition enabled:hover:opacity-90 disabled:cursor-default"
          >
            <span
              className="text-[30px] font-extrabold leading-none tabular-nums"
              style={{ color: badge.text }}
            >
              {overall === null ? "No data" : overall.toFixed(1)}
            </span>
            <span className="min-w-0">
              <span
                className="block text-[9px] font-bold uppercase tracking-[0.18em]"
                style={{ color: badge.text }}
              >
                This review
              </span>
              <span className="mt-0.5 block text-[11px] font-semibold" style={{ color: badge.text }}>
                {overall === null
                  ? "Nothing in this selection can be scored"
                  : `Grade ${grade} · ${saved ? "saved" : "not saved yet"}`}
              </span>
              {coverageNote ? (
                <span className="mt-0.5 block text-[10px] font-semibold" style={{ color: badge.text }}>
                  {coverageNote}
                </span>
              ) : null}
            </span>
            {onOpenDetail ? (
              <ChevronRight
                className="ml-auto h-4 w-4 shrink-0 transition group-hover:translate-x-0.5"
                style={{ color: badge.text }}
              />
            ) : null}
          </button>

          <div className="rounded-xl bg-white/70 px-2 py-1.5">
            <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-500">
              {baselines.length > 1 ? "Compared with" : "Compared with last saved"}
            </div>

            {baselines.length === 0 ? (
              <div className="mt-1 text-[11px] italic text-slate-500">
                No earlier review of this scope saved under the current scoring method.
              </div>
            ) : (
              <div className="mt-1 space-y-1">
                {baselines.map((baseline) => {
                  const isActive = baseline.id === activeId;
                  const selectable = baselines.length > 1;
                  return (
                    <button
                      key={baseline.id}
                      type="button"
                      onClick={selectable ? () => setActiveId(baseline.id) : undefined}
                      aria-pressed={selectable ? isActive : undefined}
                      title={BASELINE_HINT[baseline.kind]}
                      className={[
                        "flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left transition",
                        selectable ? "cursor-pointer hover:bg-white" : "cursor-default",
                        isActive && selectable ? "bg-white ring-1 ring-slate-300" : "",
                      ].join(" ")}
                    >
                      {selectable ? (
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            isActive ? "bg-slate-900" : "border border-slate-300"
                          }`}
                        />
                      ) : null}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-bold text-slate-700">
                          {BASELINE_TITLE[baseline.kind]}
                        </span>
                        <span className="block truncate text-[10px] text-slate-500">
                          {baselinePeriodLabel(baseline)} · saved {formatDate(baseline.createdAt)}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-[11px] font-bold tabular-nums text-slate-700">
                          {baseline.overall === null ? "N/A" : baseline.overall.toFixed(1)}
                        </span>
                        {isActive ? (
                          <Delta current={overall} previous={baseline.overall} />
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {legacyReviewCount > 0 ? (
              <div className="mt-1.5 text-[10px] leading-4 text-slate-500">
                {legacyReviewCount} earlier review{legacyReviewCount === 1 ? " was" : "s were"} scored with the previous
                method and {legacyReviewCount === 1 ? "is" : "are"} not compared.
              </div>
            ) : null}
          </div>
        </div>

        {/* One tile per data quality component, measured against the chosen baseline. */}
        <div className="flex min-w-0 flex-1 flex-wrap content-start gap-2">
          {rows.map((row) => (
            <div
              key={row.key}
              className="min-w-[124px] flex-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                  {row.label}
                </span>
                <Delta current={row.current} previous={baselineComponentScore(active, row.key)} />
              </div>
              <div
                className="mt-1 text-lg font-bold leading-none tabular-nums text-slate-900"
                title={row.current === null ? "None of this component's checks could be run on this selection." : undefined}
              >
                {row.current === null ? "N/A" : row.current.toFixed(1)}
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-slate-100">
                <div
                  className="h-1 rounded-full"
                  style={{
                    width: `${Math.max(0, Math.min(100, row.current ?? 0))}%`,
                    background: row.color,
                  }}
                />
              </div>
              {active ? (
                <div className="mt-1 text-[10px] tabular-nums text-slate-400">
                  was {baselineComponentScore(active, row.key)?.toFixed(1) ?? "—"}
                </div>
              ) : null}
            </div>
          ))}

          {onOpenDetail ? (
            <button
              type="button"
              onClick={onOpenDetail}
              className="hidden shrink-0 items-center gap-1 self-start rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 lg:inline-flex"
            >
              {detailLabel}
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      {customSettings ? (
        <div className="mt-2 flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-600">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
          <span>
            Scores use the standard scoring settings. Your changes to outlier, dropout or
            inconsistency settings only change the indicator tables below.
          </span>
        </div>
      ) : null}
    </div>
  );
}
