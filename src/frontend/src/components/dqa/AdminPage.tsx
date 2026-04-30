import { useState, useEffect, useCallback } from "react";
import {
  UserPlus,
  Trash2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
  LogOut,
  Upload,
  MapPin,
  Users,
} from "lucide-react";
import Papa from "papaparse";
import type { AuthState } from "./LoginPage";
import { API_BASE } from "../../config";
import { GlassPanel } from "../branding/GlassPanel";

interface GeoEntry {
  id: string;
  state: string;
  district: string;
  block: string;
}

interface UserRecord {
  id: string;
  email: string;
  role: string;
  level: string;
  geoState: string | null;
  geoDistrict: string | null;
  geoBlock: string | null;
  createdAt: string;
}

interface Props {
  authState: AuthState;
  onBack: () => void;
  onLogout: () => void;
}

type Feedback = { type: "success" | "error"; message: string } | null;
type Tab = "users" | "geo";

export function AdminPage({ authState, onBack, onLogout }: Props) {
  const [tab, setTab] = useState<Tab>("users");
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newLevel, setNewLevel] = useState<
    "NATIONAL" | "STATE" | "DISTRICT" | "BLOCK"
  >("NATIONAL");
  const [newState, setNewState] = useState("");
  const [newDistrict, setNewDistrict] = useState("");
  const [newBlock, setNewBlock] = useState("");
  const [adding, setAdding] = useState(false);
  const [geoEntries, setGeoEntries] = useState<GeoEntry[]>([]);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoUploading, setGeoUploading] = useState(false);
  const [geoFeedback, setGeoFeedback] = useState<Feedback>(null);

  const headers = { Authorization: `Bearer ${authState.token}` };

  const showFeedback = (nextFeedback: Feedback) => {
    setFeedback(nextFeedback);
    setTimeout(() => setFeedback(null), 5000);
  };

  const showGeoFeedback = (nextFeedback: Feedback) => {
    setGeoFeedback(nextFeedback);
    setTimeout(() => setGeoFeedback(null), 5000);
  };

  const states = [...new Set(geoEntries.map((entry) => entry.state))].sort();
  const districts = [
    ...new Set(
      geoEntries
        .filter((entry) => entry.state === newState)
        .map((entry) => entry.district),
    ),
  ].sort();
  const blocks = [
    ...new Set(
      geoEntries
        .filter(
          (entry) =>
            entry.state === newState && entry.district === newDistrict,
        )
        .map((entry) => entry.block),
    ),
  ].sort();

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/admin/users`, { headers });
      if (!response.ok) throw new Error();
      setUsers(await response.json());
    } catch {
      showFeedback({ type: "error", message: "Failed to load users" });
    } finally {
      setUsersLoading(false);
    }
  }, [authState.token]);

  const loadGeo = useCallback(async () => {
    setGeoLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/admin/geo`, { headers });
      if (response.ok) setGeoEntries(await response.json());
    } catch {
      // Intentionally silent when no geodata is present yet.
    } finally {
      setGeoLoading(false);
    }
  }, [authState.token]);

  useEffect(() => {
    loadUsers();
    loadGeo();
  }, [loadUsers, loadGeo]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim() || !newPassword.trim()) {
      showFeedback({ type: "error", message: "Email and password are required." });
      return;
    }
    setAdding(true);
    try {
      const body: Record<string, string> = {
        email: newEmail.trim(),
        password: newPassword,
        level: newLevel,
      };
      if (newLevel !== "NATIONAL") body.geoState = newState;
      if (newLevel === "DISTRICT" || newLevel === "BLOCK") {
        body.geoDistrict = newDistrict;
      }
      if (newLevel === "BLOCK") body.geoBlock = newBlock;

      const response = await fetch(`${API_BASE}/api/admin/users`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      showFeedback({ type: "success", message: `User "${newEmail}" created.` });
      setNewEmail("");
      setNewPassword("");
      setNewLevel("NATIONAL");
      setNewState("");
      setNewDistrict("");
      setNewBlock("");
      loadUsers();
    } catch (error) {
      showFeedback({
        type: "error",
        message:
          error instanceof Error ? error.message : "Failed to create user.",
      });
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string, email: string) => {
    if (!confirm(`Delete user "${email}"?`)) return;
    setDeleting(id);
    try {
      const response = await fetch(`${API_BASE}/api/admin/users/${id}`, {
        method: "DELETE",
        headers,
      });
      if (!response.ok) throw new Error();
      setUsers((prev) => prev.filter((user) => user.id !== id));
      showFeedback({ type: "success", message: `User "${email}" deleted.` });
    } catch {
      showFeedback({ type: "error", message: "Delete failed." });
    } finally {
      setDeleting(null);
    }
  };

  const handleGeoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setGeoUploading(true);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (result) => {
        try {
          const rows = result.data as Record<string, string>[];
          const firstRow = rows[0] ?? {};
          const keys = Object.keys(firstRow);
          const findKey = (candidates: string[]) =>
            keys.find((key) => candidates.includes(key.trim().toLowerCase()));

          const stateKey = findKey([
            "state",
            "statename",
            "state_name",
            "state name",
          ]);
          const districtKey = findKey([
            "district",
            "districtname",
            "district_name",
            "district name",
            "dist",
          ]);
          const blockKey = findKey([
            "block",
            "blockname",
            "block_name",
            "block name",
            "subdistrict",
            "taluka",
          ]);

          if (!stateKey || !districtKey || !blockKey) {
            showGeoFeedback({
              type: "error",
              message: `Could not find State/District/Block columns. Found: ${keys.join(", ")}`,
            });
            return;
          }

          const entries = rows
            .map((row) => ({
              state: row[stateKey]?.trim(),
              district: row[districtKey]?.trim(),
              block: row[blockKey]?.trim(),
            }))
            .filter(
              (
                entry,
              ): entry is { state: string; district: string; block: string } =>
                Boolean(entry.state && entry.district && entry.block),
            );

          const response = await fetch(`${API_BASE}/api/admin/geo`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ entries }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.message);
          showGeoFeedback({ type: "success", message: data.message });
          loadGeo();
        } catch (error) {
          showGeoFeedback({
            type: "error",
            message: error instanceof Error ? error.message : "Upload failed.",
          });
        } finally {
          setGeoUploading(false);
        }
      },
      error: () => {
        showGeoFeedback({
          type: "error",
          message: "Failed to parse CSV file.",
        });
        setGeoUploading(false);
      },
    });
  };

  const levelBadge: Record<string, string> = {
    NATIONAL: "bg-purple-100 text-purple-700",
    STATE: "bg-sky-100 text-sky-700",
    DISTRICT: "bg-indigo-100 text-indigo-700",
    BLOCK: "bg-emerald-100 text-emerald-700",
  };

  const inputClassName =
    "w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70";

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-6 md:py-8">
      <div className="space-y-5">
        <div className="border-b border-slate-200 bg-white px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-lg font-semibold text-slate-900">Administration</h1>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={onBack}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </button>
              <button
                onClick={onLogout}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800"
              >
                <LogOut className="h-3.5 w-3.5" />
                Logout
              </button>
            </div>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1">
            <span className="text-xs text-slate-500">
              Signed in as: <strong className="font-semibold text-slate-700">{authState.email}</strong>
            </span>
            <span className="text-xs text-slate-500">
              Users: <strong className="font-semibold text-slate-700">{users.length}</strong>
            </span>
            <span className="text-xs text-slate-500">
              Blocks: <strong className="font-semibold text-slate-700">{geoEntries.length}</strong>
            </span>
          </div>
        </div>

        <GlassPanel className="p-2">
          <div className="flex flex-wrap gap-2">
            {([
              ["users", <Users className="h-4 w-4" />, "Manage users"],
              ["geo", <MapPin className="h-4 w-4" />, "Geodataset"],
            ] as [Tab, React.ReactNode, string][]).map(([value, icon, label]) => (
              <button
                key={value}
                onClick={() => setTab(value)}
                className={[
                  "inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition",
                  tab === value
                    ? "bg-slate-950 text-white shadow-[0_18px_30px_rgba(15,23,42,0.18)]"
                    : "bg-white/70 text-slate-600 hover:bg-white hover:text-slate-950",
                ].join(" ")}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
        </GlassPanel>

        {tab === "users" ? (
          <>
            {feedback ? (
              <GlassPanel className="p-4">
                <div
                  className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold ${
                    feedback.type === "success"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-red-50 text-red-700"
                  }`}
                >
                  {feedback.type === "success" ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                  {feedback.message}
                </div>
              </GlassPanel>
            ) : null}

            <GlassPanel className="p-6">
              <div className="mb-5 flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-slate-500" />
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Create user
                </div>
              </div>

              <form onSubmit={handleCreateUser} className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Email
                    </span>
                    <input
                      type="email"
                      value={newEmail}
                      onChange={(event) => setNewEmail(event.target.value)}
                      placeholder="Email address"
                      className={inputClassName}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Password
                    </span>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      placeholder="Password"
                      className={inputClassName}
                    />
                  </label>
                </div>

                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    User level
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(["NATIONAL", "STATE", "DISTRICT", "BLOCK"] as const).map(
                      (level) => (
                        <button
                          key={level}
                          type="button"
                          onClick={() => {
                            setNewLevel(level);
                            setNewState("");
                            setNewDistrict("");
                            setNewBlock("");
                          }}
                          className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                            newLevel === level
                              ? "bg-slate-950 text-white"
                              : "bg-white/80 text-slate-600 hover:bg-white hover:text-slate-950"
                          }`}
                        >
                          {level}
                        </button>
                      ),
                    )}
                  </div>
                </div>

                {newLevel !== "NATIONAL" ? (
                  <div className="grid gap-4 md:grid-cols-3">
                    <label className="block">
                      <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        State
                      </span>
                      {states.length > 0 ? (
                        <select
                          value={newState}
                          onChange={(event) => {
                            setNewState(event.target.value);
                            setNewDistrict("");
                            setNewBlock("");
                          }}
                          className={inputClassName}
                        >
                          <option value="">Select state</option>
                          {states.map((state) => (
                            <option key={state} value={state}>
                              {state}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={newState}
                          onChange={(event) => setNewState(event.target.value)}
                          placeholder="Enter state name"
                          className={inputClassName}
                        />
                      )}
                    </label>

                    {newLevel === "DISTRICT" || newLevel === "BLOCK" ? (
                      <label className="block">
                        <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          District
                        </span>
                        {districts.length > 0 ? (
                          <select
                            value={newDistrict}
                            onChange={(event) => {
                              setNewDistrict(event.target.value);
                              setNewBlock("");
                            }}
                            className={inputClassName}
                            disabled={!newState}
                          >
                            <option value="">Select district</option>
                            {districts.map((district) => (
                              <option key={district} value={district}>
                                {district}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            value={newDistrict}
                            onChange={(event) =>
                              setNewDistrict(event.target.value)
                            }
                            placeholder="Enter district"
                            className={inputClassName}
                          />
                        )}
                      </label>
                    ) : null}

                    {newLevel === "BLOCK" ? (
                      <label className="block">
                        <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Block
                        </span>
                        {blocks.length > 0 ? (
                          <select
                            value={newBlock}
                            onChange={(event) => setNewBlock(event.target.value)}
                            className={inputClassName}
                            disabled={!newDistrict}
                          >
                            <option value="">Select block</option>
                            {blocks.map((block) => (
                              <option key={block} value={block}>
                                {block}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            value={newBlock}
                            onChange={(event) => setNewBlock(event.target.value)}
                            placeholder="Enter block"
                            className={inputClassName}
                          />
                        )}
                      </label>
                    ) : null}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={adding}
                  className="inline-flex items-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#0f172a,#14532d)] px-5 py-3 text-sm font-bold text-white shadow-[0_16px_30px_rgba(15,23,42,0.16)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {adding ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <UserPlus className="h-4 w-4" />
                  )}
                  {adding ? "Creating..." : "Create user"}
                </button>
              </form>
            </GlassPanel>

            <GlassPanel className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/70 px-5 py-4">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Users
                  </div>
                  <div className="mt-1 text-lg font-bold text-slate-950">
                    All users ({users.length})
                  </div>
                </div>
                <button
                  onClick={loadUsers}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/85 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-white"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </button>
              </div>

              {usersLoading ? (
                <div className="p-6 text-sm font-medium text-slate-500">
                  Loading...
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-white/60 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        <th className="px-4 py-3">Email</th>
                        <th className="px-4 py-3">Role</th>
                        <th className="px-4 py-3">Level</th>
                        <th className="px-4 py-3">Geo scope</th>
                        <th className="px-4 py-3">Created</th>
                        <th className="px-4 py-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((user) => (
                        <tr
                          key={user.id}
                          className="border-t border-white/80 bg-white/50 transition hover:bg-white/80"
                        >
                          <td className="px-4 py-3 font-medium text-slate-700">
                            {user.email}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${
                                user.role === "ADMIN"
                                  ? "bg-red-100 text-red-700"
                                  : "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {user.role}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${
                                levelBadge[user.level] ?? "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {user.level}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500">
                            {[user.geoState, user.geoDistrict, user.geoBlock]
                              .filter(Boolean)
                              .join(" / ") || "-"}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500">
                            {new Date(user.createdAt).toLocaleDateString("en-IN", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {user.email !== authState.email ? (
                              <button
                                onClick={() => handleDelete(user.id, user.email)}
                                disabled={deleting === user.id}
                                className="rounded-2xl p-2 text-red-500 transition hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </GlassPanel>
          </>
        ) : (
          <>
            {geoFeedback ? (
              <GlassPanel className="p-4">
                <div
                  className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold ${
                    geoFeedback.type === "success"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-red-50 text-red-700"
                  }`}
                >
                  {geoFeedback.type === "success" ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                  {geoFeedback.message}
                </div>
              </GlassPanel>
            ) : null}

            <GlassPanel className="p-6">
              <div className="mb-3 flex items-center gap-2">
                <Upload className="h-4 w-4 text-slate-500" />
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Upload geodataset
                </div>
              </div>
              <p className="max-w-3xl text-sm leading-7 text-slate-600">
                Upload a CSV with State, District, and Block columns. Uploading
                a new file replaces the current geodata used for scope-aware user
                creation.
              </p>

              <label
                className={`mt-5 flex cursor-pointer flex-col items-center justify-center rounded-[28px] border-2 border-dashed p-10 text-center transition ${
                  geoUploading
                    ? "border-slate-300 bg-slate-50"
                    : "border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.82))] hover:border-slate-300 hover:bg-white"
                }`}
              >
                {geoUploading ? (
                  <RefreshCw className="mb-3 h-8 w-8 animate-spin text-slate-600" />
                ) : (
                  <Upload className="mb-3 h-8 w-8 text-slate-500" />
                )}
                <span className="text-base font-bold text-slate-950">
                  {geoUploading ? "Uploading..." : "Choose geodataset CSV"}
                </span>
                <span className="mt-2 text-sm text-slate-500">CSV format only</span>
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleGeoFile}
                  disabled={geoUploading}
                />
              </label>
            </GlassPanel>

            {geoLoading ? (
              <GlassPanel className="p-10 text-center">
                <div className="text-sm font-medium text-slate-500">
                  Loading geodata...
                </div>
              </GlassPanel>
            ) : geoEntries.length > 0 ? (
              <GlassPanel className="overflow-hidden">
                <div className="border-b border-white/70 px-5 py-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Geodataset
                  </div>
                  <div className="mt-1 text-lg font-bold text-slate-950">
                    Loaded geographic reference data
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.14em]">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                      {[...new Set(geoEntries.map((entry) => entry.state))].length} states
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                      {[
                        ...new Set(
                          geoEntries.map(
                            (entry) => `${entry.state}|${entry.district}`,
                          ),
                        ),
                      ].length} districts
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                      {geoEntries.length} blocks
                    </span>
                  </div>
                </div>

                <div className="max-h-96 overflow-x-auto overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-white/80 backdrop-blur-sm">
                      <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        <th className="px-4 py-3">State</th>
                        <th className="px-4 py-3">District</th>
                        <th className="px-4 py-3">Block</th>
                      </tr>
                    </thead>
                    <tbody>
                      {geoEntries.map((entry) => (
                        <tr
                          key={entry.id}
                          className="border-t border-white/80 bg-white/50 transition hover:bg-white/80"
                        >
                          <td className="px-4 py-2 text-slate-700">{entry.state}</td>
                          <td className="px-4 py-2 text-slate-700">{entry.district}</td>
                          <td className="px-4 py-2 text-slate-500">{entry.block}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </GlassPanel>
            ) : (
              <GlassPanel className="p-12 text-center">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  No geodata yet
                </div>
                <div className="mt-2 font-display text-3xl font-extrabold text-slate-950">
                  Upload a geographic reference CSV to enable scoped access.
                </div>
              </GlassPanel>
            )}
          </>
        )}
      </div>
    </div>
  );
}
