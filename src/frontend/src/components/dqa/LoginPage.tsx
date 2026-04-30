import { useState } from "react";
import {
  Loader2,
  Mail,
  Lock,
  AlertCircle,
  ShieldCheck,
  BarChart3,
  Layers3,
} from "lucide-react";
import { API_BASE } from "../../config";
import { BrandMark } from "../branding/BrandMark";
import { GlassPanel } from "../branding/GlassPanel";
import { PageBackdrop } from "../branding/PageBackdrop";

export type AuthState = {
  token: string;
  email: string;
  role: "admin" | "user";
  level: "NATIONAL" | "STATE" | "DISTRICT" | "BLOCK";
  geoState: string | null;
  geoDistrict: string | null;
  geoBlock: string | null;
};

interface Props {
  onLogin: (auth: AuthState) => void;
}

const VALUE_PROPS = [
  {
    icon: <BarChart3 className="h-4 w-4" />,
    title: "Single application",
    description:
      "Use the same application for HMIS and U-WIN review.",
  },
  {
    icon: <ShieldCheck className="h-4 w-4" />,
    title: "Scoped access",
    description:
      "Access follows national, state, district, and block assignments.",
  },
  {
    icon: <Layers3 className="h-4 w-4" />,
    title: "Quick drill-down",
    description:
      "Open charts, tables, and facility-level details directly from results.",
  },
];

export function LoginPage({ onLogin }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim() || !password.trim()) {
      setError("Please enter your email and password.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Invalid email or password.");
      }

      if (!data.token) {
        throw new Error("Authentication failed.");
      }

      localStorage.setItem("token", data.token);

      const payload = JSON.parse(atob(data.token.split(".")[1]));

      onLogin({
        token: data.token,
        email: payload.email,
        role: payload.role?.toLowerCase() === "admin" ? "admin" : "user",
        level: payload.level ?? "NATIONAL",
        geoState: payload.geoState ?? null,
        geoDistrict: payload.geoDistrict ?? null,
        geoBlock: payload.geoBlock ?? null,
      });
    } catch (fetchError) {
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "Login failed. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  const inputClassName =
    "w-full rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70";

  return (
    <PageBackdrop className="flex items-center justify-center px-4 py-10 md:px-6">
      <div className="grid w-full max-w-6xl gap-6 lg:grid-cols-[1.08fr_0.92fr]">
        <GlassPanel tone="warm" className="overflow-hidden p-7 md:p-10">
          <div className="max-w-xl">
            <BrandMark
              size="lg"
              title="Data Quality Assessment"
              subtitle="Internal review system"
              caption="National monitoring"
            />

            <div className="mt-8 space-y-5">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-500">
                  Sign in
                </div>
                <h1 className="mt-2 font-display text-3xl font-extrabold leading-tight text-slate-950 md:text-4xl">
                  Continue to the review application.
                </h1>
                <p className="mt-3 max-w-lg text-sm leading-7 text-slate-600 md:text-base">
                  Upload data, review issues, track trends, and manage access
                  from one place.
                </p>
              </div>

              <div className="grid gap-3">
                {VALUE_PROPS.map((item) => (
                  <div
                    key={item.title}
                    className="rounded-[24px] border border-white/70 bg-white/70 p-4 shadow-[0_18px_38px_rgba(15,23,42,0.08)]"
                  >
                    <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white">
                      {item.icon}
                    </div>
                    <div className="text-sm font-bold text-slate-900">
                      {item.title}
                    </div>
                    <div className="mt-1 text-sm leading-6 text-slate-600">
                      {item.description}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </GlassPanel>

        <GlassPanel className="p-7 md:p-9">
          <div className="max-w-md">
            <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-500">
              Secure access
            </div>
            <h2 className="mt-2 font-display text-3xl font-extrabold text-slate-950">
              Sign in
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Use your authorized account to continue.
            </p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Email
                </span>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      setError("");
                    }}
                    placeholder="Email address"
                    className={`${inputClassName} pl-11`}
                    disabled={loading}
                  />
                </div>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Password
                </span>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setError("");
                    }}
                    placeholder="Password"
                    className={`${inputClassName} pl-11`}
                    disabled={loading}
                  />
                </div>
              </label>

              {error ? (
                <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p className="text-sm font-semibold">{error}</p>
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#0f172a,#14532d)] px-5 py-3.5 text-base font-bold text-white shadow-[0_20px_36px_rgba(15,23,42,0.22)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  "Sign in"
                )}
              </button>
            </form>

            <div className="mt-6 rounded-[24px] border border-slate-200/80 bg-slate-50/90 px-4 py-3 text-sm leading-6 text-slate-600">
              Sessions are scoped to your role and geography. National, state,
              district, and block reviewers will only see the data they are
              permitted to assess.
            </div>
          </div>
        </GlassPanel>
      </div>
    </PageBackdrop>
  );
}
