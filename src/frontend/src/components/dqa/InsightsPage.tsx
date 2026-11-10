// DQA Insights - the reimagined analytics dashboard. This file only loads data
// (saved reviews, then their score grids in the background); everything on screen
// is in insights/InsightsView.
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { apiFetch } from "../../api";
import { loadBreakdowns } from "../../lib/breakdownStore";
import { geoKey, scoreFamilyOf, type ScoreFamily } from "../../lib/dashboard";
import type { SnapshotBreakdown } from "../../lib/snapshotBreakdown";
import { normalizePortal, type SnapshotRecord } from "../../lib/snapshots";
import { canUseHmis, canUsePcts } from "../../lib/pcts/access";
import type { AuthState } from "./LoginPage";
import { InsightsView } from "./insights/InsightsView";

export function InsightsPage({ auth }: { auth: AuthState }) {
  const [snapshots, setSnapshots] = useState<SnapshotRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [grids, setGrids] = useState<Map<string, SnapshotBreakdown>>(() => new Map());
  const [gridsPending, setGridsPending] = useState(false);
  const [scope, setScope] = useState<{ family: ScoreFamily; stateKey: string } | null>(null);
  const hasHmis = canUseHmis(auth);
  const hasPcts = canUsePcts(auth);

  const fetchSnapshots = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data: SnapshotRecord[] = await apiFetch("/api/snapshots");
      setSnapshots(data);
    } catch {
      setError("Could not load the saved reviews. Check your connection and retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSnapshots();
  }, [fetchSnapshots]);

  const visible = useMemo(
    () =>
      (snapshots ?? []).filter((s) => {
        const portal = normalizePortal(s.portal);
        return (hasHmis || portal !== "HMIS") && (hasPcts || portal !== "PCTS");
      }),
    [snapshots, hasHmis, hasPcts],
  );

  // Score grids give month-by-month and block scores. They are fetched after the
  // page is on screen, only for the system (and state) being looked at.
  useEffect(() => {
    if (!scope || visible.length === 0) return;
    const wanted = visible.filter(
      (s) =>
        s.kpiData?.hasBreakdown &&
        scoreFamilyOf(normalizePortal(s.portal)) === scope.family &&
        (!scope.stateKey || geoKey(s.state) === scope.stateKey),
    );
    if (wanted.length === 0) return;
    let cancelled = false;
    setGridsPending(true);
    loadBreakdowns(wanted)
      .then((loaded) => {
        if (cancelled) return;
        setGrids((held) => ([...loaded.keys()].every((id) => held.has(id)) ? held : new Map([...held, ...loaded])));
      })
      .catch((err) => console.error("Score grids failed to load:", err))
      .finally(() => {
        if (!cancelled) setGridsPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scope, visible]);

  const onScopeChange = useCallback((next: { family: ScoreFamily; stateKey: string }) => {
    setScope((held) => (held && held.family === next.family && held.stateKey === next.stateKey ? held : next));
  }, []);

  if (snapshots === null) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-slate-600">
        {error ? (
          <>
            <AlertTriangle className="h-6 w-6 text-[#b3292e]" />
            <p className="text-sm">{error}</p>
            <button type="button" onClick={fetchSnapshots} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
              Retry
            </button>
          </>
        ) : (
          <>
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">Loading saved reviews…</p>
          </>
        )}
      </div>
    );
  }

  return (
    <InsightsView
      snapshots={visible}
      grids={grids}
      gridsPending={gridsPending}
      accessLevel={auth.role === "admin" ? "NATIONAL" : auth.level}
      onRefresh={fetchSnapshots}
      refreshing={loading}
      onScopeChange={onScopeChange}
    />
  );
}
