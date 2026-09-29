// Handles API network requests between the frontend and the Java backend.
const ApiService = (function () {
  const TOKEN_KEY = 'splitwise_auth_token';

  // Gets the stored login token from local storage.
  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  // Saves or removes the login token in local storage.
  function setToken(token) {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }

  // Sends an HTTP request to the backend and returns the JSON response.
  async function request(endpoint, options = {}) {
    const baseUrl = (window.SPLITWISE_CONFIG && window.SPLITWISE_CONFIG.API_BASE_URL) || '/api';
    const url = `${baseUrl}${endpoint}`;

    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    const token = getToken();
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

  return {
    getToken,
    setToken,

    auth: {
      // Registers a new user account with the backend.
      async register(name, email, password) {
        const res = await request('/auth/register', {
          method: 'POST',
          body: JSON.stringify({ name, email, password })
        });
        if (res.token) setToken(res.token);
        return res.user;
      },

      // Logs in an existing user and stores their token.
      async login(email, password) {
        const res = await request('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password })
        });
        if (res.token) setToken(res.token);
        return res.user;
      },

      // Fetches the current logged-in user profile.
      async getMe() {
        const token = getToken();
        if (!token) return null;
        try {
          const res = await request('/auth/me');
          return res.user;
        } catch {
          setToken('');
          return null;
        }
      },

      // Logs out the current user and clears their token.
      async logout() {
        try {
          await request('/auth/logout', { method: 'POST' });
        } finally {
          setToken('');
        }
      }
    },

    bills: {
      // Fetches all bills from the backend.
      async getAll() {
        const res = await request('/bills');
        return res.bills || [];
      },

      // Saves a new bill to the backend.
      async create(billData) {
        const res = await request('/bills', {
          method: 'POST',
          body: JSON.stringify(billData)
        });
        return res.bill;
      },

      // Deletes a bill by its ID.
      async delete(billId) {
        return await request(`/bills?id=${encodeURIComponent(billId)}`, {
          method: 'DELETE'
        });
      },

      // Updates the payment settlement status of a bill.
      async updateDebtStatus(billId, from = 'all', settled = true, upiId = '') {
        const payload = { billId, from, settled };
        if (upiId) payload.upiId = upiId;
        return await request('/bills', {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      },

      // Updates the UPI ID associated with a bill.
      async updateBillUpi(billId, upiId) {
        return await request('/bills', {
          method: 'PUT',
          body: JSON.stringify({ billId, upiId })
        });
      }
    },

    ai: {
      // Sends receipt image or document to AI to extract bill items.
      async analyzeReceipt(imageBase64, mimeType = 'image/jpeg', category = 'restaurant') {
        const res = await request('/analyze-bill', {
          method: 'POST',
          body: JSON.stringify({ imageBase64, mimeType, category })
        });
        return res.data;
      },

      // Sends chat prompts to AI to calculate split amounts.
      async splitChat(prompt, items = [], participants = [], category = 'restaurant', payer = '', totalAmount = 0) {
        return await request('/split-chat', {
          method: 'POST',
          body: JSON.stringify({ prompt, items, participants, category, payer, totalAmount })
        });
      }
    },

    debts: {
      // Requests simplified debt transactions using the DSA algorithm.
      async simplify(debts = null) {
        const body = debts ? JSON.stringify({ debts }) : '{}';
        return await request('/simplify-debts', {
          method: 'POST',
          body
        });
      },

      // Records a debt settlement between two users.
      async settle(from, to, amount) {
        return await request('/settle', {
          method: 'POST',
          body: JSON.stringify({ from, to, amount })
        });
      }
    }
  };
})();
