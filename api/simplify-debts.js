// simplify debts handler
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Use POST.' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) {}
  }

  const simplified = simplifyDebts(body?.debts || []);
  return res.status(200).json({ success: true, transactions: simplified });
}

// min cash flow algorithm
function simplifyDebts(initialDebts) {
  if (!initialDebts?.length) return [];

  const balances = {};
  for (const t of initialDebts) {
    if (!t.from || !t.to || t.from.toLowerCase() === t.to.toLowerCase() || Number(t.amount) <= 0.001) continue;
    balances[t.from] = (balances[t.from] || 0) - Number(t.amount);
    balances[t.to] = (balances[t.to] || 0) + Number(t.amount);
  }

  const debtors = [];
  const creditors = [];

  for (const [name, rawBal] of Object.entries(balances)) {
    const bal = Math.round(rawBal * 100) / 100;
    if (bal < -0.01) debtors.push({ name, netAmount: bal });
    else if (bal > 0.01) creditors.push({ name, netAmount: bal });
  }

  debtors.sort((a, b) => a.netAmount - b.netAmount);
  creditors.sort((a, b) => b.netAmount - a.netAmount);

  const simplified = [];
  while (debtors.length && creditors.length) {
    const debtor = debtors[0];
    const creditor = creditors[0];
    let amount = Math.min(-debtor.netAmount, creditor.netAmount);
    amount = Math.round(amount * 100) / 100;

    if (amount > 0.001) {
      simplified.push({ from: debtor.name, to: creditor.name, amount });
    }
    debtor.netAmount += amount;
    creditor.netAmount -= amount;

    if (Math.abs(debtor.netAmount) <= 0.01) debtors.shift();
    if (Math.abs(creditor.netAmount) <= 0.01) creditors.shift();
  }

  return simplified;
}
