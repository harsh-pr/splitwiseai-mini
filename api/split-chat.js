// split chat endpoint
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) {}
  }
  body = body || {};

  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey.startsWith('YOUR_')) {
    return res.status(500).json({
      success: false,
      error: 'GEMINI_API_KEY is not configured in Vercel project environment variables.'
    });
  }

  const {
    prompt: userPrompt = '',
    items = [],
    participants = [],
    category = 'restaurant',
    payer = '',
    totalAmount = 0
  } = body;

  if (!userPrompt.trim()) {
    return res.status(400).json({ success: false, error: 'Missing prompt field.' });
  }

  const cat = (category || 'restaurant').toLowerCase().trim();
  const cleanParticipants = (participants || []).filter(p => p && p.trim() && p.toLowerCase() !== 'you');

  const sysPrompt = `You are SplitWise AI's intelligent expense and split management engine.
Selected expense category: ${cat}.
Current line items: ${JSON.stringify(items)}
Current participants: ${JSON.stringify(cleanParticipants)}
Current designated payer: ${payer || '(Not set yet)'}
Total target bill amount: ₹${Number(totalAmount || 0).toFixed(2)}

User instruction: "${userPrompt}"

CRITICAL RULES:
1. STRICT PROHIBITION ON DUMMY / FILLER ITEMS:
   - NEVER create line items named 'Remaining Bill Amount', 'Remaining', 'Balance', 'Others', or 'Adjustment'.
   - Every line item MUST correspond to a genuine dish, grocery product, or utility stay share.
2. REPLACING PLACEHOLDERS VS ACCUMULATING:
   - If current items are empty or a generic placeholder (e.g. 'Bill Total', 'Shared Expense'), replace with actual specified dishes.
   - For duration splits (e.g. 'Harsh stayed 15 days, Sarthak 15 days'), replace previous duration items with fresh calculated items summing to total ₹${Number(totalAmount || 0).toFixed(2)}.
3. PARTICIPANTS:
   - NEVER invent 'You', 'User', or 'Me' unless user explicitly wrote 'me' or 'I'.
   - If user explicitly lists who to split between (e.g., 'split between sarthak and hrudayesh', 'split amongst sarthak and hrudayesh'), 'updatedParticipants' MUST strictly be only those named people: ['Sarthak', 'Hrudayesh'].
   - If user says 'add X' or 'also include X', keep current participants and append X.
   - In each item's 'assignedTo' array, list the exact participants sharing that item.
4. PAYER:
   - If user mentions who paid (e.g. 'Sarthak paid'), set 'payer' to that person's exact name.

Respond STRICTLY with raw JSON matching this structure without markdown fences:
{
  "updatedItems": [
    { "name": "Dish or Stay Share", "quantity": 1, "price": 100.0, "assignedTo": ["Name"] }
  ],
  "updatedParticipants": ["Name1", "Name2"],
  "payer": "Name",
  "message": "Friendly confirmation message explaining what was updated",
  "directSplitDetected": false
}`;

  const payload = {
    contents: [
      {
        parts: [{ text: sysPrompt }]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json'
    }
  };

  const MODELS = [
    'gemini-flash-lite-latest',
    'gemini-2.5-flash',
    'gemini-1.5-flash',
    'gemini-flash-latest'
  ];

  let rawResponseText = null;
  let lastError = null;

  for (const model of MODELS) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const apiRes = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (apiRes.ok) {
        const json = await apiRes.json();
        const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          rawResponseText = text;
          break;
        }
      } else {
        const errText = await apiRes.text();
        lastError = new Error(`Model ${model} returned ${apiRes.status}: ${errText}`);
      }
    } catch (e) {
      lastError = e;
    }
  }

  if (!rawResponseText) {
    return res.status(500).json({
      success: false,
      error: 'Split chat processing failed across all Gemini models: ' + (lastError ? lastError.message : 'Unknown error')
    });
  }

  try {
    let cleaned = rawResponseText.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '').trim();
    }
    const parsed = JSON.parse(cleaned);

    const cleanItems = (parsed.updatedItems || items).map(it => ({
      name: (it.name || 'Item').trim(),
      quantity: Math.max(1, parseInt(it.quantity || 1, 10)),
      price: Math.round(Number(it.price || 0) * 100) / 100,
      assignedTo: Array.isArray(it.assignedTo) ? it.assignedTo : []
    }));

    return res.status(200).json({
      success: true,
      updatedItems: cleanItems,
      updatedParticipants: parsed.updatedParticipants || participants,
      payer: parsed.payer || payer,
      message: parsed.message || 'Updated split according to your instructions.',
      directSplitDetected: Boolean(parsed.directSplitDetected)
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to parse AI response: ' + err.message });
  }
}
