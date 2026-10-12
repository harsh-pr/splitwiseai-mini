// SplitWise.AI - Unified API & Firebase Firestore Service
// Seamlessly connects frontend to Firebase Authentication & Cloud Firestore database,
// with automatic local fallback mode when offline or before Firebase credentials are configured.

const ApiService = (function () {
  const TOKEN_KEY = 'splitwise_auth_token';
  const LOCAL_USER_KEY = 'splitwise_active_user';
  const LOCAL_BILLS_KEY = 'splitwise_local_bills';
  const LOCAL_USERS_DB_KEY = 'splitwise_local_registered_users';

  // --- Firebase Initialization ---
  let authInstance = null;
  let dbInstance = null;
  let firebaseReady = false;

  function initFirebase() {
    if (firebaseReady) return true;
    try {
      const cfg = window.FIREBASE_CONFIG;
      if (typeof firebase !== 'undefined' && cfg && cfg.apiKey && !cfg.apiKey.includes('YOUR_API_KEY')) {
        if (!firebase.apps.length) {
          firebase.initializeApp(cfg);
        }
        authInstance = firebase.auth();
        dbInstance = firebase.firestore();
        firebaseReady = true;
        console.log('✓ [SplitWise AI] Firebase initialized (Cloud Firestore + Auth connected)');
        return true;
      }
    } catch (e) {
      console.warn('[SplitWise AI] Firebase initialization warning:', e.message);
    }
    return false;
  }

  // Attempt initial Firebase boot
  initFirebase();

  function isFirebaseReady() {
    return firebaseReady || initFirebase();
  }

  // --- Local Fallback Database Helpers ---
  function getLocalBills() {
    try {
      const data = localStorage.getItem(LOCAL_BILLS_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  function saveLocalBills(bills) {
    try {
      localStorage.setItem(LOCAL_BILLS_KEY, JSON.stringify(bills));
    } catch (e) {
      console.error('Error saving local bills:', e);
    }
  }

  function getLocalUsers() {
    try {
      const data = localStorage.getItem(LOCAL_USERS_DB_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  function saveLocalUsers(users) {
    try {
      localStorage.setItem(LOCAL_USERS_DB_KEY, JSON.stringify(users));
    } catch (e) {
      console.error('Error saving local users:', e);
    }
  }

  function getStoredActiveUser() {
    try {
      const data = localStorage.getItem(LOCAL_USER_KEY);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  function setStoredActiveUser(user) {
    if (user) {
      localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(user));
      localStorage.setItem(TOKEN_KEY, user.id || user.uid || 'session_' + Date.now());
    } else {
      localStorage.removeItem(LOCAL_USER_KEY);
      localStorage.removeItem(TOKEN_KEY);
    }
  }

  // --- HTTP Request Helper (for Vercel Serverless / Backend AI APIs) ---
  async function request(endpoint, options = {}) {
    const baseUrl = (window.SPLITWISE_CONFIG && window.SPLITWISE_CONFIG.API_BASE_URL) || '/api';
    const url = `${baseUrl}${endpoint}`;

    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    const token = localStorage.getItem(TOKEN_KEY) || '';
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
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

  // --- Debt Simplification Algorithm (Greedy Min Cash Flow with Net Balances) ---
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

    debtors.sort((a, b) => a.netAmount - b.netAmount); // Most negative balance first
    creditors.sort((a, b) => b.netAmount - a.netAmount); // Most positive credit first

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

    getToken() {
      return localStorage.getItem(TOKEN_KEY) || '';
    },

    setToken(token) {
      if (token) {
        localStorage.setItem(TOKEN_KEY, token);
      } else {
        localStorage.removeItem(TOKEN_KEY);
      }
    },

    // =========================================================================
    // AUTHENTICATION (Firebase Auth + Firestore Profile, with local fallback)
    // =========================================================================
    auth: {
      async register(name, email, password) {
        const cleanName = (name || 'User').trim();
        const cleanEmail = (email || '').trim().toLowerCase();

        if (isFirebaseReady()) {
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

            const userObj = {
              id: fbUser.uid,
              uid: fbUser.uid,
              name: cleanName,
              email: cleanEmail
            };

            setStoredActiveUser(userObj);
            return userObj;
          } catch (err) {
            console.error('[Firebase Auth Register Error]', err);
            throw new Error(err.message || 'Registration failed');
          }
        }

        // Local Fallback
        const users = getLocalUsers();
        if (users.some(u => u.email === cleanEmail)) {
          throw new Error('An account with this email already exists.');
        }

        const newUser = {
          id: 'user_' + Date.now(),
          uid: 'user_' + Date.now(),
          name: cleanName,
          email: cleanEmail,
          password: password,
          createdAt: Date.now()
        };

        users.push(newUser);
        saveLocalUsers(users);

        const safeUser = { id: newUser.id, uid: newUser.uid, name: newUser.name, email: newUser.email };
        setStoredActiveUser(safeUser);
        return safeUser;
      },

      async login(email, password) {
        const cleanEmail = (email || '').trim().toLowerCase();

        if (isFirebaseReady()) {
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

            const userObj = {
              id: fbUser.uid,
              uid: fbUser.uid,
              name: displayName || cleanEmail.split('@')[0],
              email: cleanEmail
            };

            setStoredActiveUser(userObj);
            return userObj;
          } catch (err) {
            console.error('[Firebase Auth Login Error]', err);
            throw new Error(err.message || 'Invalid email or password');
          }
        }

        // Local Fallback
        const users = getLocalUsers();
        const found = users.find(u => u.email === cleanEmail && u.password === password);
        if (!found) {
          throw new Error('Invalid email or password.');
        }

        const safeUser = { id: found.id, uid: found.uid, name: found.name, email: found.email };
        setStoredActiveUser(safeUser);
        return safeUser;
      },

      async getMe() {
        if (isFirebaseReady()) {
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

                const userObj = {
                  id: fbUser.uid,
                  uid: fbUser.uid,
                  name: displayName || fbUser.email.split('@')[0],
                  email: fbUser.email
                };
                setStoredActiveUser(userObj);
                resolve(userObj);
              } else {
                resolve(null);
              }
            });
          });
        }

        return getStoredActiveUser();
      },

      async logout() {
        if (isFirebaseReady()) {
          try {
            await authInstance.signOut();
          } catch (e) {
            console.warn('Firebase signOut error:', e);
          }
        }
        setStoredActiveUser(null);
      }
    },

    // =========================================================================
    // BILLS & DEBTS DATABASE (Firebase Cloud Firestore + Local Fallback)
    // =========================================================================
    bills: {
      async getAll() {
        if (isFirebaseReady()) {
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

            // In-memory sort by date descending (avoids requiring manual Firestore composite indexes)
            bills.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
            return bills;
          } catch (err) {
            console.error('[Firebase Firestore getAll Bills Error]', err);
            // Fallback to local on connection glitch
            return getLocalBills();
          }
        }

        // Local Storage Fallback
        const bills = getLocalBills();
        bills.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
        return bills;
      },

      async create(billData) {
        const currentUser = (authInstance && authInstance.currentUser) || null;
        const activeLocal = getStoredActiveUser();
        const userId = currentUser ? currentUser.uid : (activeLocal ? activeLocal.id : 'guest');
        const userEmail = currentUser ? currentUser.email : (activeLocal ? activeLocal.email : '');

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

        if (isFirebaseReady()) {
          try {
            const docRef = await dbInstance.collection('bills').add(newBill);
            const savedBill = { ...newBill, id: docRef.id };
            return savedBill;
          } catch (err) {
            console.error('[Firebase Firestore create Bill Error]', err);
            throw err;
          }
        }

        // Local Storage Fallback
        const bills = getLocalBills();
        const localId = 'bill_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        const savedBill = { ...newBill, id: localId };
        bills.unshift(savedBill);
        saveLocalBills(bills);
        return savedBill;
      },

      async delete(billId) {
        if (!billId) return { success: false };

        if (isFirebaseReady()) {
          try {
            await dbInstance.collection('bills').doc(billId).delete();
            return { success: true };
          } catch (err) {
            console.error('[Firebase Firestore delete Bill Error]', err);
            throw err;
          }
        }

        // Local Storage Fallback
        let bills = getLocalBills();
        bills = bills.filter(b => b.id !== billId);
        saveLocalBills(bills);
        return { success: true };
      },

      async updateDebtStatus(billId, personFrom = 'all', settled = true, upiId = '') {
        if (!billId) return { success: false };

        if (isFirebaseReady()) {
          try {
            const docRef = dbInstance.collection('bills').doc(billId);
            const snap = await docRef.get();
            if (!snap.exists) throw new Error('Bill not found in database');

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
            throw err;
          }
        }

        // Local Storage Fallback
        const bills = getLocalBills();
        const bill = bills.find(b => b.id === billId);
        if (bill) {
          (bill.debts || []).forEach(d => {
            const fromName = (d.from || '').trim().toLowerCase();
            const targetFrom = (personFrom || '').trim().toLowerCase();
            if (targetFrom === 'all' || !targetFrom || fromName === targetFrom) {
              d.settled = Boolean(settled);
            }
          });
          bill.settled = (bill.debts || []).length > 0 && bill.debts.every(d => d.settled === true);
          if (upiId && upiId.trim()) {
            bill.upiId = upiId.trim();
          }
          saveLocalBills(bills);
        }
        return { success: true };
      },

      async updateBillUpi(billId, upiId) {
        if (!billId || !upiId) return { success: false };
        const cleanUpi = upiId.trim();

        if (isFirebaseReady()) {
          try {
            await dbInstance.collection('bills').doc(billId).update({ upiId: cleanUpi });
            return { success: true };
          } catch (err) {
            console.error('[Firebase Firestore updateBillUpi Error]', err);
            throw err;
          }
        }

        // Local Storage Fallback
        const bills = getLocalBills();
        const bill = bills.find(b => b.id === billId);
        if (bill) {
          bill.upiId = cleanUpi;
          saveLocalBills(bills);
        }
        return { success: true };
      }
    },

    // =========================================================================
    // AI SERVICES (Gemini OCR Receipt Analysis & Live Split Chat)
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
    // DEBT SIMPLIFICATION DSA ENGINE
    // =========================================================================
    debts: {
      async simplify(debts = null) {
        if (debts && Array.isArray(debts)) {
          return {
            success: true,
            transactions: runDebtSimplifier(debts)
          };
        }
        try {
          return await request('/simplify-debts', {
            method: 'POST',
            body: JSON.stringify({ debts })
          });
        } catch {
          return { success: true, transactions: runDebtSimplifier(debts || []) };
        }
      },

      async settle(from, to, amount) {
        try {
          return await request('/settle', {
            method: 'POST',
            body: JSON.stringify({ from, to, amount })
          });
        } catch {
          return { success: true, message: `Settled ₹${amount} from ${from} to ${to}` };
        }
      }
    }
  };
})();
