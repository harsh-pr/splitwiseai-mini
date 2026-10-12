// Vercel Serverless Function: Receipt OCR Analysis via Google Gemini Vision API
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

  const { imageBase64, mimeType = 'image/jpeg', category = 'restaurant' } = body;
  if (!imageBase64) {
    return res.status(400).json({ success: false, error: 'Missing imageBase64 field.' });
  }

  const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  const cat = (category || 'restaurant').toLowerCase().trim();

  const prompt = `You are an expert OCR and financial receipt parsing engine.
Selected expense category: ${cat}.
Input can be a printed receipt, handwritten bill slip, digital invoice, utility bill, or app screenshot (e.g. GPay, PhonePe, Paytm, Blinkit, Zepto, DMart, BookMyShow, BESCOM/MSEDCL electricity bill).

EXTRACTION RULES BY CATEGORY:
1. 'merchantName': Merchant, store, supermarket (e.g. 'D Mart', 'Reliance Fresh', 'Blinkit'), restaurant, utility board, or UPI recipient name.
2. 'date': Transaction or bill issue date in YYYY-MM-DD format (if missing, use '${new Date().toISOString().split('T')[0]}').
3. 'items': Array of all purchased or billed line items:
   - For grocery/mart receipts (like D-Mart): Extract each purchased product:
     * 'name': Product name from Particulars column.
     * 'quantity': Count from Qty column (integer, default 1).
     * 'price': Final charged line total from Value or Amount column after discounts.
   - For 'restaurant': All dishes, beverages, starters.
   - For 'utilities' (Electricity, Water, Gas, Broadband, Flat Maintenance):
     * Specialized support for Indian Electricity & Utility Bills (e.g. MSEDCL / Mahavitaran, BESCOM, Tata Power, Adani Electricity, BSES, Torrent, UPPCL, TNEB):
     * MULTILINGUAL (MARATHI / HINDI) KEY MAPPINGS:
       - 'ग्राहक नाव' / 'Customer Name' -> consumerName
       - 'ग्राहक क्रमांक' / 'उपभोक्ता संख्या' / Consumer Number -> consumerNumber
       - 'एकूण वापर' / 'युनिट' / Total Units -> unitsConsumed
       - 'देयक महिना' / 'बिल माह' / Billing Month -> billingMonth
       - 'देयक दिनांक' / Bill Date -> date
       - 'देय दिनांक' / Due Date -> dueDate
       - 'billingDays': Integer days covered by bill (e.g. 30, 31, 28). Default to 30.
       - 'billingPeriod': Short summary (e.g. 'September 2026 (30 Days)').
       - 'देयक रक्कम' / 'पूर्णांक देयक' / 'Net Payable' -> 'total'.
       - 'स्थिर आकार' / 'स्थायी प्रभार' -> 'Fixed Charges (स्थिर आकार)'
       - 'वीज आकार' / 'ऊर्जा प्रभार' -> 'Energy Charges (वीज आकार)'
       - 'वहन आकार' -> 'Wheeling Charges (वहन आकार)'
       - 'इंधन समायोजन आकार' (FAC) -> 'Fuel Adjustment Charges (इंधन समायोजन)'
       - 'वीज शुल्क' -> 'Electricity Duty (वीज शुल्क 16%)'
     * CRITICAL LINE ITEM ACCURACY RULES FOR UTILITIES:
       1. Every item price MUST be strictly positive (> 0).
       2. NEVER include zero-rupee rows. Omit them.
       3. NEVER output negative price items. Absorbed net rounding into Energy Charges.
     * Specialized support for Wi-Fi & Broadband Invoices (e.g. Tata Play Fiber, JioFiber, Airtel Xstream, ACT Fibernet):
       - 'merchantName': Provider name.
       - 'total': Final payable amount.
       - 'items': Base broadband plan charge under items.
       - 'tax': IGST or CGST+SGST amount.
       - 'taxInclusive': false if tax added on top, true if included.
   - For 'entertainment' (Movie tickets, Events, Concerts, BookMyShow, PVR, INOX):
     * NEVER include Booking Charge, Convenience Fee, or GST in items array!
     * Sum up booking fees and platform charges into 'tip'.
     * Sum up taxes (GST, CGST, SGST) into 'tax'.
   - For UPI Payment Screenshots (GPay, PhonePe, Paytm):
     * 'total': Transaction amount paid.
     * 'merchantName': Recipient person or business.
     * 'items': Single lump sum item named after recipient.
4. 'subtotal': Raw sum of line items before taxes.
5. 'tax': Tax or GST printed on receipt.
6. 'taxInclusive': Boolean. In India, most retail, restaurant, and utility bills already include taxes. Set true if total includes items sum.
7. 'tip': Service charge, delivery charge, packaging fee, or booking/convenience fee.
8. 'total': Final grand total payable.
9. 'confidence': OCR accuracy estimation (e.g. '95%').

Respond STRICTLY with raw JSON matching this structure without markdown fences:
{
  "merchantName": "Store / Merchant / Utility Board",
  "date": "YYYY-MM-DD",
  "category": "${cat}",
  "consumerName": "",
  "consumerNumber": "",
  "unitsConsumed": "",
  "billingMonth": "",
  "billingDays": 30,
  "billingPeriod": "Monthly Bill (30 Days)",
  "items": [
    { "name": "Item name", "quantity": 1, "price": 100.0 }
  ],
  "subtotal": 100.0,
  "tax": 0.0,
  "taxInclusive": true,
  "tip": 0.0,
  "total": 100.0,
  "confidence": "95%"
}`;

  const payload = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: mimeType || 'image/jpeg',
              data: cleanBase64
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
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
      error: 'Receipt OCR analysis failed across all Gemini models: ' + (lastError ? lastError.message : 'Unknown error')
    });
  }

  try {
    let cleaned = rawResponseText.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '').trim();
    }
    const parsed = JSON.parse(cleaned);

    const items = (parsed.items || []).map(it => ({
      name: (it.name || 'Item').trim(),
      quantity: Math.max(1, parseInt(it.quantity || 1, 10)),
      price: Math.round(Number(it.price || 0) * 100) / 100,
      unitPrice: Math.round((Number(it.price || 0) / Math.max(1, parseInt(it.quantity || 1, 10))) * 100) / 100,
      assignedTo: []
    }));

    const total = Number(parsed.total || 0);
    const tax = Number(parsed.tax || 0);
    const tip = Number(parsed.tip || 0);

    const data = {
      merchantName: parsed.merchantName || 'Scanned Bill',
      date: parsed.date || new Date().toISOString().split('T')[0],
      category: parsed.category || cat,
      consumerName: parsed.consumerName || '',
      consumerNumber: parsed.consumerNumber || '',
      unitsConsumed: parsed.unitsConsumed || '',
      billingMonth: parsed.billingMonth || '',
      billingDays: parsed.billingDays || 30,
      billingPeriod: parsed.billingPeriod || 'Monthly Bill (30 Days)',
      items: items.length ? items : [{ name: parsed.merchantName || 'Total Bill', quantity: 1, price: total, assignedTo: [] }],
      tax: tax,
      taxInclusive: parsed.taxInclusive !== false,
      tip: tip,
      total: total,
      confidence: parsed.confidence || '95%'
    };

    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to parse Gemini response: ' + err.message });
  }
}
