import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

// Check if Firebase is configured
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './firebaseServiceAccount.json';
const projectId = process.env.FIREBASE_PROJECT_ID || '';
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || '';
const demoMode = process.env.DEMO_MODE === 'true' || !fs.existsSync(serviceAccountPath);

let adminApp: admin.app.App | null = null;
let db: admin.firestore.Firestore | null = null;
let bucket: any = null; // Firebase Storage Bucket type

if (!demoMode && projectId && storageBucket) {
  try {
    // Check if service account file exists
    const fullPath = path.isAbsolute(serviceAccountPath)
      ? serviceAccountPath
      : path.join(__dirname, '..', '..', serviceAccountPath);

    if (!fs.existsSync(fullPath)) {
      console.warn('⚠️ Firebase service account file not found, using demo mode');
      console.warn(`   Expected path: ${fullPath}`);
    } else {
      // Initialize Firebase Admin
      const serviceAccount = JSON.parse(fs.readFileSync(fullPath, 'utf8'));

      // Check if app already initialized
      try {
        adminApp = admin.app();
      } catch {
        adminApp = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
          projectId: projectId || serviceAccount.project_id,
          storageBucket: storageBucket || `${serviceAccount.project_id}.appspot.com`,
        });
      }

      db = admin.firestore();
      bucket = admin.storage().bucket();

      // Connect to emulators if enabled
      const useEmulator = process.env.FIREBASE_USE_EMULATOR === 'true';
      if (useEmulator) {
        process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
        process.env.FIREBASE_STORAGE_EMULATOR_HOST = 'localhost:9199';
        process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
        console.log('✅ Connected to Firebase Emulators');
      }

      console.log('✅ Firebase Admin initialized');
    }
  } catch (error) {
    console.warn('⚠️ Firebase Admin initialization failed, using demo mode:', error);
  }
} else {
  console.warn('⚠️ Firebase disabled, using demo/local mode');
}

export { adminApp, admin, db, bucket, demoMode };

