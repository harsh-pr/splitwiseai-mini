// health check endpoint
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.startsWith('YOUR_'));

  return res.status(200).json({
    status: 'ok',
    platform: 'Vercel Serverless',
    database: 'Firebase Cloud Firestore',
    geminiConfigured,
    timestamp: Date.now()
  });
}
