import { API_BASE } from "./config";
import { auth } from "./lib/firebase";

export const apiFetch = async (url: string, options: RequestInit = {}) => {
  if (!auth.currentUser) {
    throw new Error("Session expired. Please log in again.");
  }

  const token = await auth.currentUser.getIdToken();

  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.message || "API Error");
  }

  return data;
};
