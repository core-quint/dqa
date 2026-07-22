import { onRequest } from "firebase-functions/v2/https";
import app from "./app";

// Single HTTP Cloud Function wrapping the entire Express app.
// Firebase Hosting rewrites /api/** to this function.
export const api = onRequest({ invoker: "public", timeoutSeconds: 90, memory: "512MiB" }, app);
