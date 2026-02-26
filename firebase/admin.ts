import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

// Initialize Firebase Admin SDK
function initFirebaseAdmin() {
  const apps = getApps();

  const readEnv = (key: string) => {
    const raw = process.env[key];
    if (!raw) return undefined;
    const trimmed = raw.trim();
    return trimmed.replace(/^['"]|['"]$/g, "");
  };

  if (!apps.length) {
    const projectId = readEnv("FIREBASE_PROJECT_ID");
    const clientEmail = readEnv("FIREBASE_CLIENT_EMAIL");
    const privateKeyRaw = readEnv("FIREBASE_PRIVATE_KEY");
    const privateKey = privateKeyRaw?.replace(/\\n/g, "\n");

    const requiredEnv = {
      FIREBASE_PROJECT_ID: projectId,
      FIREBASE_CLIENT_EMAIL: clientEmail,
      FIREBASE_PRIVATE_KEY: privateKey,
    };

    const providedCount = Object.values(requiredEnv).filter(Boolean).length;
    const missingKeys = Object.entries(requiredEnv)
      .filter(([, value]) => !value)
      .map(([key]) => key);

    if (providedCount !== 3) {
      throw new Error(
        `Firebase Admin is not configured. Missing env var(s): ${missingKeys.join(", ")}. ` +
          "Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in .env.local, then restart the server."
      );
    }

    initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  }

  return {
    auth: getAuth(),
    db: getFirestore(),
  };
}

export const { auth, db } = initFirebaseAdmin();
