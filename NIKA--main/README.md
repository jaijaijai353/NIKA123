# NIKA - AI-Powered Data Analytics Platform

A comprehensive full-stack data analytics platform with Firebase integration, React frontend, and Node.js backend.

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm
- Firebase account (optional, for cloud features)
- Firebase CLI (optional, for emulators)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd NIKA--main
   ```

2. **Backend Setup**
   ```bash
   cd backend
   npm install
   # Copy .env.example to .env and configure
   npm run dev
   ```

3. **Frontend Setup**
   ```bash
   cd frontend
   npm install
   # Copy .env.example to .env and configure
   npm run dev
   ```

## 🔥 Firebase Setup

### 1. Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project
3. Enable **Authentication**, **Firestore Database**, and **Storage**

### 2. Generate Service Account Key (Backend)

1. Go to **Project Settings** > **Service Accounts**
2. Click **Generate New Private Key**
3. Save as `firebaseServiceAccount.json` in `backend/` directory

### 3. Get Firebase Config (Frontend)

1. Go to **Project Settings** > **General**
2. Scroll to "Your apps" and click web icon (`</>`)
3. Copy the configuration object

### 4. Configure Environment Variables

**Backend** (`backend/.env`):
```env
FIREBASE_SERVICE_ACCOUNT_PATH=./firebaseServiceAccount.json
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
FIREBASE_USE_EMULATOR=false
DEMO_MODE=false
PORT=5000

# Gemini AI (optional - for enhanced insights)
GEMINI_API_KEY=your-gemini-api-key
```

**Frontend** (`frontend/.env`):
```env
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
VITE_FIREBASE_APP_ID=your-app-id
VITE_USE_FIREBASE_EMULATOR=false
VITE_API_URL=http://localhost:5000
```

### 5. Deploy Security Rules

```bash
# Deploy Firestore rules
firebase deploy --only firestore:rules

# Deploy Storage rules
firebase deploy --only storage:rules
```

## 🧪 Firebase Emulators (Local Development)

1. **Install Firebase CLI**
   ```bash
   npm install -g firebase-tools
   firebase login
   ```

2. **Initialize Firebase** (if not already done)
   ```bash
   firebase init
   # Select: Firestore, Storage, Functions, Emulators
   ```

3. **Start Emulators**
   ```bash
   firebase emulators:start
   ```

4. **Configure for Emulators**
   - Backend: Set `FIREBASE_USE_EMULATOR=true` in `.env`
   - Frontend: Set `VITE_USE_FIREBASE_EMULATOR=true` in `.env`

## 📁 Project Structure

```
NIKA--main/
├── backend/                 # Node.js + Express + TypeScript
│   ├── src/
│   │   └── firebase/
│   │       └── admin.ts    # Firebase Admin SDK
│   ├── server.ts           # Main Express server
│   ├── package.json
│   └── .env.example
├── frontend/               # React + TypeScript + Vite
│   ├── src/
│   │   ├── components/
│   │   │   ├── Auth.tsx   # Firebase Authentication
│   │   │   └── FileUpload.tsx
│   │   └── firebase/
│   │       └── clientApp.ts # Firebase Client SDK
│   ├── package.json
│   └── .env.example
├── functions/              # Firebase Cloud Functions (optional)
│   ├── src/
│   │   └── index.ts
│   └── package.json
├── firebase.json           # Firebase configuration
├── firestore.rules         # Firestore security rules
├── storage.rules           # Storage security rules
└── README.md
```

## 🎯 Features

### AI-Powered Insights (Gemini AI)
- **Intelligent Data Analysis**: Google Gemini AI generates comprehensive insights
- **Smart Recommendations**: AI-powered suggestions for data improvement
- **Pattern Detection**: Automatic identification of trends and anomalies
- **Natural Language Explanations**: Easy-to-understand insights in plain English
- **Fallback Mode**: Works without API key using basic insights

### Authentication
- Email/Password sign-up and sign-in
- Google OAuth authentication
- User profile management in Firestore

### File Upload
- **Logged In**: Files uploaded to Firebase Storage
- **Not Logged In**: Files processed locally
- Automatic fallback to local mode

### Data Processing
- Backend downloads files from Firebase Storage
- Generates insights and saves to Firestore
- Returns processed data to frontend

### Storage
- Files stored at: `uploads/{uid}/{timestamp_filename}`
- Metadata saved to Firestore `/uploads` collection
- Insights saved to Firestore `/insights` collection

## 🔒 Security Rules

### Firestore Rules
- Users can only read/write their own data
- Uploads and insights are user-scoped
- See `firestore.rules` for details

### Storage Rules
- Users can only access files in their own `uploads/{uid}/` folder
- See `storage.rules` for details

## 🚀 Deployment

### Deploy Cloud Functions (Optional)

```bash
cd functions
npm install
npm run build
firebase deploy --only functions
```

### Deploy Frontend

```bash
cd frontend
npm run build
# Deploy dist/ to your hosting provider
```

### Deploy Backend

Deploy to your preferred Node.js hosting (Heroku, Railway, etc.)

## 🧪 Demo Mode

If Firebase is not configured, the app runs in **demo mode**:
- No authentication required
- Files processed locally
- SQLite used for metadata
- All features work without Firebase

## 🤖 Gemini AI Setup (Optional)

To enable AI-powered insights:

1. **Get API Key**
   - Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
   - Create a new API key
   - Copy the key

2. **Add to Backend `.env`**
   ```env
   GEMINI_API_KEY=your-api-key-here
   ```

3. **Restart Backend**
   - The server will automatically use Gemini AI for insights
   - Check `/health` endpoint to verify: `"gemini": "configured"`

**Benefits:**
- More intelligent and contextual insights
- Better pattern recognition
- Actionable recommendations
- Natural language explanations

## 📝 Environment Variables

See `.env.example` files in `backend/` and `frontend/` directories for all available options.

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📄 License

MIT License - Created by Jai Narula

---

**NIKA** - Transforming data into insights with AI-powered analytics and Firebase cloud integration.

