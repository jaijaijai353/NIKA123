import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth, connectAuthEmulator } from 'firebase/auth';
import { getStorage, FirebaseStorage, connectStorageEmulator } from 'firebase/storage';
import { getFirestore, Firestore, connectFirestoreEmulator } from 'firebase/firestore';

// Firebase configuration from environment variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};

// Check if Firebase is configured
const isFirebaseConfigured = 
  firebaseConfig.apiKey && 
  firebaseConfig.authDomain && 
  firebaseConfig.projectId;

// Initialize Firebase app (only if not already initialized)
let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let storage: FirebaseStorage | null = null;
let db: Firestore | null = null;

try {
  if (isFirebaseConfigured) {
    const existingApps = getApps();
    if (existingApps.length === 0) {
      app = initializeApp(firebaseConfig);
    } else {
      app = existingApps[0];
    }

    if (app) {
      auth = getAuth(app);
      storage = getStorage(app);
      db = getFirestore(app);

      // Connect to emulators if enabled
      const useEmulator = import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true';
      
      if (useEmulator && auth && storage && db) {
        try {
          // Only connect if not already connected
          if (!(auth as any)._delegate?._config?.emulator) {
            connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
          }
          if (!(storage as any)._delegate?._host?.includes('localhost')) {
            connectStorageEmulator(storage, 'localhost', 9199);
          }
          if (!(db as any)._delegate?._settings?.host?.includes('localhost')) {
            connectFirestoreEmulator(db, 'localhost', 8080);
          }
          console.log('✅ Connected to Firebase Emulators');
        } catch (error) {
          console.warn('⚠️ Emulator connection error (may already be connected):', error);
        }
      }
    }
  } else {
    console.warn('Firebase disabled, using demo/local mode');
  }
} catch (error) {
  console.warn('⚠️ Firebase initialization error, using demo mode:', error);
  // Ensure services are null if initialization fails
  app = null;
  auth = null;
  storage = null;
  db = null;
}

export { app, auth, storage, db, isFirebaseConfigured };

