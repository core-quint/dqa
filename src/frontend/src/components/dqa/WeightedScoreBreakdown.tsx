import { Fragment } from "react";
import { GROUP_COLORS } from "../../lib/dqa/constants";
import {
  weightModeLabel,
  type WeightedScoreResult,
} from "../../lib/dqa/weightedScoring";
import { GlassPanel } from "../branding/GlassPanel";

const pct = (value: number) => `${value.toFixed(2)}%`;
const num = (value: number | null, digits = 1) => (value === null ? "—" : value.toFixed(digits));

/**
 * Check-by-check working of the score (scoring method v8): each check's weight in
 * the table, the weight actually used after checks that cannot run passed theirs
 * on, the units flagged, the check score and its points in the overall.
 */
export function WeightedScoreBreakdown({
  result,
  groups,
  unitLabel,
}: {
  result: WeightedScoreResult;
  /** Components in display order. */
  groups: string[];
  /** Plural, lower case: "facilities", "districts", ... */
  unitLabel: string;
}) {
  return (
    <GlassPanel className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200/70 px-5 py-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Score working
          </div>
          <div className="mt-1 text-lg font-bold text-slate-950">
            How the score is built
          </div>
          <div className="mt-1 text-sm text-slate-600">
            {weightModeLabel(result.mode)} · {result.periodCount} period{result.periodCount === 1 ? "" : "s"} selected ·
            {" "}denominator {result.denominator} {unitLabel} in scope
          </div>
        </div>
        <div className="rounded-2xl bg-slate-100 px-4 py-2 text-right">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Overall</div>
          <div className="text-2xl font-extrabold tabular-nums text-slate-950">
            {result.overall === null ? "No data" : result.overall.toFixed(1)}
          </div>
        </div>
      </div>

      <div className="max-h-[36rem] overflow-auto thin-scroll">
        <table className="w-full min-w-[920px] text-xs">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr className="text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              <th className="px-3 py-2">Check</th>
              <th className="px-3 py-2">Group</th>
              <th className="px-3 py-2 text-right">Weight (table)</th>
              <th className="px-3 py-2 text-right">Weight used</th>
              <th className="px-3 py-2 text-right">{unitLabel} flagged</th>
              <th className="px-3 py-2 text-right">% of {unitLabel}</th>
              <th className="px-3 py-2 text-right">Check score</th>
              <th className="px-3 py-2 text-right">Points</th>
            </tr>
          </thead>
          <tbody className="bg-white">
            {groups.map((group) => {
              const component = result.components[group];
              if (!component) return null;
              const checks = result.checks.filter((check) => check.component === group);
              const color = GROUP_COLORS[group] ?? "#475569";
              return (
                <Fragment key={group}>
                  <tr className="border-t border-slate-200" style={{ background: `${color}14` }}>
                    <td className="px-3 py-2 font-bold" style={{ color }} colSpan={2}>
                      {component.name}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-700">{pct(component.baseWeight)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-700">{pct(component.effectiveWeight)}</td>
                    <td className="px-3 py-2 text-right text-slate-500" colSpan={2}>
                      {component.baseWeight === 0
                        ? "No weight with one period selected"
                        : component.score === null
                          ? "No check in this component could run"
                          : "Component score"}
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-slate-900">{num(component.score)}</td>
                    <td className="px-3 py-2 text-right font-bold text-slate-900">{num(component.points, 2)}</td>
                  </tr>
                  {checks.map((check) => (
                    <tr
                      key={check.id}
                      className={`border-t border-slate-100 ${check.canRun ? "" : "bg-slate-50 text-slate-400"}`}
                    >
                      <td className="px-3 py-1.5 pl-6 text-slate-700">{check.name}</td>
                      <td className="px-3 py-1.5 text-slate-500">{check.group}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{pct(check.baseWeight)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {check.canRun ? pct(check.effectiveWeight) : "0.00%"}
                      </td>
                      {check.canRun ? (
                        <>
                          <td className="px-3 py-1.5 text-right tabular-nums">{check.flagged ?? 0}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{num(check.pct)}%</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{num(check.score)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{num(check.points, 2)}</td>
                        </>
                      ) : (
                        <td className="px-3 py-1.5 text-right italic" colSpan={4}>
                          Can't run on this selection — weight passed on
                        </td>
                      )}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t border-slate-200/70 px-5 py-3 text-xs leading-6 text-slate-600">
        Check score = 100 − % of all {unitLabel} in scope that the check flagged; a check that flags no one
        scores 100. A check that can't run passes its weight to the other checks in its group, then to
        the other groups in its component, then to the other components, in proportion to their weights.
        Overall = sum of points.
      </div>
    </GlassPanel>
  );
}
