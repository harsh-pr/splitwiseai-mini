// firebase config endpoint
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  return res.status(200).json({
    apiKey: process.env.FIREBASE_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || 'splitwiseai-miniproject.firebaseapp.com',
    projectId: process.env.FIREBASE_PROJECT_ID || 'splitwiseai-miniproject',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'splitwiseai-miniproject.firebasestorage.app',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '308774993485',
    appId: process.env.FIREBASE_APP_ID || '1:308774993485:web:bbb33fca860a2a4a24e604',
    measurementId: process.env.FIREBASE_MEASUREMENT_ID || 'G-L7BFNLCFFJ'
  });
}
