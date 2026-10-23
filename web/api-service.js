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

  const TOKEN_KEY = 'splitwise_auth_token';

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  function setToken(token) {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }

  // api request helper
  async function request(endpoint, options = {}) {
    const baseUrl = window.SPLITWISE_CONFIG?.API_BASE_URL || '/api';
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };

    const token = getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else if (authInstance?.currentUser) {
      try {
        const idToken = await authInstance.currentUser.getIdToken();
        if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
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
    getToken,
    setToken,

    // auth methods
    auth: {
      async register(name, email, password) {
        const cleanName = (name || 'User').trim();
        const cleanEmail = (email || '').trim().toLowerCase();
        const defaultUpi = `${cleanEmail.split('@')[0]}@upi`;
        let backendUser = null;

        // 1. Create account on backend (creates data/users.json and data/bills/<userId>.json)
        try {
          const res = await request('/auth/register', {
            method: 'POST',
            body: JSON.stringify({ name: cleanName, email: cleanEmail, password })
          });
          if (res?.token) setToken(res.token);
          if (res?.user) backendUser = res.user;
        } catch (_) {}

        // 2. Also register in Firebase if configured
        if (isFirebaseReady() || await initFirebase()) {
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
            if (!backendUser) throw new Error(err.message || 'Registration failed');
          }
        }

        if (backendUser) {
          backendUser.uid = backendUser.id;
          backendUser.upiId = defaultUpi;
          localStorage.setItem('splitwise_user_upi_' + backendUser.id, defaultUpi);
          return backendUser;
        }

        throw new Error('Registration failed');
      },

      async login(email, password) {
        const cleanEmail = (email || '').trim().toLowerCase();
        let backendUser = null;

        // 1. Login on backend to retrieve session token for file storage
        try {
          const res = await request('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: cleanEmail, password })
          });
          if (res?.token) setToken(res.token);
          if (res?.user) backendUser = res.user;
        } catch (_) {}

        // 2. Login on Firebase if configured
        if (isFirebaseReady() || await initFirebase()) {
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
            if (!backendUser) throw new Error(err.message || 'Invalid email or password');
          }
        }

        if (backendUser) {
          backendUser.uid = backendUser.id;
          const upiId = localStorage.getItem('splitwise_user_upi_' + backendUser.id) || `${cleanEmail.split('@')[0]}@upi`;
          backendUser.upiId = upiId;
          return backendUser;
        }

        throw new Error('Invalid email or password');
      },

      async getMe() {
        if (isFirebaseReady() || await initFirebase()) {
          const fbUser = await new Promise((resolve) => {
            const unsub = authInstance.onAuthStateChanged(async (user) => {
              unsub();
              if (user) {
                let displayName = user.displayName;
                let upiId = '';
                try {
                  const snap = await dbInstance.collection('users').doc(user.uid).get();
                  if (snap.exists) {
                    const udata = snap.data() || {};
                    if (udata.name) displayName = udata.name;
                    if (udata.upiId) upiId = udata.upiId;
                  }
                } catch (_) {}

                if (!upiId) {
                  upiId = localStorage.getItem('splitwise_user_upi_' + user.uid) || `${(user.email || 'user').split('@')[0]}@upi`;
                }

                localStorage.setItem('splitwise_user_upi_' + user.uid, upiId);
                resolve({
                  id: user.uid,
                  uid: user.uid,
                  name: displayName || user.email.split('@')[0],
                  email: user.email,
                  upiId
                });
              } else {
                resolve(null);
              }
            });
          });
          if (fbUser) return fbUser;
        }

        const token = getToken();
        if (token) {
          try {
            const res = await request('/auth/me');
            if (res?.user) {
              const u = res.user;
              u.uid = u.id;
              u.upiId = localStorage.getItem('splitwise_user_upi_' + u.id) || `${(u.email || 'user').split('@')[0]}@upi`;
              return u;
            }
          } catch (_) {
            setToken('');
          }
        }

        return null;
      },

      async updateUserUpi(upiId) {
        const cleanUpi = (upiId || '').trim();
        if (!cleanUpi) throw new Error('UPI ID cannot be empty');

        let user = null;
        try {
          user = await ApiService.auth.getMe();
        } catch (_) {}

        if (user?.uid) {
          localStorage.setItem('splitwise_user_upi_' + user.uid, cleanUpi);
        }

        if (isFirebaseReady() || await initFirebase()) {
          const fbUser = authInstance?.currentUser;
          if (fbUser) {
            try {
              await dbInstance.collection('users').doc(fbUser.uid).set({
                upiId: cleanUpi,
                updatedAt: Date.now()
              }, { merge: true });
            } catch (e) {
              console.warn('Could not update user UPI in Firestore:', e);
            }
          }
        }

        return cleanUpi;
      },

      async logout() {
        setToken('');
        if (authInstance) {
          try { await authInstance.signOut(); } catch (_) {}
        }
        try {
          await request('/auth/logout', { method: 'POST' });
        } catch (_) {}
      }
    },

    // bills methods
    bills: {
      async getAll() {
        let currentUser = null;
        try {
          currentUser = await ApiService.auth.getMe();
        } catch (_) {}

        // 1. Try Firebase if ready
        if (isFirebaseReady() || await initFirebase()) {
          try {
            let allDocs = [];
            if (currentUser) {
              const uid = currentUser.uid || currentUser.id;
              const userSnap = await dbInstance.collection('bills').where('userId', '==', uid).get();
              userSnap.forEach(doc => {
                const data = doc.data();
                if (data.userId === uid) {
                  allDocs.push({ ...data, id: doc.id });
                }
              });
            } else {
              // Guest user ONLY gets guest bills
              const guestSnap = await dbInstance.collection('bills').where('userId', '==', 'guest').get();
              guestSnap.forEach(doc => {
                const data = doc.data();
                if (data.userId === 'guest' || !data.userId) {
                  allDocs.push({ ...data, id: doc.id });
                }
              });
            }

            allDocs.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
            return allDocs;
          } catch (err) {
            console.warn('Firestore getAll failed, falling back to backend:', err);
          }
        }

        // 2. Query backend API (reads data/bills/<userId>.json or data/bills/guest.json)
        try {
          const res = await request('/bills');
          return res.bills || [];
        } catch (err) {
          console.error('getAll bills backend error:', err);
          return [];
        }
      },

      async create(billData) {
        let currentUser = null;
        try {
          currentUser = await ApiService.auth.getMe();
        } catch (_) {}

        const currentUserId = currentUser ? (currentUser.uid || currentUser.id) : 'guest';
        const cleanDebts = (billData.debts || []).map(d => ({
          ...d,
          amount: Math.round(Number(d.amount || 0) * 100) / 100,
          settled: Boolean(d.settled)
        }));

        const newBill = {
          ...billData,
          userId: currentUserId,
          userEmail: currentUser?.email || '',
          debts: cleanDebts,
          settled: cleanDebts.length > 0 && cleanDebts.every(d => d.settled),
          createdAt: Date.now()
        };

        let savedBill = null;

        // 1. Always attempt saving to backend /api/bills so disk file data/bills/<userId>.json or data/bills/guest.json is created
        try {
          const res = await request('/bills', {
            method: 'POST',
            body: JSON.stringify(newBill)
          });
          if (res?.bill) {
            savedBill = res.bill;
          }
        } catch (_) {}

        // 2. Also save to Firestore if available
        if (isFirebaseReady() || await initFirebase()) {
          try {
            const docRef = await dbInstance.collection('bills').add(newBill);
            return { ...newBill, id: docRef.id };
          } catch (err) {
            if (!savedBill) throw new Error('Failed to save bill: ' + err.message);
          }
        }

        if (savedBill) return savedBill;
        return { ...newBill, id: 'bill_' + Date.now() };
      },

      async delete(billId) {
        if (!billId) return { success: false };
        let deleted = false;

        try {
          await request(`/bills?id=${encodeURIComponent(billId)}`, { method: 'DELETE' });
          deleted = true;
        } catch (_) {}

        if (isFirebaseReady() || await initFirebase()) {
          try {
            await dbInstance.collection('bills').doc(billId).delete();
            deleted = true;
          } catch (_) {}
        }

        return { success: deleted };
      },

      async updateDebtStatus(billId, personFrom = 'all', settled = true, upiId = '') {
        if (!billId) return { success: false };
        let updated = false;

        try {
          const payload = { billId, from: personFrom, settled };
          if (upiId) payload.upiId = upiId;
          await request('/bills', { method: 'PUT', body: JSON.stringify(payload) });
          updated = true;
        } catch (_) {}

        if (isFirebaseReady() || await initFirebase()) {
          try {
            const docRef = dbInstance.collection('bills').doc(billId);
            const snap = await docRef.get();
            if (snap.exists) {
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
              updated = true;
            }
          } catch (_) {}
        }

        return { success: updated };
      },

      async updateBillUpi(billId, upiId) {
        if (!billId || !upiId) return { success: false };
        let updated = false;

        try {
          await request('/bills', { method: 'PUT', body: JSON.stringify({ billId, upiId: upiId.trim() }) });
          updated = true;
        } catch (_) {}

        if (isFirebaseReady() || await initFirebase()) {
          try {
            await dbInstance.collection('bills').doc(billId).update({ upiId: upiId.trim() });
            updated = true;
          } catch (_) {}
        }

        return { success: updated };
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
