import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

if (!getApps().length) {
  const isGoogleManagedRuntime = Boolean(
    process.env.K_SERVICE || process.env.FUNCTION_TARGET
  );

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    // Explicit JSON string (Render, Docker, etc.)
    initializeApp({
      credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)),
    });
  } else if (
    process.env.GOOGLE_APPLICATION_CREDENTIALS &&
    !isGoogleManagedRuntime
  ) {
    // Local dev: path to key file
    initializeApp({
      credential: cert(process.env.GOOGLE_APPLICATION_CREDENTIALS),
    });
  } else {
    // Cloud Functions: Application Default Credentials (automatic, no key needed)
    initializeApp();
  }
}

export const adminAuth = getAuth();
export const db = getFirestore();
export const storageBucket = getStorage().bucket();
export { FieldValue };
