import { useEffect, useMemo, useState } from "react";
import {
  BarChart2,
  ChevronDown,
  Database,
  LogOut,
  MapPinned,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  TrendingUp,
  Upload,
} from "lucide-react";
import { useAppContext } from "../../context/AppContext";
import { computeKpis } from "../../lib/dqa/computeKpis";
import { computeUwinKpis } from "../../lib/uwin/computeKpis";
import { DEFAULT_FILTERS, UWIN_DEFAULT_FILTERS } from "../../lib/dqa/constants";
import { BrandMark } from "../branding/BrandMark";
import {
  getPortalData,
  getPortalForView,
  getPortalGroups,
} from "./shellConfig";
import { cn } from "@/lib/utils";

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

function uniqueIssueCount(
  cards: { group: string; stat: { facilityKeys: Set<string> } }[],
  group: string,
) {
  const facilities = new Set<string>();
  for (const card of cards) {
    if (card.group !== group) continue;
    for (const key of card.stat.facilityKeys) facilities.add(key);
  }
  return facilities.size;
}

const PORTAL_ACCENT: Record<string, string> = {
  HMIS: "#3b82f6",
  "U-WIN": "#8b5cf6",
};

export function Sidebar({ collapsed, onToggleCollapse }: SidebarProps) {
  const {
    auth,
    appState,
    setAppState,
    csvData,
    uwinData,
    trendSource,
    setTrendSource,
    activeGroup,
    setActiveGroup,
    uwinActiveGroup,
    setUwinActiveGroup,
    handleLogout,
  } = useAppContext();

  const [analysisOpen, setAnalysisOpen] = useState(true);

  const portal = getPortalForView(appState, trendSource, csvData, uwinData);
  const activeData =
    appState === "coverage" ? null : getPortalData(portal, csvData, uwinData);
  const groupItems = getPortalGroups(portal);
  const isAnalysis = appState === "results" || appState === "uwin-results";
  const currentGroup = portal === "U-WIN" ? uwinActiveGroup : activeGroup;

  useEffect(() => {
    if (isAnalysis) setAnalysisOpen(true);
  }, [isAnalysis]);

  const issueCounts = useMemo(() => {
    if (portal === "HMIS" && csvData) {
      const result = computeKpis(csvData, {
        ...DEFAULT_FILTERS,
        activeGroup: "availability",
      });
      return {
        availability: uniqueIssueCount(result.cards, "availability"),
        completeness: uniqueIssueCount(result.cards, "completeness"),
        accuracy: uniqueIssueCount(result.cards, "accuracy"),
        consistency: uniqueIssueCount(result.cards, "consistency"),
      };
    }
    if (portal === "U-WIN" && uwinData) {
      const result = computeUwinKpis(uwinData, {
        ...UWIN_DEFAULT_FILTERS,
        activeGroup: "availability",
      });
      return {
        availability: uniqueIssueCount(result.cards, "availability"),
        accuracy: uniqueIssueCount(result.cards, "accuracy"),
        consistency: uniqueIssueCount(result.cards, "consistency"),
      };
    }
    return {};
  }, [csvData, portal, uwinData]);

  const currentScope =
    auth && auth.level !== "NATIONAL" && auth.role !== "admin"
      ? [auth.level, auth.geoState, auth.geoDistrict].filter(Boolean).join(" / ")
      : "National";

  const accent = portal ? (PORTAL_ACCENT[portal] ?? "#64748b") : "#64748b";

  const navItems = [
    {
      key: "upload",
      label: "Upload Data",
      icon: Upload,
      active: appState === "landing" || appState === "uwin-landing",
      disabled: false,
      hasChildren: false,
      onClick: () => {
        if (portal === "U-WIN") { setAppState("uwin-landing"); return; }
        if (portal === "HMIS") { setAppState("landing"); return; }
        setAppState("portal");
      },
    },
    {
      key: "analysis",
      label: "Analysis",
      icon: BarChart2,
      active: isAnalysis,
      disabled: !activeData,
      hasChildren: true,
      onClick: () => {
        if (!activeData) return;
        setAnalysisOpen((v) => !v);
        setAppState(portal === "U-WIN" ? "uwin-results" : "results");
      },
    },
    {
      key: "trend",
      label: "Trends",
      icon: TrendingUp,
      active: appState === "trend",
      disabled: false,
      hasChildren: false,
      onClick: () => {
        if (portal) setTrendSource(portal === "U-WIN" ? "UWIN" : "HMIS");
        else setTrendSource("ALL");
        setAppState("trend");
      },
    },
    {
      key: "coverage",
      label: "DQA Coverage",
      icon: MapPinned,
      active: appState === "coverage",
      disabled: false,
      hasChildren: false,
      onClick: () => setAppState("coverage"),
    },
  ];

  function openGroup(group: (typeof groupItems)[number]) {
    if (portal === "U-WIN") { setUwinActiveGroup(group.id); setAppState("uwin-results"); return; }
    setActiveGroup(group.id);
    setAppState("results");
  }

  return (
    <aside
      className={cn(
        "w-full md:shrink-0 transition-all duration-200",
        collapsed ? "md:w-[72px]" : "md:w-[252px]",
      )}
    >
      <div
        className="flex h-full min-h-[220px] flex-col overflow-hidden rounded-[26px] border bg-[#07111d] md:min-h-[calc(100vh-2rem)]"
        style={{ borderColor: accent + "28" }}
      >
        {/* Portal accent top bar */}
        <div
          className="h-0.5 w-full flex-shrink-0 rounded-t-[26px]"
          style={{ background: `linear-gradient(90deg, ${accent}cc 0%, ${accent}22 70%, transparent 100%)` }}
        />

        {/* ── Header ──────────────────────────────── */}
        <div className={cn("flex-shrink-0 p-3", collapsed && "px-2")}>
          <div className={cn("flex items-center gap-2", collapsed && "justify-center")}>
            <BrandMark
              size="sm"
              tone="dark"
              showText={!collapsed}
              title="DQA Review"
              subtitle=""
              caption={
                appState === "coverage"
                  ? "Coverage"
                  : portal
                  ? portal
                  : "Select module"
              }
            />
            <button
              type="button"
              onClick={onToggleCollapse}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-800/80 text-slate-300 transition hover:bg-slate-700 hover:text-white"
              title={collapsed ? "Expand sidebar" : "Collapse (Ctrl+B)"}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-3.5 w-3.5" />
              ) : (
                <PanelLeftClose className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          {/* Context strip — expanded only */}
          {!collapsed && (
            <div className="mt-3 space-y-2">
              {/* Portal + scope badges */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em]"
                  style={{
                    background: accent + "1e",
                    border: `1px solid ${accent}44`,
                    color: accent,
                  }}
                >
                  {appState === "coverage" ? "Coverage" : portal ?? "No module"}
                </span>
                <span className="inline-flex items-center rounded-full border border-slate-700/80 bg-slate-800/60 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                  {currentScope}
                </span>
              </div>

              {/* Dataset context */}
              {activeData ? (
                <div
                  className="flex items-start gap-2 rounded-xl px-2.5 py-2"
                  style={{ background: accent + "0e", border: `1px solid ${accent}22` }}
                >
                  <Database
                    className="mt-0.5 h-3 w-3 shrink-0"
                    style={{ color: accent + "cc" }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-white">
                      {activeData.stateName || "—"} / {activeData.distName || "—"}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-slate-500">
                      {activeData.fileName}
                    </div>
                  </div>
                  <span
                    className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em]"
                    style={{ background: accent + "2a", color: accent }}
                  >
                    Ready
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 px-2.5 py-2">
                  <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                  <span className="text-[10px] font-semibold text-slate-500">
                    Awaiting file upload
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Divider ─────────────────────────────── */}
        <div
          className="mx-3 flex-shrink-0 border-t"
          style={{ borderColor: accent + "18" }}
        />

        {/* ── Navigation ──────────────────────────── */}
        <nav
          className={cn(
            "flex-1 overflow-y-auto thin-scroll py-2",
            collapsed ? "px-1.5" : "px-2",
          )}
        >
          {!collapsed && (
            <div className="px-2 pb-2 pt-0.5 text-[9px] font-bold uppercase tracking-[0.28em] text-slate-600">
              Navigation
            </div>
          )}

          <div className="space-y-0.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.key}>
                  <button
                    type="button"
                    onClick={item.disabled ? undefined : item.onClick}
                    disabled={item.disabled}
                    className={cn(
                      "group flex w-full items-center rounded-xl text-sm font-semibold transition-all duration-150",
                      collapsed ? "justify-center p-2" : "gap-2.5 px-2.5 py-2.5",
                      item.active
                        ? "bg-white text-slate-950 shadow-[0_4px_20px_rgba(255,255,255,0.07)]"
                        : "text-slate-400 hover:bg-slate-800/80 hover:text-white",
                      item.disabled && "cursor-not-allowed opacity-40",
                    )}
                    title={collapsed ? item.label : undefined}
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                        item.active
                          ? "bg-slate-900 text-white"
                          : "bg-slate-800/80 text-slate-400 group-hover:bg-slate-700 group-hover:text-white",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    {!collapsed && (
                      <>
                        <span className="flex-1 text-left leading-tight">
                          {item.label}
                        </span>
                        {item.hasChildren && (
                          <ChevronDown
                            className={cn(
                              "h-3.5 w-3.5 text-slate-500 transition-transform duration-200",
                              analysisOpen && "rotate-180",
                            )}
                          />
                        )}
                      </>
                    )}
                  </button>

                  {/* Analysis sub-items */}
                  {item.key === "analysis" &&
                    analysisOpen &&
                    !collapsed &&
                    activeData &&
                    portal && (
                      <div className="ml-4 mt-0.5 space-y-0.5 border-l border-slate-800 pb-1 pl-3">
                        {groupItems.map((group) => {
                          const count =
                            issueCounts[
                              group.id as keyof typeof issueCounts
                            ] ?? 0;
                          const isCurrent =
                            currentGroup === group.id && isAnalysis;
                          return (
                            <button
                              key={group.id}
                              type="button"
                              onClick={() => openGroup(group)}
                              className={cn(
                                "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all",
                                isCurrent
                                  ? "bg-slate-800 text-white"
                                  : "text-slate-400 hover:bg-slate-800/70 hover:text-white",
                              )}
                            >
                              <span
                                className="h-1.5 w-1.5 shrink-0 rounded-full"
                                style={{ background: group.color }}
                              />
                              <span className="flex-1 text-left">
                                {group.label}
                              </span>
                              <span
                                className="inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
                                style={{
                                  background:
                                    count > 0
                                      ? group.color + "22"
                                      : "rgba(15,23,42,0.5)",
                                  border: `1px solid ${
                                    count > 0
                                      ? group.color + "44"
                                      : "#1e293b"
                                  }`,
                                  color:
                                    count > 0 ? group.color : "#475569",
                                }}
                              >
                                {count}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                </div>
              );
            })}

            {auth?.role === "admin" && (
              <button
                type="button"
                onClick={() => setAppState("admin")}
                className={cn(
                  "group flex w-full items-center rounded-xl text-sm font-semibold transition-all duration-150",
                  collapsed ? "justify-center p-2" : "gap-2.5 px-2.5 py-2.5",
                  appState === "admin"
                    ? "bg-white text-slate-950 shadow-[0_4px_20px_rgba(255,255,255,0.07)]"
                    : "text-slate-400 hover:bg-slate-800/80 hover:text-white",
                )}
                title={collapsed ? "Administration" : undefined}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                    appState === "admin"
                      ? "bg-slate-900 text-white"
                      : "bg-slate-800/80 text-slate-400 group-hover:bg-slate-700 group-hover:text-white",
                  )}
                >
                  <Settings className="h-4 w-4" />
                </span>
                {!collapsed && (
                  <span className="flex-1 text-left">Administration</span>
                )}
              </button>
            )}
          </div>
        </nav>

        {/* ── User footer ─────────────────────────── */}
        <div
          className={cn(
            "flex-shrink-0 border-t p-2",
            collapsed ? "px-1.5" : "px-2",
          )}
          style={{ borderColor: accent + "18" }}
        >
          {collapsed ? (
            <div className="flex flex-col items-center gap-1.5 py-1">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-xl text-[11px] font-extrabold text-white"
                style={{
                  background: `linear-gradient(135deg, ${accent}55, ${accent}22)`,
                  border: `1px solid ${accent}33`,
                }}
              >
                {initials(auth?.email)}
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-700 bg-slate-800/80 text-slate-400 transition hover:bg-white hover:text-slate-950"
                title="Logout"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 rounded-xl px-2.5 py-2">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold text-white"
                style={{
                  background: `linear-gradient(135deg, ${accent}55, ${accent}22)`,
                  border: `1px solid ${accent}33`,
                }}
              >
                {initials(auth?.email)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-white">
                  {auth?.email}
                </div>
                <div className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                  {auth?.role === "admin" ? "Administrator" : "Reviewer"}
                </div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-800/80 text-slate-400 transition hover:bg-white hover:text-slate-950"
                title="Logout"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function initials(email?: string) {
  if (!email) return "DU";
  return email.slice(0, 2).toUpperCase();
}
