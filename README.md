# SplitWise.AI

Smart expense-splitting application with OCR receipt parsing, conversational AI split chat, debt simplification, and UPI QR payments.

## Stack
- Frontend: Vanilla HTML, CSS, JavaScript
- Backend: Vercel Serverless Functions (`/api/*`)
- Database & Auth: Firebase Cloud Firestore & Firebase Authentication
- AI: Google Gemini API

## Setup & Deployment

### 1. Firebase Setup
1. Create a project in [Firebase Console](https://console.firebase.google.com/).
2. Enable **Authentication** (Email/Password).
3. Create a **Firestore Database** and in the **Rules** tab, set:
   ```javascript
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if true;
       }
     }
   }
   ```

### 2. Vercel Deployment
1. Import repository into [Vercel](https://vercel.com/).
2. Add Environment Variables:
   - `GEMINI_API_KEY`
   - `FIREBASE_API_KEY`
   - `FIREBASE_AUTH_DOMAIN`
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_STORAGE_BUCKET`
   - `FIREBASE_MESSAGING_SENDER_ID`
   - `FIREBASE_APP_ID`
   - `FIREBASE_MEASUREMENT_ID`
3. Deploy.

### 3. Local Development
```bash
npx vercel dev
```
