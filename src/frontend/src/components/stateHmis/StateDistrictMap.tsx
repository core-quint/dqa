import { useEffect, useMemo, useState } from "react";
import { combineBounds, padBounds, topologyToFeatures, type Topology } from "../../lib/maps/topology";

interface DistrictProps { state_name: string; district_name: string; }
interface Props {
  stateName: string;
  counts: Record<string, number>;
  districts: string[];
  unitSingular?: string;
  unitPlural?: string;
}

const normalize = (value: string) => value.toLowerCase().replace(/charkhi/g, "charki").replace(/[^a-z0-9]/g, "");
const color = (count: number, max: number) => count === 0 ? "#dbeafe" : count / Math.max(1, max) > .66 ? "#dc2626" : count / Math.max(1, max) > .33 ? "#f97316" : "#facc15";

export function StateDistrictMap({ stateName, counts, districts, unitSingular = "month", unitPlural = "months" }: Props) {
  const [topology, setTopology] = useState<Topology<DistrictProps> | null>(null);
  useEffect(() => { fetch(new URL("../../../assets/districts.json", import.meta.url).href).then((response) => response.json()).then(setTopology).catch(() => setTopology(null)); }, []);
  const features = useMemo(() => topology ? topologyToFeatures(topology, "districts").filter((feature) => normalize(feature.properties.state_name) === normalize(stateName)) : [], [topology, stateName]);
  const bounds = padBounds(combineBounds(features), .05); const [x0, y0, x1, y1] = bounds; const width = Math.max(1, x1 - x0); const height = Math.max(1, y1 - y0);
  const max = Math.max(1, ...Object.values(counts));
  if (!topology) return <div className="p-8 text-center text-sm text-slate-500">Loading district boundaries…</div>;
  if (!features.length) return <div className="p-4 text-sm text-amber-700">No district boundaries found for {stateName}.</div>;
  return <div className="space-y-3"><svg viewBox={`${x0} ${y0} ${width} ${height}`} className="h-[430px] w-full rounded-2xl bg-slate-100">
    {features.map((feature) => { const dataName = districts.find((district) => normalize(district) === normalize(feature.properties.district_name)); const count = dataName ? counts[dataName] ?? 0 : 0; return <path key={feature.id} d={feature.path} fill={dataName ? color(count, max) : "#e5e7eb"} stroke="#fff" strokeWidth="1" vectorEffect="non-scaling-stroke"><title>{feature.properties.district_name}: {dataName ? `${count} flagged ${count === 1 ? unitSingular : unitPlural}` : "not in upload"}</title></path>; })}
  </svg><div className="flex flex-wrap gap-4 text-xs text-slate-600"><span>■ <i className="text-blue-200">No flags</i></span><span className="text-yellow-500">■ Low</span><span className="text-orange-500">■ Medium</span><span className="text-red-600">■ High</span><span className="text-slate-300">■ Not in upload</span></div></div>;
}
