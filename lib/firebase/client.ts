import { getApp, getApps, initializeApp } from "firebase/app";
import {
  Auth,
  getAuth,
  GoogleAuthProvider,
} from "firebase/auth";

export type FirebaseClient = {
  auth: Auth;
  googleProvider: GoogleAuthProvider;
};

let cachedClient: FirebaseClient | null | undefined;

function firebaseConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
}

export function isFirebaseClientConfigured() {
  const config = firebaseConfig();
  return Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
}

export function getFirebaseClient(): FirebaseClient | null {
  if (cachedClient !== undefined) return cachedClient;

  const config = firebaseConfig();

  if (!config.apiKey || !config.authDomain || !config.projectId || !config.appId) {
    cachedClient = null;
    return cachedClient;
  }

  const app = getApps().length > 0 ? getApp() : initializeApp(config);
  const googleProvider = new GoogleAuthProvider();
  googleProvider.setCustomParameters({ prompt: "select_account" });

  cachedClient = {
    auth: getAuth(app),
    googleProvider,
  };

  return cachedClient;
}
