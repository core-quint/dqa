import { useEffect, useMemo, useState } from "react";
import {
  BarChart2,
  Bell,
  ChevronRight,
  LogOut,
  MapPinned,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Trash2,
  TrendingUp,
  Upload,
} from "lucide-react";
import { useAppContext } from "../../context/AppContext";
import { cn } from "@/lib/utils";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../ui/breadcrumb";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "../ui/command";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../ui/sheet";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { ShieldCheck } from "lucide-react";
import {
  getPortalData,
  getPortalForView,
  getPortalGroups,
} from "./shellConfig";

function initialsFromEmail(email?: string) {
  if (!email) return "DU";
  const [name] = email.split("@");
  const pieces = name.split(/[.\-_]/).filter(Boolean);
  if (pieces.length === 1) return name.slice(0, 2).toUpperCase();
  return `${pieces[0][0] ?? ""}${pieces[1][0] ?? ""}`.toUpperCase();
}

interface TopBarProps {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

export function TopBar({ sidebarCollapsed, onToggleSidebar }: TopBarProps) {
  const {
    auth,
    appState,
    setAppState,
    csvData,
    setCsvData,
    uwinData,
    setUwinData,
    trendSource,
    setTrendSource,
    activeGroup,
    setActiveGroup,
    uwinActiveGroup,
    setUwinActiveGroup,
    handleLogout,
  } = useAppContext();

  const [commandOpen, setCommandOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const portal = getPortalForView(appState, trendSource, csvData, uwinData);
  const activeData =
    appState === "coverage" ? null : getPortalData(portal, csvData, uwinData);
  const currentGroup = portal === "U-WIN" ? uwinActiveGroup : activeGroup;
  const groupItems = getPortalGroups(portal);

  useEffect(() => {
    function handleShortcuts(event: KeyboardEvent) {
      const commandKey = event.metaKey || event.ctrlKey;
      if (!commandKey) return;
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        onToggleSidebar();
      }
    }
    document.addEventListener("keydown", handleShortcuts);
    return () => document.removeEventListener("keydown", handleShortcuts);
  }, [onToggleSidebar]);

  const breadcrumbs = useMemo(() => {
    const items: { label: string; key: string }[] = [{ label: "Home", key: "home" }];

    if (appState === "portal") {
      items.push({ label: "Select Program", key: "portal" });
      return items;
    }
    if (appState === "admin") {
      items.push({ label: "Admin", key: "admin" });
      return items;
    }
    if (appState === "coverage") {
      items.push({ label: "Coverage", key: "coverage" });
      return items;
    }
    if (portal) items.push({ label: portal, key: "portal-kind" });
    if (appState === "landing" || appState === "uwin-landing") {
      items.push({ label: "Upload", key: "upload" });
    } else if (appState === "results" || appState === "uwin-results") {
      items.push({ label: "Analysis", key: "analysis" });
      if (currentGroup) {
        items.push({
          label: currentGroup.charAt(0).toUpperCase() + currentGroup.slice(1),
          key: "group",
        });
      }
    } else if (appState === "trend") {
      items.push({ label: "Trends", key: "trend" });
    }
    return items;
  }, [appState, currentGroup, portal]);

  const scopeLabel = auth
    ? [auth.level, auth.geoState, auth.geoDistrict, auth.geoBlock]
        .filter(Boolean)
        .join(" / ")
    : "";

  const notifications = [
    appState === "coverage"
      ? { title: "Coverage map", detail: "Review saved DQAs across your geography." }
      : activeData
        ? { title: "Dataset loaded", detail: `${activeData.fileName} is ready.` }
        : { title: "No dataset", detail: "Open Upload to start a review." },
    { title: "Access scope", detail: scopeLabel || "National access" },
    portal && currentGroup
      ? {
          title: "Current tab",
          detail: `${portal} › ${currentGroup.charAt(0).toUpperCase()}${currentGroup.slice(1)}`,
        }
      : { title: "Current page", detail: breadcrumbs[breadcrumbs.length - 1]?.label ?? "Home" },
  ];

  const runCommand = (action: () => void) => {
    setCommandOpen(false);
    action();
  };

  return (
    <>
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-slate-100 bg-white px-4 py-2.5 md:px-5">
        {/* Breadcrumb */}
        <Breadcrumb>
          <BreadcrumbList className="flex-nowrap">
            {breadcrumbs.map((item, index) => (
              <div key={item.key} className="contents">
                <BreadcrumbItem>
                  {index === breadcrumbs.length - 1 ? (
                    <BreadcrumbPage className="text-sm font-semibold text-slate-900">
                      {item.label}
                    </BreadcrumbPage>
                  ) : (
                    <span className="text-sm text-slate-400">{item.label}</span>
                  )}
                </BreadcrumbItem>
                {index < breadcrumbs.length - 1 && (
                  <BreadcrumbSeparator>
                    <ChevronRight className="h-3 w-3 text-slate-300" />
                  </BreadcrumbSeparator>
                )}
              </div>
            ))}
          </BreadcrumbList>
        </Breadcrumb>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5">
          {/* Sidebar toggle */}
          <button
            type="button"
            onClick={onToggleSidebar}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-950 hover:text-white"
            title={sidebarCollapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="h-3.5 w-3.5" />
            ) : (
              <PanelLeftClose className="h-3.5 w-3.5" />
            )}
          </button>

          {/* Search */}
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-950 hover:text-white"
            title="Search (Ctrl+K)"
          >
            <Search className="h-3.5 w-3.5" />
          </button>

          {/* Notifications */}
          <button
            type="button"
            onClick={() => setNotificationsOpen(true)}
            className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-950 hover:text-white"
            title="Notifications"
          >
            <Bell className="h-3.5 w-3.5" />
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-slate-950 text-[9px] font-bold text-white">
              {notifications.length}
            </span>
          </button>

          {/* Avatar */}
          <Avatar
            className="h-8 w-8 cursor-default border border-slate-200"
            title={auth?.email}
          >
            <AvatarFallback className="bg-slate-950 text-[11px] font-extrabold text-white">
              {initialsFromEmail(auth?.email)}
            </AvatarFallback>
          </Avatar>
        </div>
      </header>

      {/* Command palette */}
      <CommandDialog
        open={commandOpen}
        onOpenChange={setCommandOpen}
        title="Command palette"
        description="Search routes, tabs, and actions."
        className="overflow-hidden rounded-[28px] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(246,242,233,0.96))] p-0 shadow-[0_36px_90px_rgba(15,23,42,0.18)] sm:max-w-2xl"
      >
        <CommandInput
          placeholder="Search pages, tabs, actions…"
          className="text-sm"
        />
        <CommandList className="max-h-[60vh]">
          <CommandEmpty>No matching command.</CommandEmpty>

          <CommandGroup heading="Pages">
            <CommandItem
              keywords={["home", "portal", "selection"]}
              onSelect={() => runCommand(() => setAppState("portal"))}
            >
              <Upload className="h-4 w-4" />
              Select Program
            </CommandItem>
            <CommandItem
              keywords={["upload", "hmis", "csv"]}
              onSelect={() => runCommand(() => setAppState("landing"))}
            >
              <Upload className="h-4 w-4" />
              HMIS Upload
            </CommandItem>
            <CommandItem
              keywords={["upload", "uwin", "u-win", "csv"]}
              onSelect={() => runCommand(() => setAppState("uwin-landing"))}
            >
              <Upload className="h-4 w-4" />
              U-WIN Upload
            </CommandItem>
            <CommandItem
              keywords={["trend", "history", "analytics"]}
              onSelect={() => runCommand(() => { setTrendSource("ALL"); setAppState("trend"); })}
            >
              <TrendingUp className="h-4 w-4" />
              Trend History
            </CommandItem>
            <CommandItem
              keywords={["coverage", "map", "heatmap"]}
              onSelect={() => runCommand(() => setAppState("coverage"))}
            >
              <MapPinned className="h-4 w-4" />
              DQA Coverage
            </CommandItem>
            {csvData && (
              <CommandItem
                keywords={["analysis", "hmis", "review"]}
                onSelect={() => runCommand(() => setAppState("results"))}
              >
                <BarChart2 className="h-4 w-4" />
                HMIS Analysis
              </CommandItem>
            )}
            {uwinData && (
              <CommandItem
                keywords={["analysis", "uwin", "u-win", "review"]}
                onSelect={() => runCommand(() => setAppState("uwin-results"))}
              >
                <BarChart2 className="h-4 w-4" />
                U-WIN Analysis
              </CommandItem>
            )}
            <CommandItem
              keywords={["trend", "hmis"]}
              onSelect={() => runCommand(() => { setTrendSource("HMIS"); setAppState("trend"); })}
            >
              <TrendingUp className="h-4 w-4" />
              HMIS Trends
            </CommandItem>
            <CommandItem
              keywords={["trend", "uwin", "u-win"]}
              onSelect={() => runCommand(() => { setTrendSource("UWIN"); setAppState("trend"); })}
            >
              <TrendingUp className="h-4 w-4" />
              U-WIN Trends
            </CommandItem>
            {auth?.role === "admin" && (
              <CommandItem
                keywords={["admin", "users", "geodata"]}
                onSelect={() => runCommand(() => setAppState("admin"))}
              >
                <Settings className="h-4 w-4" />
                Administration
              </CommandItem>
            )}
          </CommandGroup>

          {portal && groupItems.length > 0 && (
            <CommandGroup heading="Analysis Tabs">
              {groupItems.map((group) => (
                <CommandItem
                  key={group.id}
                  keywords={[group.label.toLowerCase(), portal.toLowerCase(), "analysis"]}
                  onSelect={() =>
                    runCommand(() => {
                      if (portal === "U-WIN") {
                        setUwinActiveGroup(group.id);
                        setAppState("uwin-results");
                      } else {
                        setActiveGroup(group.id);
                        setAppState("results");
                      }
                    })
                  }
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: group.color }}
                  />
                  {group.label}
                  {currentGroup === group.id && (
                    <CommandShortcut>Current</CommandShortcut>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          <CommandSeparator />

          <CommandGroup heading="Actions">
            <CommandItem
              keywords={["sidebar", "toggle", "collapse"]}
              onSelect={() => runCommand(onToggleSidebar)}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
              {sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              <CommandShortcut>Ctrl+B</CommandShortcut>
            </CommandItem>
            {csvData && (
              <CommandItem
                keywords={["clear", "remove", "reset", "hmis"]}
                onSelect={() => runCommand(() => { setCsvData(null); setAppState("portal"); })}
              >
                <Trash2 className="h-4 w-4" />
                Clear HMIS dataset
              </CommandItem>
            )}
            {uwinData && (
              <CommandItem
                keywords={["clear", "remove", "reset", "uwin"]}
                onSelect={() => runCommand(() => { setUwinData(null); setAppState("portal"); })}
              >
                <Trash2 className="h-4 w-4" />
                Clear U-WIN dataset
              </CommandItem>
            )}
            <CommandItem
              keywords={["logout", "sign out"]}
              onSelect={() => runCommand(handleLogout)}
            >
              <LogOut className="h-4 w-4" />
              Logout
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      {/* Notifications sheet */}
      <Sheet open={notificationsOpen} onOpenChange={setNotificationsOpen}>
        <SheetContent
          side="right"
          className={cn(
            "w-[min(400px,96vw)] border-l border-slate-100 bg-white p-0 sm:max-w-[400px]",
          )}
        >
          <SheetHeader className="border-b border-slate-100 px-5 py-4">
            <SheetTitle className="text-left text-base font-bold text-slate-950">
              Notifications
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-2 p-4">
            {notifications.map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-slate-100 bg-slate-50 p-3.5"
              >
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-3.5 w-3.5 text-slate-400" />
                  <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                </div>
                <div className="mt-1.5 text-xs leading-5 text-slate-500">{item.detail}</div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
