const ApiService = (function () {
  let authInstance = null;
  let dbInstance = null;
  let firebaseReady = false;
  let initPromise = null;

  // load firebase config from vercel api
  async function loadConfig() {
    if (window.FIREBASE_CONFIG?.apiKey && !window.FIREBASE_CONFIG.apiKey.includes('YOUR_')) {
      return window.FIREBASE_CONFIG;
    }
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const cfg = await res.json();
        if (cfg?.apiKey) {
          window.FIREBASE_CONFIG = cfg;
          return cfg;
        }
      }
    } catch (_) {}
    return null;
  }

  // init firebase
  async function initFirebase() {
    if (firebaseReady) return true;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      try {
        let cfg = window.FIREBASE_CONFIG;
        if (!cfg?.apiKey || cfg.apiKey.includes('YOUR_')) {
          cfg = await loadConfig();
        }
        if (typeof firebase !== 'undefined' && cfg?.apiKey && !cfg.apiKey.includes('YOUR_')) {
          if (!firebase.apps.length) {
            firebase.initializeApp(cfg);
          }
          authInstance = firebase.auth();
          dbInstance = firebase.firestore();
          firebaseReady = true;
          return true;
        }
      } catch (e) {
        console.error('Firebase init error:', e);
      } finally {
        initPromise = null;
      }
      return false;
    })();

    return initPromise;
  }

  initFirebase();

  // check if firebase is ready
  function isFirebaseReady() {
    return firebaseReady;
  }

  // ensure firebase is initialized
  async function ensureFirebase() {
    if (!firebaseReady) await initFirebase();
    if (!firebaseReady) {
      throw new Error('Firebase not connected. Check environment variables in Vercel.');
    }
  }

  // api request helper
  async function request(endpoint, options = {}) {
    const baseUrl = window.SPLITWISE_CONFIG?.API_BASE_URL || '/api';
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };

    if (authInstance?.currentUser) {
      try {
        const token = await authInstance.currentUser.getIdToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
      } catch (_) {}
    }

    try {
      const res = await fetch(`${baseUrl}${endpoint}`, { ...options, headers });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      return data;
    } catch (err) {
      console.error(`API Error ${endpoint}:`, err);
      throw err;
    }
  }

  // debt simplifier algorithm
  function runDebtSimplifier(initialDebts) {
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

  return {
    isFirebaseReady,

    // auth methods
    auth: {
      async register(name, email, password) {
        await ensureFirebase();
        const cleanName = (name || 'User').trim();
        const cleanEmail = (email || '').trim().toLowerCase();
        const defaultUpi = `${cleanEmail.split('@')[0]}@upi`;

        try {
          const cred = await authInstance.createUserWithEmailAndPassword(cleanEmail, password);
          await cred.user.updateProfile({ displayName: cleanName });
          await dbInstance.collection('users').doc(cred.user.uid).set({
            uid: cred.user.uid,
            name: cleanName,
            email: cleanEmail,
            upiId: defaultUpi,
            createdAt: Date.now()
          }, { merge: true });

          localStorage.setItem('splitwise_user_upi_' + cred.user.uid, defaultUpi);
          return { id: cred.user.uid, uid: cred.user.uid, name: cleanName, email: cleanEmail, upiId: defaultUpi };
        } catch (err) {
          throw new Error(err.message || 'Registration failed');
        }
      },

      async login(email, password) {
        await ensureFirebase();
        const cleanEmail = (email || '').trim().toLowerCase();

        try {
          const cred = await authInstance.signInWithEmailAndPassword(cleanEmail, password);
          let displayName = cred.user.displayName;
          let upiId = '';
          try {
            const snap = await dbInstance.collection('users').doc(cred.user.uid).get();
            if (snap.exists) {
              const udata = snap.data() || {};
              if (udata.name) displayName = udata.name;
              if (udata.upiId) upiId = udata.upiId;
            }
          } catch (_) {}

          if (!upiId) {
            upiId = localStorage.getItem('splitwise_user_upi_' + cred.user.uid) || `${cleanEmail.split('@')[0]}@upi`;
            try {
              await dbInstance.collection('users').doc(cred.user.uid).set({ upiId }, { merge: true });
            } catch (_) {}
          }

          localStorage.setItem('splitwise_user_upi_' + cred.user.uid, upiId);
          return { id: cred.user.uid, uid: cred.user.uid, name: displayName || cleanEmail.split('@')[0], email: cleanEmail, upiId };
        } catch (err) {
          throw new Error(err.message || 'Invalid email or password');
        }
      },

      async getMe() {
        if (!firebaseReady) await initFirebase();
        if (!isFirebaseReady()) return null;

        return new Promise((resolve) => {
          const unsub = authInstance.onAuthStateChanged(async (fbUser) => {
            unsub();
            if (fbUser) {
              let displayName = fbUser.displayName;
              let upiId = '';
              try {
                const snap = await dbInstance.collection('users').doc(fbUser.uid).get();
                if (snap.exists) {
                  const udata = snap.data() || {};
                  if (udata.name) displayName = udata.name;
                  if (udata.upiId) upiId = udata.upiId;
                }
              } catch (_) {}

              if (!upiId) {
                upiId = localStorage.getItem('splitwise_user_upi_' + fbUser.uid) || `${(fbUser.email || 'user').split('@')[0]}@upi`;
                try {
                  await dbInstance.collection('users').doc(fbUser.uid).set({ upiId }, { merge: true });
                } catch (_) {}
              }

              localStorage.setItem('splitwise_user_upi_' + fbUser.uid, upiId);
              resolve({
                id: fbUser.uid,
                uid: fbUser.uid,
                name: displayName || fbUser.email.split('@')[0],
                email: fbUser.email,
                upiId
              });
            } else {
              resolve(null);
            }
          });
        });
      },

      async updateUserUpi(upiId) {
        await ensureFirebase();
        const currentUser = authInstance?.currentUser;
        if (!currentUser) throw new Error('Not logged in');
        const cleanUpi = (upiId || '').trim();
        if (!cleanUpi) throw new Error('UPI ID cannot be empty');

        try {
          await dbInstance.collection('users').doc(currentUser.uid).set({
            upiId: cleanUpi,
            updatedAt: Date.now()
          }, { merge: true });
        } catch (e) {
          console.warn('Could not update user UPI in Firestore:', e);
        }

        localStorage.setItem('splitwise_user_upi_' + currentUser.uid, cleanUpi);
        return cleanUpi;
      },

      async logout() {
        if (authInstance) await authInstance.signOut();
      }
    },

    // bills methods
    bills: {
      async getAll() {
        await ensureFirebase();
        try {
          let currentUser = authInstance.currentUser;
          if (!currentUser) {
            await new Promise((resolve) => {
              const unsub = authInstance.onAuthStateChanged((user) => {
                unsub();
                currentUser = user;
                resolve();
              });
              setTimeout(resolve, 600);
            });
          }

          let allDocs = [];
          let fetchError = null;

          if (currentUser) {
            const uid = currentUser.uid;
            try {
              const userSnap = await dbInstance.collection('bills').where('userId', '==', uid).get();
              userSnap.forEach(doc => allDocs.push({ ...doc.data(), id: doc.id }));
            } catch (err) {
              fetchError = err;
            }

            try {
              const guestSnap = await dbInstance.collection('bills').where('userId', '==', 'guest').get();
              guestSnap.forEach(doc => {
                if (!allDocs.some(d => d.id === doc.id)) allDocs.push({ ...doc.data(), id: doc.id });
              });
            } catch (_) {}

            try {
              const fullSnap = await dbInstance.collection('bills').get();
              fullSnap.forEach(doc => {
                if (!allDocs.some(d => d.id === doc.id)) allDocs.push({ ...doc.data(), id: doc.id });
              });
            } catch (_) {
              if (!allDocs.length && fetchError) throw fetchError;
            }
          } else {
            try {
              const fullSnap = await dbInstance.collection('bills').get();
              fullSnap.forEach(doc => allDocs.push({ ...doc.data(), id: doc.id }));
            } catch (_) {
              const guestSnap = await dbInstance.collection('bills').where('userId', '==', 'guest').get();
              guestSnap.forEach(doc => allDocs.push({ ...doc.data(), id: doc.id }));
            }
          }

          allDocs.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));

          if (currentUser) {
            const uid = currentUser.uid;
            const email = (currentUser.email || '').toLowerCase().trim();
            const name = (currentUser.displayName || '').toLowerCase().trim();

            const filtered = allDocs.filter(b => {
              if (b.userId === uid || b.userId === 'guest' || !b.userId) return true;
              if (email && b.userEmail?.toLowerCase().trim() === email) return true;
              if (name && b.payer?.toLowerCase().trim() === name) return true;
              return false;
            });
            return filtered.length ? filtered : allDocs;
          }

          return allDocs;
        } catch (err) {
          console.error('getAll bills error:', err);
          throw new Error('Failed to load bills: ' + err.message);
        }
      },

      async create(billData) {
        await ensureFirebase();
        const currentUser = authInstance?.currentUser || null;
        const cleanDebts = (billData.debts || []).map(d => ({
          ...d,
          amount: Math.round(Number(d.amount || 0) * 100) / 100,
          settled: Boolean(d.settled)
        }));

        const newBill = {
          ...billData,
          userId: currentUser ? currentUser.uid : 'guest',
          userEmail: currentUser?.email || '',
          debts: cleanDebts,
          settled: cleanDebts.length > 0 && cleanDebts.every(d => d.settled),
          createdAt: Date.now()
        };

        try {
          const docRef = await dbInstance.collection('bills').add(newBill);
          return { ...newBill, id: docRef.id };
        } catch (err) {
          throw new Error('Failed to save bill: ' + err.message);
        }
      },

      async delete(billId) {
        if (!billId) return { success: false };
        await ensureFirebase();
        try {
          await dbInstance.collection('bills').doc(billId).delete();
          return { success: true };
        } catch (err) {
          throw new Error('Failed to delete bill: ' + err.message);
        }
      },

      async updateDebtStatus(billId, personFrom = 'all', settled = true, upiId = '') {
        if (!billId) return { success: false };
        await ensureFirebase();

        try {
          const docRef = dbInstance.collection('bills').doc(billId);
          const snap = await docRef.get();
          if (!snap.exists) throw new Error('Bill not found');

          const data = snap.data();
          const targetFrom = (personFrom || '').trim().toLowerCase();
          const debts = (data.debts || []).map(d => {
            const fromName = (d.from || '').trim().toLowerCase();
            if (targetFrom === 'all' || !targetFrom || fromName === targetFrom) {
              return { ...d, settled: Boolean(settled) };
            }
            return d;
          });

          const updatePayload = {
            debts,
            settled: debts.length > 0 && debts.every(d => d.settled)
          };
          if (upiId?.trim()) updatePayload.upiId = upiId.trim();

          await docRef.update(updatePayload);
          return { success: true };
        } catch (err) {
          throw new Error('Failed to update debt: ' + err.message);
        }
      },

      async updateBillUpi(billId, upiId) {
        if (!billId || !upiId) return { success: false };
        await ensureFirebase();
        try {
          await dbInstance.collection('bills').doc(billId).update({ upiId: upiId.trim() });
          return { success: true };
        } catch (err) {
          throw new Error('Failed to update UPI ID: ' + err.message);
        }
      }
    },

    // ai endpoints
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

    // debt simplification
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
