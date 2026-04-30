import type { TableRows, T2Web, T3Web, DropoutWeb, CoAdminWeb, SummaryRow } from '../../lib/dqa/types';

// ============================================================
// Generic flat table
// ============================================================

interface FlatTableProps {
  rows: TableRows;
  highlightN?: boolean;
}

export function FlatTable({ rows, highlightN }: FlatTableProps) {
  if (rows.length <= 1) {
    return <div className="p-3 text-sm text-muted-foreground">No data.</div>;
  }
  const head = rows[0];
  return (
    <table className="border-collapse w-full text-xs" style={{ minWidth: 600 }}>
      <thead>
        <tr>
          {head.map((h, i) => (
            <th
              key={`head-${i}-${String(h ?? '')}`}
              className="border border-border px-2 py-1.5 text-left font-bold bg-accent/60 whitespace-nowrap"
            >
              {String(h ?? '')}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.slice(1).map((row) => {
          const rowId = String(row[0] ?? '') + '-' + String(row[1] ?? '');
          return (
            <tr key={rowId} className="hover:bg-accent/20">
              {head.map((h) => {
                const ci = head.indexOf(h);
                const v = String(row[ci] ?? '');
                const isN = highlightN && v === 'N';
                return (
                  <td
                    key={`${rowId}-${String(h)}`}
                    className={`border border-border px-2 py-1 whitespace-nowrap ${isN ? 'n-cell' : ''}`}
                  >
                    {v}
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
// T2: Missing indicator two-level header
// ============================================================

export function T2Table({ web }: { web: T2Web }) {
  const { vaccines, months, monthLabels, rows } = web;
  const rowList = Object.values(rows);
  if (!rowList.length) return <div className="p-3 text-sm text-muted-foreground">No data.</div>;

  return (
    <table className="border-collapse text-xs" style={{ minWidth: 600 }}>
      <thead>
        <tr>
          <th rowSpan={2} className="border border-border px-2 py-1.5 bg-accent/60 font-bold">Block Name</th>
          <th rowSpan={2} className="border border-border px-2 py-1.5 bg-accent/60 font-bold">Facility Name</th>
          {vaccines.map((vx) => (
            <th
              key={vx}
              colSpan={months.length}
              className="border border-border px-2 py-1.5 bg-indigo-50 font-bold text-center"
            >
              {vx}
            </th>
          ))}
        </tr>
        <tr>
          {vaccines.map((vx) =>
            months.map((mk) => (
              <th key={`${vx}-${mk}`} className="border border-border px-2 py-1 bg-slate-50 font-semibold text-center">
                {monthLabels[mk] ?? mk}
              </th>
            ))
          )}
        </tr>
      </thead>
      <tbody>
        {rowList.map((row) => (
          <tr key={`${row.block}-${row.facility}`} className="hover:bg-accent/20">
            <td className="border border-border px-2 py-1">{row.block}</td>
            <td className="border border-border px-2 py-1">{row.facility}</td>
            {vaccines.map((vx) =>
              months.map((mk) => {
                const v = row.cells[vx]?.[mk] ?? '';
                return (
                  <td
                    key={`${vx}-${mk}`}
                    className={`border border-border px-2 py-1 text-center ${v === 'N' ? 'n-cell' : ''}`}
                  >
                    {v}
                  </td>
                );
              })
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ============================================================
// T3: Outliers two-level header
// ============================================================

export function T3Table({ web }: { web: T3Web }) {
  const { vaccines, pairs, rows } = web;
  const rowList = Object.values(rows);
  if (!rowList.length) return <div className="p-3 text-sm text-muted-foreground">No data.</div>;

  return (
    <table className="border-collapse text-xs" style={{ minWidth: 600 }}>
      <thead>
        <tr>
          <th rowSpan={2} className="border border-border px-2 py-1.5 bg-accent/60 font-bold">Block Name</th>
          <th rowSpan={2} className="border border-border px-2 py-1.5 bg-accent/60 font-bold">Facility Name</th>
          {vaccines.map((vx) => (
            <th
              key={vx}
              colSpan={pairs.length * 3}
              className="border border-border px-2 py-1.5 bg-orange-50 font-bold text-center"
            >
              {vx}
            </th>
          ))}
        </tr>
        <tr>
          {vaccines.map((vx) =>
            pairs.map((p) => (
              <>
                <th key={`${vx}-${p.k}-a`} className="border border-border px-2 py-1 bg-slate-50 font-semibold text-center">{p.m1lbl}</th>
                <th key={`${vx}-${p.k}-b`} className="border border-border px-2 py-1 bg-slate-50 font-semibold text-center">{p.m2lbl}</th>
                <th key={`${vx}-${p.k}-c`} className="border border-border px-2 py-1 bg-slate-50 font-semibold text-center">% Change</th>
              </>
            ))
          )}
        </tr>
      </thead>
      <tbody>
        {rowList.map((row) => (
          <tr key={`${row.block}-${row.facility}`} className="hover:bg-accent/20">
            <td className="border border-border px-2 py-1">{row.block}</td>
            <td className="border border-border px-2 py-1">{row.facility}</td>
            {vaccines.map((vx) =>
              pairs.map((p) => {
                const cell = row.cells[vx]?.[p.k];
                if (!cell?.hit) {
                  return (
                    <>
                      <td key={`${vx}-${p.k}-a`} className="border border-border px-2 py-1"></td>
                      <td key={`${vx}-${p.k}-b`} className="border border-border px-2 py-1"></td>
                      <td key={`${vx}-${p.k}-c`} className="border border-border px-2 py-1"></td>
                    </>
                  );
                }
                const pctStr = cell.pct !== null
                  ? `${cell.pct > 0 ? '+' : ''}${cell.pct.toFixed(1)}%`
                  : '';
                return (
                  <>
                    <td key={`${vx}-${p.k}-a`} className="border border-border px-2 py-1 text-center">
                      {cell.a !== null ? Math.round(cell.a) : ''}
                    </td>
                    <td key={`${vx}-${p.k}-b`} className="border border-border px-2 py-1 text-center">
                      {cell.b !== null ? Math.round(cell.b) : ''}
                    </td>
                    <td key={`${vx}-${p.k}-c`} className="border border-border px-2 py-1 text-center font-semibold">
                      {pctStr}
                    </td>
                  </>
                );
              })
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ============================================================
// Dropout pair table
// ============================================================

export function DropoutTable({ web }: { web: DropoutWeb }) {
  const { from, to, months, monthLabels, rows } = web;
  const rowList = Object.values(rows);
  if (!rowList.length) return <div className="p-3 text-sm text-muted-foreground">No data.</div>;

  return (
    <table className="border-collapse text-xs" style={{ minWidth: 600 }}>
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
              <th key={`${mk}-f`} className="border border-border px-2 py-1 bg-slate-50 font-semibold text-center">{from}</th>
              <th key={`${mk}-t`} className="border border-border px-2 py-1 bg-slate-50 font-semibold text-center">{to}</th>
              <th key={`${mk}-p`} className="border border-border px-2 py-1 bg-slate-50 font-semibold text-center">% change</th>
            </>
          ))}
          <th className="border border-border px-2 py-1 bg-slate-50 font-semibold text-center">{from}</th>
          <th className="border border-border px-2 py-1 bg-slate-50 font-semibold text-center">{to}</th>
          <th className="border border-border px-2 py-1 bg-slate-50 font-semibold text-center">% change</th>
        </tr>
      </thead>
      <tbody>
        {rowList.map((row) => (
          <tr key={`${row.block}-${row.facility}`} className="hover:bg-accent/20">
            <td className="border border-border px-2 py-1">{row.block}</td>
            <td className="border border-border px-2 py-1">{row.facility}</td>
            {months.map((mk) => {
              const c = row.cells[mk] ?? { from: null, to: null, pct: null };
              return (
                <>
                  <td key={`${mk}-f`} className="border border-border px-2 py-1 text-center">{c.from !== null ? Math.round(c.from) : ''}</td>
                  <td key={`${mk}-t`} className="border border-border px-2 py-1 text-center">{c.to !== null ? Math.round(c.to) : ''}</td>
                  <td key={`${mk}-p`} className="border border-border px-2 py-1 text-center">{c.pct !== null ? `${c.pct.toFixed(1)}%` : ''}</td>
                </>
              );
            })}
            <td className="border border-border px-2 py-1 text-center">{row.all.from !== null ? Math.round(row.all.from) : ''}</td>
            <td className="border border-border px-2 py-1 text-center">{row.all.to !== null ? Math.round(row.all.to) : ''}</td>
            <td className="border border-border px-2 py-1 text-center">{row.all.pct !== null ? `${row.all.pct.toFixed(1)}%` : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ============================================================
// Co-admin table
// ============================================================

export function CoAdminTable({ web }: { web: CoAdminWeb }) {
  const { vaccines, months, monthLabels, rows } = web;
  const rowList = Object.values(rows);
  if (!rowList.length) return <div className="p-3 text-sm text-muted-foreground">No data.</div>;

  function isUniqueVal(vals: Record<string, number | null>, vx: string): boolean {
    const allVals = Object.values(vals).filter((v) => v !== null) as number[];
    if (allVals.length < 2) return false;
    const counts: Record<string, number> = {};
    for (const v of allVals) counts[String(v)] = (counts[String(v)] ?? 0) + 1;
    const myVal = vals[vx];
    if (myVal === null) return false;
    return counts[String(myVal)] === 1;
  }

  return (
    <table className="border-collapse text-xs" style={{ minWidth: 600 }}>
      <thead>
        <tr>
          <th rowSpan={2} className="border border-border px-2 py-1.5 bg-accent/60 font-bold">Block Name</th>
          <th rowSpan={2} className="border border-border px-2 py-1.5 bg-accent/60 font-bold">Facility Name</th>
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
        {rowList.map((row) => (
          <tr key={`${row.block}-${row.facility}`} className="hover:bg-accent/20">
            <td className="border border-border px-2 py-1">{row.block}</td>
            <td className="border border-border px-2 py-1">{row.facility}</td>
            {months.map((mk) =>
              vaccines.map((vx) => {
                const v = row.vals[mk]?.[vx] ?? null;
                const isPink = isUniqueVal(row.vals[mk] ?? {}, vx);
                return (
                  <td
                    key={`${mk}-${vx}`}
                    className={`border border-border px-2 py-1 text-center ${isPink ? 'pink-cell' : ''}`}
                  >
                    {v !== null ? Math.round(v) : ''}
                  </td>
                );
              })
            )}
            {vaccines.map((vx) => {
              const tv = row.totals[vx] ?? null;
              const isPink = isUniqueVal(
                Object.fromEntries(vaccines.map((v) => [v, row.totals[v] ?? null])),
                vx
              );
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
        ))}
      </tbody>
    </table>
  );
}

// ============================================================
// Summary table
// ============================================================

interface SummaryTableProps {
  rows: SummaryRow[];
  label?: string;
}

export function SummaryTable({ rows, label }: SummaryTableProps) {
  if (!rows.length) return null;
  return (
    <div className="mb-4">
      {label && <div className="text-xs font-bold text-foreground mb-1">{label}</div>}
      <table className="border-collapse w-full text-xs">
        <thead>
          <tr>
            <th className="border border-border px-2 py-1.5 bg-accent/60 font-bold text-left">Indicator</th>
            <th className="border border-border px-2 py-1.5 bg-accent/60 font-bold text-right">Facilities</th>
            <th className="border border-border px-2 py-1.5 bg-accent/60 font-bold text-right">%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="hover:bg-accent/20">
              <td className="border border-border px-2 py-1">{r.name}</td>
              <td className="border border-border px-2 py-1 text-right font-mono">{r.count}</td>
              <td className="border border-border px-2 py-1 text-right font-mono">{r.pct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
