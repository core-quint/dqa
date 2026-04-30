import type { T8Web } from '../../lib/uwin/types';

// Re-export all shared HMIS tables
export {
  FlatTable,
  T2Table,
  T3Table,
  DropoutTable,
  CoAdminTable,
  SummaryTable,
} from '../dqa/DataTables';

// ============================================================
// T8: Avg Beneficiaries per Session < 10
// Header: Block | Facility | [Month: Sess Held / Beneficiaries / Avg] × N + All months
// ============================================================

export function T8Table({ web }: { web: T8Web }) {
  const { months, monthLabels, rows } = web;
  const rowList = Object.values(rows);
  if (!rowList.length) return <div className="p-3 text-sm text-muted-foreground">No data.</div>;

  const fmtAvg = (v: number | null) => (v !== null ? v.toFixed(1) : '');

  return (
    <table className="border-collapse text-xs" style={{ minWidth: 700 }}>
      <thead>
        <tr>
          <th rowSpan={2} className="border border-border px-2 py-1.5 bg-accent/60 font-bold">Block Name</th>
          <th rowSpan={2} className="border border-border px-2 py-1.5 bg-accent/60 font-bold">Facility Name</th>
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
        {rowList.map((row) => (
          <tr key={`${row.block}-${row.facility}`} className="hover:bg-accent/20">
            <td className="border border-border px-2 py-1">{row.block}</td>
            <td className="border border-border px-2 py-1">{row.facility}</td>
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
