import type { CoAdminWeb } from '../../lib/dqa/types';
import type { T8Web } from '../../lib/uwin/types';

// Re-export all shared HMIS tables
export {
  FlatTable,
  T2Table,
  T3Table,
  DropoutTable,
  SummaryTable,
} from '../dqa/DataTables';

// ============================================================
// Co-admin cell-highlight rule (U-WIN only)
// A facility/session-site-month is flagged whenever the present values disagree
// AT ALL — not just when a value is uniquely different among the group. This
// matters for a "3-2 split" (3 vaccines share one value, 2 share another): the
// shared dqa/DataTables.tsx CoAdminTable only highlights values that are unique
// (count === 1), so a 3-2 split renders with zero highlighted cells even though
// the row is correctly flagged as a violation. Mirrors the PHP reference's
// coadmin_red_cells(): Penta's value (if present) is treated as the reference —
// every other cell that differs from it is colored, Penta itself never colored;
// otherwise cells differing from the majority value are colored (or all cells on
// a tie / no majority).
// ============================================================

export function coadminRedCells(valsByVx: Record<string, number | null>): Set<string> {
  const red = new Set<string>();
  const present = Object.entries(valsByVx).filter((e): e is [string, number] => e[1] !== null);
  if (present.length < 2) return red;

  const counts = new Map<number, number>();
  for (const [, v] of present) counts.set(v, (counts.get(v) ?? 0) + 1);
  if (counts.size <= 1) return red; // all equal — no violation, no coloring

  const pentaEntry = present.find(([vx]) => vx.toLowerCase().startsWith('penta'));
  if (pentaEntry) {
    const pentaVal = pentaEntry[1];
    for (const [vx, v] of present) {
      if (vx.toLowerCase().startsWith('penta')) continue; // never color Penta cells
      if (v !== pentaVal) red.add(vx);
    }
    return red;
  }

  let modeVal: number | null = null;
  let modeCount = -1;
  let tie = false;
  for (const [val, c] of counts) {
    if (c > modeCount) { modeCount = c; modeVal = val; tie = false; }
    else if (c === modeCount) { tie = true; }
  }
  if (tie || modeCount <= 1) {
    for (const [vx] of present) red.add(vx);
    return red;
  }
  for (const [vx, v] of present) { if (v !== modeVal) red.add(vx); }
  return red;
}

