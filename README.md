# SplitWise.AI 🧾⚡

SplitWise.AI is a smart expense-splitting and receipt-analysis application with automated OCR parsing, AI conversational splitting, greedy cash-flow debt simplification, and UPI QR payments.

Now powered by **Firebase Cloud Firestore & Authentication** and optimized for seamless deployment on **Vercel**!

---

## 🚀 Live Architecture

- **Hosting & Serverless Functions:** [Vercel](https://vercel.com/)
- **Database & Authentication:** [Firebase Cloud Firestore](https://firebase.google.com/) + Firebase Auth
- **AI OCR & Smart Chat:** [Google Gemini API](https://aistudio.google.com/) (`gemini-flash-lite`, `gemini-2.5-flash`)
- **Algorithms:** Greedy Minimum Cash-Flow Debt Simplification (DSA with Net Balances)

---

## 🛠️ Setup Guide

### Step 1: Set up Firebase (Database & Auth)

1. Open the [Firebase Console](https://console.firebase.google.com/) and create a new project (e.g. `splitwise-ai`).
2. In the project dashboard, click the Web icon `</>` to register a web app.
3. Copy the `firebaseConfig` object and paste it into [`web/firebase-config.js`](file:///c:/Users/harsh/Desktop/Project/splitwise-miniproject/web/firebase-config.js):
   ```javascript
   window.FIREBASE_CONFIG = {
     apiKey: "YOUR_API_KEY",
     authDomain: "your-app.firebaseapp.com",
     projectId: "your-app",
     storageBucket: "your-app.appspot.com",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abcdef"
   };
   ```
4. **Enable Authentication:**
   - In Firebase Console, go to **Build** -> **Authentication** -> **Sign-in method**.
   - Enable **Email/Password**.
5. **Enable Cloud Firestore:**
   - In Firebase Console, go to **Build** -> **Firestore Database** -> **Create database**.
   - Select **Start in test mode** (allows read/write during development) or apply security rules.

---

### Step 2: Deploy to Vercel

1. Go to [Vercel](https://vercel.com/) and click **"Add New Project"**.
2. Import your GitHub repository (`harsh-pr/splitwiseai-mini`).
3. Under **Environment Variables**, add:
   - `GEMINI_API_KEY` = *Your Google Gemini API Key from Google AI Studio*
4. Click **Deploy**! 🚀
5. Vercel automatically deploys the frontend and hooks up the `/api/*` serverless functions.

---

### Step 3: Run Locally (Optional)

You can run the web app locally using any static web server or Vercel CLI:
```bash
# Using Vercel CLI (runs frontend + serverless functions locally)
npx vercel dev

# Or with a simple HTTP server (runs in offline/client mode)
npx serve web
```

---

## 📁 Project Structure

```text
├── api/                   # Vercel Serverless Functions
│   ├── analyze-bill.js    # Gemini Vision receipt OCR analysis
│   ├── split-chat.js      # Gemini conversational split chat
│   ├── simplify-debts.js  # DSA Min-Cash-Flow engine
│   └── health.js          # Deployment health check endpoint
├── web/                   # Web Application
│   ├── index.html         # Main dashboard, wizard, and OCR scanner
│   ├── history.html       # Split history, settlement tracking & analytics
│   ├── style.css          # Modern dark/light UI styling
│   ├── app.js             # Main page client logic & interactive wizard
│   ├── history.js         # History page client logic
│   ├── firebase-config.js # Firebase Cloud Firestore & Auth credentials
│   ├── config.js          # Frontend configuration
│   └── api-service.js     # Unified Firebase & API bridge
├── vercel.json            # Vercel routing and serverless configuration
├── package.json           # Project metadata and npm scripts
└── src/                   # Original Java core backend (kept for reference)
```
