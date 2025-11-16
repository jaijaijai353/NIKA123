# NIKA Backend

Node.js + Express + TypeScript backend for NIKA data analytics platform with full Firebase integration.

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Start production server
npm start

# Clean database and uploads
npm run clean
```

## Firebase Setup

### 1. Generate Service Account Key

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project (or create a new one)
3. Go to **Project Settings** > **Service Accounts**
4. Click **Generate New Private Key**
5. Save the JSON file as `firebaseServiceAccount.json` in the backend root directory

### 2. Configure Environment Variables

Create a `.env` file in the backend directory:

```env
# Firebase Admin Configuration
FIREBASE_SERVICE_ACCOUNT_PATH=./firebaseServiceAccount.json
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com

# Firebase Emulator (set to true for local development)
FIREBASE_USE_EMULATOR=false

# Demo Mode (set to true if Firebase is not configured)
DEMO_MODE=false

# Server Configuration
PORT=5000

# Firebase Functions Base URL (if using Cloud Functions)
FIREBASE_FUNCTIONS_BASE_URL=

# Gemini AI Configuration (optional, for enhanced insights)
GEMINI_API_KEY=your-gemini-api-key
```

### 3. Running with Firebase Emulators

To use Firebase Emulators for local development:

1. Install Firebase CLI: `npm install -g firebase-tools`
2. Login: `firebase login`
3. Initialize: `firebase init` (select Firestore, Storage, Functions, Emulators)
4. Start emulators: `firebase emulators:start`
5. Set `FIREBASE_USE_EMULATOR=true` in `.env`

## API Endpoints

- `GET /health` - Health check
- `GET /metrics` - Basic metrics
- `POST /upload` - Upload dataset file (local)
- `POST /api/insights` - Generate insights from Firebase Storage or local file
- `GET /api/insights/:id` - Fetch insights from Firestore
- `GET /datasets` - List all datasets
- `GET /summary/:id` - Get dataset summary
- `GET /preview/:id` - Get dataset preview
- `POST /api/ai-insights/search` - Auth required; AI search with Gemini+fallback
- `GET /api/ai-insights/history?limit=20` - Auth required; user-scoped history
- `POST /api/ai-insights/feedback` - Auth required; thumbs up/down feedback

## Firebase Integration

### Authentication
- Backend verifies Firebase ID tokens from `Authorization: Bearer <token>` header
- Token verification is optional (falls back to demo mode if not configured)

### Storage
- Files uploaded to Firebase Storage at path: `uploads/{uid}/{timestamp_filename}`
- Backend downloads files from Storage when processing insights

### Firestore
- Upload metadata saved to `/uploads` collection
- Insights saved to `/insights` collection
- User profiles saved to `/users` collection

## Gemini AI Integration

### Setup Gemini AI for Enhanced Insights

1. **Get Gemini API Key**
   - Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
   - Create a new API key
   - Copy the API key

2. **Add to Environment Variables**
   ```env
   GEMINI_API_KEY=your-gemini-api-key
   ```

3. **Benefits**
   - AI-powered data insights
   - Intelligent recommendations
   - Pattern detection and anomaly identification
   - Natural language explanations

**Note:** If Gemini API key is not configured, the system will use basic insights generation (still functional).

## Environment Variables

Copy `.env.example` to `.env` and configure:

- `FIREBASE_SERVICE_ACCOUNT_PATH` - Path to service account JSON file
- `FIREBASE_PROJECT_ID` - Firebase project ID
- `FIREBASE_STORAGE_BUCKET` - Firebase Storage bucket name
- `FIREBASE_USE_EMULATOR` - Use Firebase Emulators (true/false)
- `DEMO_MODE` - Run without Firebase (true/false)
- `PORT` - Server port (default: 5000)
- `GEMINI_API_KEY` - Google Gemini API key for AI insights (optional)
- `DEMO_MODE` - Set to `true` to disable external AI and Firebase
- `RATE_LIMIT_PER_MINUTE` - Per-user requests per minute (default 60)
- `RATE_LIMIT_PER_DAY` - Per-user requests per day (default 500)

## File Support

- CSV (.csv)
- Excel (.xlsx, .xls)
- JSON (.json)

## Database

- **SQLite**: Used for local metadata storage (fallback mode)
- **Firestore**: Used for Firebase-integrated mode (uploads, insights, users)

## Uploads

- **Local Mode**: Files stored in `./uploads/` directory
- **Firebase Mode**: Files stored in Firebase Storage at `uploads/{uid}/`

## Demo Mode

If Firebase is not configured, the backend runs in demo mode:
- Uses local file storage
- Uses SQLite for metadata
- All Firebase features are disabled
- No authentication required

## Local Demo Script

1. Start backend: `npm run dev` in `backend/`
2. Start frontend: `npm run dev` in `frontend/` and open `http://localhost:5173`
3. Upload a dataset using the UI
4. Open AI Insights and ask a question in the search bar
5. View AI History in the panel and submit feedback
6. Check backend metrics at `http://localhost:5000/metrics`