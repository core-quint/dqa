import type { AuthState } from "../components/dqa/LoginPage";

// Insights is temporarily available only to this account.
export function canUseInsights(auth: Pick<AuthState, "email"> | null | undefined): boolean {
  return auth?.email.trim().toLowerCase() === "admin@dqa.gov.in";
}
