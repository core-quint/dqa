import { createContext, useContext, useState, useCallback } from "react";
import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";
import type { ParsedCSV } from "../lib/dqa/types";
import type { UwinParsedCSV } from "../lib/uwin/types";
import type { AuthState } from "../components/dqa/LoginPage";
import type { ActiveGroup } from "../lib/dqa/types";
import type { PreUploadInfo } from "../lib/dqa/preUploadOptions";
import type { StateHmisParsed } from "../lib/stateHmis/types";

export type AppState =
  | "login"
  | "portal"
  | "landing"
  | "results"
  | "trend"
  | "dashboard"
  | "coverage"
  | "admin"
  | "uwin-landing"
  | "uwin-results"
  | "state-hmis-landing"
  | "state-hmis-results";

export type TrendSource = "ALL" | "HMIS" | "UWIN";

interface AppContextValue {
  auth: AuthState | null;
  setAuth: (a: AuthState | null) => void;
  appState: AppState;
  setAppState: (s: AppState) => void;
  csvData: ParsedCSV | null;
  setCsvData: (d: ParsedCSV | null) => void;
  uwinData: UwinParsedCSV | null;
  setUwinData: (d: UwinParsedCSV | null) => void;
  stateHmisData: StateHmisParsed | null;
  setStateHmisData: (d: StateHmisParsed | null) => void;
  trendSource: TrendSource;
  setTrendSource: (s: TrendSource) => void;
  activeGroup: ActiveGroup | "";
  setActiveGroup: (g: ActiveGroup | "") => void;
  uwinActiveGroup: ActiveGroup | "";
  setUwinActiveGroup: (g: ActiveGroup | "") => void;
  hmisSnapshotSaved: boolean;
  setHmisSnapshotSaved: (v: boolean) => void;
  uwinSnapshotSaved: boolean;
  setUwinSnapshotSaved: (v: boolean) => void;
  hmisReviewInfo: PreUploadInfo | null;
  setHmisReviewInfo: (v: PreUploadInfo | null) => void;
  uwinReviewInfo: PreUploadInfo | null;
  setUwinReviewInfo: (v: PreUploadInfo | null) => void;
  stateHmisReviewInfo: PreUploadInfo | null;
  setStateHmisReviewInfo: (v: PreUploadInfo | null) => void;
  stateHmisSnapshotSaved: boolean;
  setStateHmisSnapshotSaved: (v: boolean) => void;
  handleLogout: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<AuthState | null>(null);
  const [appState, setAppState] = useState<AppState>("login");
  const [csvData, setCsvData] = useState<ParsedCSV | null>(null);
  const [uwinData, setUwinData] = useState<UwinParsedCSV | null>(null);
  const [stateHmisData, setStateHmisData] = useState<StateHmisParsed | null>(null);
  const [trendSource, setTrendSource] = useState<TrendSource>("ALL");
  const [activeGroup, setActiveGroup] = useState<ActiveGroup | "">(
    "availability",
  );
  const [uwinActiveGroup, setUwinActiveGroup] = useState<ActiveGroup | "">(
    "availability",
  );
  const [hmisSnapshotSaved, setHmisSnapshotSaved] = useState(false);
  const [uwinSnapshotSaved, setUwinSnapshotSaved] = useState(false);
  const [hmisReviewInfo, setHmisReviewInfo] = useState<PreUploadInfo | null>(null);
  const [uwinReviewInfo, setUwinReviewInfo] = useState<PreUploadInfo | null>(null);
  const [stateHmisReviewInfo, setStateHmisReviewInfo] = useState<PreUploadInfo | null>(null);
  const [stateHmisSnapshotSaved, setStateHmisSnapshotSaved] = useState(false);

  const handleLogout = useCallback(() => {
    signOut(auth).catch(() => {});
    setAuthState(null);
    setAppState("login");
    setCsvData(null);
    setUwinData(null);
    setStateHmisData(null);
    setTrendSource("ALL");
    setActiveGroup("availability");
    setUwinActiveGroup("availability");
    setHmisSnapshotSaved(false);
    setUwinSnapshotSaved(false);
    setHmisReviewInfo(null);
    setUwinReviewInfo(null);
    setStateHmisReviewInfo(null);
    setStateHmisSnapshotSaved(false);
  }, []);

  return (
    <AppContext.Provider
      value={{
        auth: authState,
        setAuth: setAuthState,
        appState,
        setAppState,
        csvData,
        setCsvData,
        uwinData,
        setUwinData,
        stateHmisData,
        setStateHmisData,
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
        stateHmisReviewInfo,
        setStateHmisReviewInfo,
        stateHmisSnapshotSaved,
        setStateHmisSnapshotSaved,
        handleLogout,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used inside AppProvider");
  return ctx;
}
