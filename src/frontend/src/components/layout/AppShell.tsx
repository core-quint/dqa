import { useEffect, useState } from "react";
import { PageBackdrop } from "../branding/PageBackdrop";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem("dqa-sidebar-collapsed");
    if (stored === "1") {
      setSidebarCollapsed(true);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      "dqa-sidebar-collapsed",
      sidebarCollapsed ? "1" : "0",
    );
  }, [sidebarCollapsed]);

  return (
    <PageBackdrop>
      <div className="flex min-h-screen flex-col gap-3 p-3 md:h-screen md:flex-row md:gap-4 md:p-4">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((value) => !value)}
        />

        <div className="relative flex-1 min-w-0 md:min-h-0">
          <main className="flex h-full min-h-0 flex-col overflow-hidden rounded-[32px] border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03),0_16px_40px_rgba(15,23,42,0.06)]">
            <TopBar
              sidebarCollapsed={sidebarCollapsed}
              onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
            />
            <div className="min-h-0 flex-1 overflow-y-auto thin-scroll">
              {children}
            </div>
          </main>
        </div>
      </div>
    </PageBackdrop>
  );
}
