# 🤖 Gemini AI Setup Guide

## Step 1: Get Your Gemini API Key

### Option A: Google AI Studio (Recommended)
1. **Visit**: https://makersuite.google.com/app/apikey
2. **Sign in** with your Google account
3. **Click** "Create API Key" or "Get API Key"
4. **Copy** the API key (it will look like: `AIzaSy...`)

### Option B: Google Cloud Console
1. **Visit**: https://console.cloud.google.com/
2. **Create a new project** (or select existing)
3. **Enable** "Generative Language API"
4. **Go to** "APIs & Services" > "Credentials"
5. **Create** API Key
6. **Copy** the API key

## Step 2: Add API Key to Backend

### Create `.env` file in backend directory:

**Location**: `NIKA--main/backend/.env`

**Create the file:**
```bash
# In the backend directory
cd "C:\Users\hp\Downloads\NIKA--main (3)\NIKA--main\backend"
```

**Add this content:**
```env
# Gemini AI Configuration
GEMINI_API_KEY=your-api-key-here

# Server Configuration
PORT=5000

# Demo Mode (set to true if Firebase is not configured)
DEMO_MODE=true
```

**Replace `your-api-key-here` with your actual API key**

Example:
```env
GEMINI_API_KEY=AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz1234567
```

## Step 3: Restart Backend Server

1. **Stop** the current backend server (Ctrl+C)
2. **Restart** it:
   ```bash
   npm run dev
   ```
   or
   ```bash
   npm start
   ```

## Step 4: Verify It's Working

1. **Check health endpoint**: http://localhost:5000/health
2. **Look for**: `"gemini": "configured"` in the response
3. **Upload a file** through the frontend
4. **Check console** for: `🤖 Using Gemini AI for insights generation...`

## Troubleshooting

### API Key Not Working?
- ✅ Make sure there are **no spaces** around the `=` sign
- ✅ Make sure the API key is **not in quotes**
- ✅ Check that the `.env` file is in the **backend** directory
- ✅ **Restart** the server after adding the key

### Still Using Basic Insights?
- Check backend console for errors
- Verify API key is correct
- Check `/health` endpoint shows `"gemini": "configured"`

## Security Note

⚠️ **Never commit your `.env` file to Git!**
- The `.env` file is already in `.gitignore`
- Keep your API key secret
- Don't share it publicly

## Free Tier Limits

Google Gemini API has a free tier:
- **60 requests per minute**
- **1,500 requests per day**
- Perfect for development and testing!

For production, consider upgrading your plan.