export function CoAdminTable({ web }: { web: CoAdminWeb }) {
  const { vaccines, months, monthLabels, rows } = web;
  const rowList = Object.values(rows);
  if (!rowList.length) return <div className="p-3 text-sm text-muted-foreground">No data.</div>;
  const showDistrict = rowList.some((row) => Boolean(row.district));
  const showSessionSite = rowList[0]?.sessionsite !== undefined;

  return (
    <table className="border-collapse text-xs" style={{ minWidth: 600 }}>
      <thead>
        <tr>
          {showDistrict ? <th rowSpan={2} className="border border-border px-2 py-1.5 bg-accent/60 font-bold">District</th> : null}
          <th rowSpan={2} className="border border-border px-2 py-1.5 bg-accent/60 font-bold">Block Name</th>
          <th rowSpan={2} className="border border-border px-2 py-1.5 bg-accent/60 font-bold">Facility Name</th>
          {showSessionSite ? (
            <th rowSpan={2} className="border border-border px-2 py-1.5 bg-accent/60 font-bold">Session Site Name</th>
          ) : null}
          {months.map((mk) => (
            <th key={mk} colSpan={vaccines.length} className="border border-border px-2 py-1.5 bg-green-50 font-bold text-center">
              {monthLabels[mk] ?? mk}
            </th>
          ))}
          <th colSpan={vaccines.length} className="border border-border px-2 py-1.5 bg-green-100 font-bold text-center">All months</th>
        </tr>
        <tr>
          {months.map((mk) =>
            vaccines.map((vx) => (
              <th key={`${mk}-${vx}`} className="border border-border px-2 py-1 bg-slate-50 font-semibold text-center">{vx}</th>
            ))
          )}
          {vaccines.map((vx) => (
            <th key={`all-${vx}`} className="border border-border px-2 py-1 bg-slate-50 font-semibold text-center">{vx}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rowList.map((row, rowIdx) => {
          const totalsRed = coadminRedCells(
            Object.fromEntries(vaccines.map((v) => [v, row.totals[v] ?? null]))
          );
          return (
            <tr key={rowIdx} className="hover:bg-accent/20">
              {showDistrict ? <td className="border border-border px-2 py-1">{row.district}</td> : null}
              <td className="border border-border px-2 py-1">{row.block}</td>
              <td className="border border-border px-2 py-1">{row.facility}</td>
              {showSessionSite ? <td className="border border-border px-2 py-1">{row.sessionsite}</td> : null}
              {months.map((mk) => {
                const redMonth = coadminRedCells(row.vals[mk] ?? {});
                return vaccines.map((vx) => {
                  const v = row.vals[mk]?.[vx] ?? null;
                  const isPink = v !== null && redMonth.has(vx);
                  return (
                    <td
                      key={`${mk}-${vx}`}
                      className={`border border-border px-2 py-1 text-center ${isPink ? 'pink-cell' : ''}`}
                    >
                      {v !== null ? Math.round(v) : ''}
                    </td>
                  );
                });
              })}
              {vaccines.map((vx) => {
                const tv = row.totals[vx] ?? null;
                const isPink = tv !== null && totalsRed.has(vx);
                return (
                  <td
                    key={`all-${vx}`}
                    className={`border border-border px-2 py-1 text-center ${isPink ? 'pink-cell' : ''}`}
                  >
                    {tv !== null ? Math.round(tv) : ''}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ============================================================
// T8: Avg Beneficiaries per Session < 5
// Header: Block | Facility | [Session Site] | [Month: Sess Held / Beneficiaries / Avg] × N + All months
// ============================================================

export function T8Table({ web }: { web: T8Web }) {
  const { months, monthLabels, rows } = web;
  const rowList = Object.values(rows);
  if (!rowList.length) return <div className="p-3 text-sm text-muted-foreground">No data.</div>;
  const showDistrict = rowList.some((row) => Boolean(row.district));
  const showSessionSite = rowList[0]?.sessionsite !== undefined;

  const fmtAvg = (v: number | null) => (v !== null ? v.toFixed(1) : '');

  return (
    <table className="border-collapse text-xs" style={{ minWidth: 700 }}>
      <thead>
        <tr>
          {showDistrict ? <th rowSpan={2} className="border border-border px-2 py-1.5 bg-accent/60 font-bold">District</th> : null}
          <th rowSpan={2} className="border border-border px-2 py-1.5 bg-accent/60 font-bold">Block Name</th>
          <th rowSpan={2} className="border border-border px-2 py-1.5 bg-accent/60 font-bold">Facility Name</th>
          {showSessionSite ? (
            <th rowSpan={2} className="border border-border px-2 py-1.5 bg-accent/60 font-bold">Session Site Name</th>
          ) : null}
          {months.map((mk) => (
            <th key={mk} colSpan={3} className="border border-border px-2 py-1.5 bg-orange-50 font-bold text-center">
              {monthLabels[mk] ?? mk}
            </th>
          ))}
          <th colSpan={3} className="border border-border px-2 py-1.5 bg-orange-100 font-bold text-center">All months</th>
        </tr>
        <tr>
          {months.map((mk) => (
            <>
              <th key={`${mk}-sh`} className="border border-border px-2 py-1 bg-slate-50 font-semibold text-center">Sess Held</th>
              <th key={`${mk}-bn`} className="border border-border px-2 py-1 bg-slate-50 font-semibold text-center">Benefic.</th>
              <th key={`${mk}-av`} className="border border-border px-2 py-1 bg-slate-50 font-semibold text-center">Avg</th>
            </>
          ))}
          <th className="border border-border px-2 py-1 bg-slate-50 font-semibold text-center">Sess Held</th>
          <th className="border border-border px-2 py-1 bg-slate-50 font-semibold text-center">Benefic.</th>
          <th className="border border-border px-2 py-1 bg-slate-50 font-semibold text-center">Avg</th>
        </tr>
      </thead>
      <tbody>
        {rowList.map((row, rowIdx) => (
          <tr key={rowIdx} className="hover:bg-accent/20">
            {showDistrict ? <td className="border border-border px-2 py-1">{row.district}</td> : null}
            <td className="border border-border px-2 py-1">{row.block}</td>
            <td className="border border-border px-2 py-1">{row.facility}</td>
            {showSessionSite ? <td className="border border-border px-2 py-1">{row.sessionsite}</td> : null}
            {months.map((mk) => {
              const d = row.months[mk];
              const flagCls = d?.flag ? 'pink-cell' : '';
              return (
                <>
                  <td key={`${mk}-sh`} className={`border border-border px-2 py-1 text-center ${flagCls}`}>
                    {d?.sessHeld !== null && d?.sessHeld !== undefined ? d.sessHeld : ''}
                  </td>
                  <td key={`${mk}-bn`} className={`border border-border px-2 py-1 text-center ${flagCls}`}>
                    {d?.beneficiaries !== null && d?.beneficiaries !== undefined ? d.beneficiaries : ''}
                  </td>
                  <td key={`${mk}-av`} className={`border border-border px-2 py-1 text-center font-semibold ${flagCls}`}>
                    {fmtAvg(d?.avg ?? null)}
                  </td>
                </>
              );
            })}
            {/* All months summary */}
            {(() => {
              const a = row.allMonths;
              const flagCls = a.flag ? 'pink-cell' : '';
              return (
                <>
                  <td className={`border border-border px-2 py-1 text-center ${flagCls}`}>
                    {a.sessHeld !== null ? a.sessHeld : ''}
                  </td>
                  <td className={`border border-border px-2 py-1 text-center ${flagCls}`}>
                    {a.beneficiaries !== null ? a.beneficiaries : ''}
                  </td>
                  <td className={`border border-border px-2 py-1 text-center font-semibold ${flagCls}`}>
                    {fmtAvg(a.avg)}
                  </td>
                </>
              );
            })()}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
