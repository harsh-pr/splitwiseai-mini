// SplitWise.AI - Pure Firebase Service
// Directly connected ONLY to Firebase Authentication and Cloud Firestore.
// Local database and legacy file/localStorage storage are completely disconnected.

const ApiService = (function () {
  // Clear any legacy local mock database accounts from browser storage
  try {
    localStorage.removeItem('splitwise_local_registered_users');
    localStorage.removeItem('splitwise_local_bills');
    localStorage.removeItem('splitwise_active_user');
    localStorage.removeItem('splitwise_auth_token');
  } catch (_) {}

  let authInstance = null;
  let dbInstance = null;
  let firebaseReady = false;
  let initPromise = null;

  async function loadConfig() {
    if (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey && !window.FIREBASE_CONFIG.apiKey.includes('YOUR_FIREBASE_API_KEY')) {
      return window.FIREBASE_CONFIG;
    }
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const cfg = await res.json();
        if (cfg && cfg.apiKey) {
          window.FIREBASE_CONFIG = cfg;
          return cfg;
        }
      }
    } catch (_) {}
    return null;
  }

  async function initFirebase() {
    if (firebaseReady) return true;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      try {
        let cfg = window.FIREBASE_CONFIG;
        if (!cfg || !cfg.apiKey || cfg.apiKey.includes('YOUR_FIREBASE_API_KEY')) {
          cfg = await loadConfig();
        }
        if (typeof firebase !== 'undefined' && cfg && cfg.apiKey && !cfg.apiKey.includes('YOUR_FIREBASE_API_KEY')) {
          if (!firebase.apps.length) {
            firebase.initializeApp(cfg);
          }
          authInstance = firebase.auth();
          dbInstance = firebase.firestore();
          firebaseReady = true;
          console.log('✓ [SplitWise AI] Connected directly to Firebase (Cloud Firestore + Auth)');
          return true;
        }
      } catch (e) {
        console.error('[SplitWise AI] Firebase connection error:', e);
      } finally {
        initPromise = null;
      }
      return false;
    })();

    return initPromise;
  }

  // Attempt initial boot
  initFirebase();

  function isFirebaseReady() {
    return firebaseReady;
  }

  async function ensureFirebase() {
    if (!firebaseReady) {
      await initFirebase();
    }
    if (!firebaseReady) {
      throw new Error('Firebase is not connected. Please verify that your environment variables (FIREBASE_API_KEY, etc.) are set in Vercel.');
    }
  }

  // HTTP helper for Vercel Serverless AI endpoints (Receipt OCR & Split Chat)
  async function request(endpoint, options = {}) {
    const baseUrl = (window.SPLITWISE_CONFIG && window.SPLITWISE_CONFIG.API_BASE_URL) || '/api';
    const url = `${baseUrl}${endpoint}`;

    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    if (authInstance && authInstance.currentUser) {
      try {
        const token = await authInstance.currentUser.getIdToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
      } catch (_) {}
    }

    const config = {
      ...options,
      headers
    };

    try {
      const response = await fetch(url, config);
      const data = await response.json();

      if (!response.ok || data.success === false) {
        throw new Error(data.error || `HTTP error ${response.status}`);
      }

      return data;
    } catch (err) {
      console.error(`[API Error] ${endpoint}:`, err);
      throw err;
    }
  }

  // Greedy Min-Cash-Flow Debt Simplification Algorithm
  function runDebtSimplifier(initialDebts) {
    if (!initialDebts || !initialDebts.length) return [];

    const balances = {};
    for (const t of initialDebts) {
      if (!t.from || !t.to || t.from.toLowerCase() === t.to.toLowerCase() || Number(t.amount) <= 0.001) {
        continue;
      }
      balances[t.from] = (balances[t.from] || 0) - Number(t.amount);
      balances[t.to] = (balances[t.to] || 0) + Number(t.amount);
    }

    const debtors = [];
    const creditors = [];

    for (const [name, rawBal] of Object.entries(balances)) {
      const bal = Math.round(rawBal * 100) / 100;
      if (bal < -0.01) {
        debtors.push({ name, netAmount: bal });
      } else if (bal > 0.01) {
        creditors.push({ name, netAmount: bal });
      }
    }

    debtors.sort((a, b) => a.netAmount - b.netAmount);
    creditors.sort((a, b) => b.netAmount - a.netAmount);

    const simplified = [];

    while (debtors.length > 0 && creditors.length > 0) {
      const debtor = debtors[0];
      const creditor = creditors[0];

      let settleAmount = Math.min(-debtor.netAmount, creditor.netAmount);
      settleAmount = Math.round(settleAmount * 100) / 100;

      if (settleAmount > 0.001) {
        simplified.push({
          from: debtor.name,
          to: creditor.name,
          amount: settleAmount
        });
      }

      debtor.netAmount += settleAmount;
      creditor.netAmount -= settleAmount;

      if (Math.abs(debtor.netAmount) <= 0.01) debtors.shift();
      if (Math.abs(creditor.netAmount) <= 0.01) creditors.shift();
    }

    return simplified;
  }

  return {
    isFirebaseReady,

    // =========================================================================
    // AUTHENTICATION (100% Firebase Authentication & Firestore)
    // =========================================================================
    auth: {
      async register(name, email, password) {
        await ensureFirebase();
        const cleanName = (name || 'User').trim();
        const cleanEmail = (email || '').trim().toLowerCase();

        try {
          const userCred = await authInstance.createUserWithEmailAndPassword(cleanEmail, password);
          const fbUser = userCred.user;
          await fbUser.updateProfile({ displayName: cleanName });

          const userDoc = {
            uid: fbUser.uid,
            name: cleanName,
            email: cleanEmail,
            createdAt: Date.now()
          };

          await dbInstance.collection('users').doc(fbUser.uid).set(userDoc, { merge: true });

          return {
            id: fbUser.uid,
            uid: fbUser.uid,
            name: cleanName,
            email: cleanEmail
          };
        } catch (err) {
          console.error('[Firebase Auth Register Error]', err);
          throw new Error(err.message || 'Firebase Registration failed');
        }
      },

      async login(email, password) {
        await ensureFirebase();
        const cleanEmail = (email || '').trim().toLowerCase();

        try {
          const userCred = await authInstance.signInWithEmailAndPassword(cleanEmail, password);
          const fbUser = userCred.user;

          let displayName = fbUser.displayName;
          if (!displayName) {
            try {
              const docSnap = await dbInstance.collection('users').doc(fbUser.uid).get();
              if (docSnap.exists && docSnap.data().name) {
                displayName = docSnap.data().name;
              }
            } catch (_) {}
          }

          return {
            id: fbUser.uid,
            uid: fbUser.uid,
            name: displayName || cleanEmail.split('@')[0],
            email: cleanEmail
          };
        } catch (err) {
          console.error('[Firebase Auth Login Error]', err);
          throw new Error(err.message || 'Invalid Firebase email or password');
        }
      },

      async getMe() {
        if (!firebaseReady) {
          await initFirebase();
        }
        if (!isFirebaseReady()) return null;

        return new Promise((resolve) => {
          const unsubscribe = authInstance.onAuthStateChanged(async (fbUser) => {
            unsubscribe();
            if (fbUser) {
              let displayName = fbUser.displayName;
              if (!displayName) {
                try {
                  const docSnap = await dbInstance.collection('users').doc(fbUser.uid).get();
                  if (docSnap.exists && docSnap.data().name) {
                    displayName = docSnap.data().name;
                  }
                } catch (_) {}
              }

              resolve({
                id: fbUser.uid,
                uid: fbUser.uid,
                name: displayName || fbUser.email.split('@')[0],
                email: fbUser.email
              });
            } else {
              resolve(null);
            }
          });
        });
      },

      async logout() {
        if (authInstance) {
          await authInstance.signOut();
        }
      }
    },

    // =========================================================================
    // BILLS & SETTLEMENTS (100% Firebase Cloud Firestore)
    // =========================================================================
    bills: {
      async getAll() {
        await ensureFirebase();
        try {
          const currentUser = authInstance.currentUser;
          const uid = currentUser ? currentUser.uid : null;

          let query = dbInstance.collection('bills');
          if (uid) {
            query = query.where('userId', '==', uid);
          } else {
            query = query.where('userId', '==', 'guest');
          }

          const snapshot = await query.get();
          const bills = [];
          snapshot.forEach(doc => {
            const data = doc.data();
            bills.push({
              ...data,
              id: doc.id
            });
          });

          // Sort by creation date descending
          bills.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
          return bills;
        } catch (err) {
          console.error('[Firebase Firestore getAll Bills Error]', err);
          throw new Error('Failed to load bills from Firebase: ' + err.message);
        }
      },

      async create(billData) {
        await ensureFirebase();
        const currentUser = (authInstance && authInstance.currentUser) || null;
        const userId = currentUser ? currentUser.uid : 'guest';
        const userEmail = currentUser ? currentUser.email : '';

        const cleanDebts = (billData.debts || []).map(d => ({
          ...d,
          amount: Math.round(Number(d.amount || 0) * 100) / 100,
          settled: Boolean(d.settled)
        }));

        const isAllSettled = cleanDebts.length > 0 && cleanDebts.every(d => d.settled === true);

        const newBill = {
          ...billData,
          userId,
          userEmail,
          debts: cleanDebts,
          settled: isAllSettled,
          createdAt: Date.now()
        };

        try {
          const docRef = await dbInstance.collection('bills').add(newBill);
          return { ...newBill, id: docRef.id };
        } catch (err) {
          console.error('[Firebase Firestore create Bill Error]', err);
          throw new Error('Failed to save bill to Firebase: ' + err.message);
        }
      },

      async delete(billId) {
        if (!billId) return { success: false };
        await ensureFirebase();

        try {
          await dbInstance.collection('bills').doc(billId).delete();
          return { success: true };
        } catch (err) {
          console.error('[Firebase Firestore delete Bill Error]', err);
          throw new Error('Failed to delete bill from Firebase: ' + err.message);
        }
      },

      async updateDebtStatus(billId, personFrom = 'all', settled = true, upiId = '') {
        if (!billId) return { success: false };
        await ensureFirebase();

        try {
          const docRef = dbInstance.collection('bills').doc(billId);
          const snap = await docRef.get();
          if (!snap.exists) throw new Error('Bill not found in Firebase database');

          const data = snap.data();
          const debts = (data.debts || []).map(d => {
            const fromName = (d.from || '').trim().toLowerCase();
            const targetFrom = (personFrom || '').trim().toLowerCase();
            if (targetFrom === 'all' || !targetFrom || fromName === targetFrom) {
              return { ...d, settled: Boolean(settled) };
            }
            return d;
          });

          const allSettled = debts.length > 0 && debts.every(d => d.settled === true);
          const updatePayload = {
            debts,
            settled: allSettled
          };

          if (upiId && upiId.trim()) {
            updatePayload.upiId = upiId.trim();
          }

          await docRef.update(updatePayload);
          return { success: true };
        } catch (err) {
          console.error('[Firebase Firestore updateDebtStatus Error]', err);
          throw new Error('Failed to update debt status in Firebase: ' + err.message);
        }
      },

      async updateBillUpi(billId, upiId) {
        if (!billId || !upiId) return { success: false };
        await ensureFirebase();
        const cleanUpi = upiId.trim();

        try {
          await dbInstance.collection('bills').doc(billId).update({ upiId: cleanUpi });
          return { success: true };
        } catch (err) {
          console.error('[Firebase Firestore updateBillUpi Error]', err);
          throw new Error('Failed to update UPI ID in Firebase: ' + err.message);
        }
      }
    },

    // =========================================================================
    // AI SERVICES (Vercel Serverless Gemini Endpoints)
    // =========================================================================
    ai: {
      async analyzeReceipt(imageBase64, mimeType = 'image/jpeg', category = 'restaurant') {
        const res = await request('/analyze-bill', {
          method: 'POST',
          body: JSON.stringify({ imageBase64, mimeType, category })
        });
        return res.data;
      },

      async splitChat(prompt, items = [], participants = [], category = 'restaurant', payer = '', totalAmount = 0) {
        return await request('/split-chat', {
          method: 'POST',
          body: JSON.stringify({ prompt, items, participants, category, payer, totalAmount })
        });
      }
    },

    // =========================================================================
    // DEBT SIMPLIFICATION DSA
    // =========================================================================
    debts: {
      async simplify(debts = null) {
        return {
          success: true,
          transactions: runDebtSimplifier(debts || [])
        };
      },

      async settle(from, to, amount) {
        return {
          success: true,
          message: `Settled ₹${amount} from ${from} to ${to}`
        };
      }
    }
  };
})();
