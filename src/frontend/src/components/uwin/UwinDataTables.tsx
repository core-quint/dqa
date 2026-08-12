import type { T8Web } from '../../lib/uwin/types';

// Re-export all shared HMIS tables. The co-admin table used to be duplicated
// here so U-WIN could carry a fixed highlight rule while HMIS kept the old one —
// that divergence is gone: the rule now lives in lib/dqa/coadmin.ts and both
// portals render the same shared component (which handles District and Session
// Site columns).
export {
  FlatTable,
  T2Table,
  T3Table,
  DropoutTable,
  CoAdminTable,
  SummaryTable,
  totalValueCols,
} from '../dqa/DataTables';

// ============================================================
// T8: Avg Beneficiaries per Session < 5
// Header: Block | Facility | [Session Site] | [Month: Sess Held / Beneficiaries / Avg] × N + All months
// ============================================================

export function T8Table({ web }: { web: T8Web }) {
  const { months, monthLabels, rows } = web;
  const rowList = Object.values(rows);
  if (!rowList.length) return <div className="p-3 text-sm text-muted-foreground">No data.</div>;
  const showDistrict = rowList.some((row) => Boolean(row.district));
  const showSubCenter = rowList[0]?.subcenter !== undefined;
  const showSessionSite = rowList[0]?.sessionsite !== undefined;

  const fmtAvg = (v: number | null) => (v !== null ? v.toFixed(1) : '');

  return (
    <table className="border-collapse text-xs" style={{ minWidth: 700 }}>
      <thead>
        <tr>
          {showDistrict ? <th rowSpan={2} className="border border-border px-2 py-1.5 bg-accent/60 font-bold">District</th> : null}
          <th rowSpan={2} className="border border-border px-2 py-1.5 bg-accent/60 font-bold">Block Name</th>
          <th rowSpan={2} className="border border-border px-2 py-1.5 bg-accent/60 font-bold">Facility Name</th>
          {showSubCenter ? (
            <th rowSpan={2} className="border border-border px-2 py-1.5 bg-accent/60 font-bold">Sub Center Name</th>
          ) : null}
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
            {showSubCenter ? <td className="border border-border px-2 py-1">{row.subcenter}</td> : null}
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
