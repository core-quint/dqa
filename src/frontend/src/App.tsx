import { AppProvider, useAppContext } from "./context/AppContext";
import { AppShell } from "./components/layout/AppShell";
import { LoginPage } from "./components/dqa/LoginPage";
import { PortalSelector } from "./components/dqa/PortalSelector";
import { LandingPage } from "./components/dqa/LandingPage";
import { ResultsPage } from "./components/dqa/ResultsPage";
import { TrendPage } from "./components/dqa/TrendPage";
import { DashboardPage } from "./components/dqa/DashboardPage";
import { CoveragePage } from "./components/dqa/CoveragePage";
import { AdminPage } from "./components/dqa/AdminPage";
import { UwinLandingPage } from "./components/uwin/UwinLandingPage";
import { UwinResultsPage } from "./components/uwin/UwinResultsPage";
import { StateHmisLandingPage } from "./components/stateHmis/StateHmisLandingPage";
import { StateHmisResultsPage } from "./components/stateHmis/StateHmisResultsPage";

function AppContent() {
  const {
    auth,
    setAuth,
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
    hmisSnapshotSaved,
    setHmisSnapshotSaved,
    uwinSnapshotSaved,
    setUwinSnapshotSaved,
    hmisReviewInfo,
    setHmisReviewInfo,
    uwinReviewInfo,
    setUwinReviewInfo,
    stateHmisData,
    setStateHmisData,
    stateHmisReviewInfo,
    setStateHmisReviewInfo,
    stateHmisSnapshotSaved,
    setStateHmisSnapshotSaved,
    handleLogout,
  } = useAppContext();

  if (!auth) {
    return (
      <LoginPage
        onLogin={(authData) => {
          setAuth(authData);
          setAppState("portal");
        }}
      />
    );
  }

  if (appState === "portal") {
    return (
      <AppShell>
        <PortalSelector
          auth={auth}
          onSelectHmis={() => setAppState("landing")}
          onSelectUwin={() => setAppState("uwin-landing")}
          onSelectStateHmis={() => setAppState("state-hmis-landing")}
        />
      </AppShell>
    );
  }

  if (appState === "admin") {
    return (
      <AppShell>
        <AdminPage
          authState={auth}
          onBack={() => setAppState("portal")}
          onLogout={handleLogout}
        />
      </AppShell>
    );
  }

  if (appState === "landing" || (appState === "results" && !csvData)) {
    return (
      <AppShell>
        <LandingPage
          auth={auth}
          onDataReady={(data, reviewInfo) => {
            setCsvData(data);
            setActiveGroup("availability");
            setHmisReviewInfo(reviewInfo);
            setAppState("results");
          }}
          onBack={() => setAppState("portal")}
        />
      </AppShell>
    );
  }

  if (appState === "results" && csvData) {
    return (
      <AppShell>
        <ResultsPage
          csv={csvData}
          auth={auth}
          activeGroup={activeGroup}
          onGroupChange={setActiveGroup}
          snapshotSaved={hmisSnapshotSaved}
          onSnapshotSaved={() => setHmisSnapshotSaved(true)}
          reviewInfo={hmisReviewInfo}
          onReset={() => {
            setCsvData(null);
            setActiveGroup("availability");
            setHmisSnapshotSaved(false);
            setHmisReviewInfo(null);
            setAppState("portal");
          }}
          onTrend={() => {
            setTrendSource("HMIS");
            setAppState("trend");
          }}
        />
      </AppShell>
    );
  }

  if (appState === "trend") {
    const trendBackLabel =
      trendSource === "UWIN" && uwinData
        ? "Back to U-WIN analysis"
        : trendSource === "HMIS" && csvData
          ? "Back to HMIS analysis"
          : "Back to portal selection";

    return (
      <AppShell>
        <TrendPage
          onBack={() => {
            if (trendSource === "UWIN" && uwinData) {
              setAppState("uwin-results");
              return;
            }

            if (trendSource === "HMIS" && csvData) {
              setAppState("results");
              return;
            }

            setAppState("portal");
          }}
          backLabel={trendBackLabel}
          authEmail={auth.email}
          initialPortal={trendSource}
        />
      </AppShell>
    );
  }

  if (appState === "dashboard") {
    return (
      <AppShell>
        <DashboardPage auth={auth} />
      </AppShell>
    );
  }

  if (appState === "coverage") {
    return (
      <AppShell>
        <CoveragePage auth={auth} />
      </AppShell>
    );
  }

  if (appState === "uwin-landing" || (appState === "uwin-results" && !uwinData)) {
    return (
      <AppShell>
        <UwinLandingPage
          auth={auth}
          onDataReady={(data, reviewInfo) => {
            setUwinData(data);
            setUwinActiveGroup("availability");
            setUwinReviewInfo(reviewInfo);
            setAppState("uwin-results");
          }}
          onBack={() => setAppState("portal")}
        />
      </AppShell>
    );
  }

  if (appState === "uwin-results" && uwinData) {
    return (
      <AppShell>
        <UwinResultsPage
          csv={uwinData}
          auth={auth}
          activeGroup={uwinActiveGroup}
          onGroupChange={setUwinActiveGroup}
          snapshotSaved={uwinSnapshotSaved}
          onSnapshotSaved={() => setUwinSnapshotSaved(true)}
          reviewInfo={uwinReviewInfo}
          onReset={() => {
            setUwinData(null);
            setUwinActiveGroup("availability");
            setUwinSnapshotSaved(false);
            setUwinReviewInfo(null);
            setAppState("portal");
          }}
          onTrend={() => {
            setTrendSource("UWIN");
            setAppState("trend");
          }}
        />
      </AppShell>
    );
  }

  if (appState === "state-hmis-landing" || (appState === "state-hmis-results" && !stateHmisData)) {
    return <AppShell><StateHmisLandingPage auth={auth} onBack={() => setAppState("portal")} onDataReady={(data, reviewInfo) => { setStateHmisData(data); setStateHmisReviewInfo(reviewInfo); setStateHmisSnapshotSaved(false); setAppState("state-hmis-results"); }} /></AppShell>;
  }

  if (appState === "state-hmis-results" && stateHmisData) {
    return <AppShell><StateHmisResultsPage data={stateHmisData} auth={auth} reviewInfo={stateHmisReviewInfo} snapshotSaved={stateHmisSnapshotSaved} onSnapshotSaved={() => setStateHmisSnapshotSaved(true)} onReset={() => { setStateHmisData(null); setStateHmisReviewInfo(null); setStateHmisSnapshotSaved(false); setAppState("portal"); }} /></AppShell>;
  }

  return (
    <AppShell>
      <PortalSelector
        auth={auth}
        onSelectHmis={() => setAppState("landing")}
        onSelectUwin={() => setAppState("uwin-landing")}
        onSelectStateHmis={() => setAppState("state-hmis-landing")}
      />
    </AppShell>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
