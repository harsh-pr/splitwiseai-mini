// Manages the bill history page, search filtering, debt settlements, and lifetime statistics.
const historyApp = (function () {
  let allBills = [];
  let activeCategory = 'all';
  let activeStatus = 'all';
  let searchTerm = '';

  const categoryIcons = {
    restaurant: '🍽️',
    utilities: '💡',
    grocery: '🛒',
    entertainment: '🎟️',
    hotel: '🏨',
    travel: '🚕',
    general: '🧾'
  };

  let defaultUpiId = localStorage.getItem('splitwise_default_upi') || 'harsh@upi';
  const openDrawers = new Set();
  const openQrBills = new Set();

  // Initializes themes, user status, UPI display, and loads saved bills.
  async function init() {
    initTheme();
    checkUser();
    updateUpiDisplay();
    await loadHistory();
  }

  // Loads the saved color theme from storage and applies it.
  function initTheme() {
    const saved = localStorage.getItem('splitwise_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeButton(saved);
  }

  // Toggles between light and dark display modes.
  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('splitwise_theme', next);
    updateThemeButton(next);
  }

  // Updates the theme toggle button icon and tooltip.
  function updateThemeButton(theme) {
    const btn = document.getElementById('theme-toggle-btn');
    const icon = document.getElementById('theme-icon');
    if (icon) {
      icon.textContent = theme === 'dark' ? '☀️' : '🌙';
    }
    if (btn) {
      btn.title = theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    }
  }

  // Checks if a user is logged in and updates the header UI.
  async function checkUser() {
    try {
      const user = await ApiService.auth.getMe();
      updateAuthUI(user);
    } catch {
      updateAuthUI(null);
    }
  }

  // Updates header buttons and user profile menu based on login state.
  function updateAuthUI(user) {
    const loginBtn = document.getElementById('auth-login-btn');
    const dropdownWrap = document.getElementById('profile-dropdown-wrap');
    const avatarInitial = document.getElementById('avatar-initial');
    const menuName = document.getElementById('menu-user-name');
    const menuEmail = document.getElementById('menu-user-email');

    if (user) {
      if (loginBtn) loginBtn.style.display = 'none';
      if (dropdownWrap) dropdownWrap.style.display = 'inline-block';
      const initial = (user.name || 'U').trim().charAt(0).toUpperCase();
      if (avatarInitial) avatarInitial.textContent = initial;
      if (menuName) menuName.textContent = user.name || 'User';
      if (menuEmail) menuEmail.textContent = user.email || '';
    } else {
      if (loginBtn) loginBtn.style.display = 'inline-flex';
      if (dropdownWrap) dropdownWrap.style.display = 'none';
    }
  }

  // Toggles visibility of the user profile dropdown menu.
  function toggleProfileDropdown(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('profile-dropdown-menu');
    if (menu) {
      menu.classList.toggle('show');
    }
  }

  // Logs out the user and redirects to the home page.
  async function handleLogout() {
    const menu = document.getElementById('profile-dropdown-menu');
    if (menu) menu.classList.remove('show');
    try {
      await ApiService.auth.logout();
    } catch {}
    updateAuthUI(null);
    window.location.href = 'index.html';
  }

  // Updates the default UPI ID text in the profile menu.
  function updateUpiDisplay() {
    const el = document.getElementById('menu-upi-id');
    if (el) el.textContent = defaultUpiId;
  }

  // Prompts user to enter a new default UPI ID.
  function promptEditUpiId() {
    const entered = prompt('Enter your default UPI ID (e.g. name@okhdfcbank):', defaultUpiId);
    if (entered && entered.trim().length > 0) {
      defaultUpiId = entered.trim();
      localStorage.setItem('splitwise_default_upi', defaultUpiId);
      updateUpiDisplay();
    }
  }

  // Loads all saved bills from the backend and updates stats and filters.
  async function loadHistory() {
    try {
      allBills = await ApiService.bills.getAll();
      renderStats();
      applyFilters();
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  }

  // Checks if all debts in a bill have been paid.
  function isBillSettled(bill) {
    if (!bill) return false;
    if (bill.settled === true || bill.isSettled === true || bill.status === 'settled') return true;
    const debts = bill.debts || [];
    if (debts.length === 0) return true;
    return debts.every(d => d.settled === true || d.status === 'settled' || d.paid === true);
  }

  // Calculates and displays total spend, settled amounts, and pending debts.
  function renderStats() {
    let totalSpend = 0;
    let totalSettled = 0;
    let totalPending = 0;

    allBills.forEach(b => {
      const amt = Number(b.totalAmount || 0);
      totalSpend += amt;

      const debts = b.debts || [];
      if (debts.length === 0) {
        totalSettled += amt;
      } else {
        debts.forEach(d => {
          const isPaid = (d.settled === true || d.status === 'settled' || d.paid === true);
          if (isPaid) {
            totalSettled += Number(d.amount || 0);
          } else {
            totalPending += Number(d.amount || 0);
          }
        });
      }
    });

    document.getElementById('stat-total-bills').textContent = allBills.length;
    document.getElementById('stat-total-spend').textContent = `₹${totalSpend.toFixed(2)}`;
    document.getElementById('stat-total-settled').textContent = `₹${totalSettled.toFixed(2)}`;
    document.getElementById('stat-total-pending').textContent = `₹${totalPending.toFixed(2)}`;
  }

  // Sets the active category filter and refreshes the list.
  function setCategoryFilter(cat, btn) {
    activeCategory = cat;
    document.querySelectorAll('.filter-pill').forEach(el => el.classList.remove('active'));
    if (btn) btn.classList.add('active');
    applyFilters();
  }

  // Filters the bills list by category, payment status, and search query.
  function applyFilters() {
    searchTerm = (document.getElementById('history-search').value || '').trim().toLowerCase();
    activeStatus = document.getElementById('status-filter').value;

    const filtered = allBills.filter(bill => {
      if (activeCategory !== 'all' && (bill.category || 'restaurant') !== activeCategory) {
        return false;
      }

      const isSettled = isBillSettled(bill);
      if (activeStatus === 'settled' && !isSettled) return false;
      if (activeStatus === 'pending' && isSettled) return false;

      if (searchTerm) {
        const titleMatch = (bill.title || '').toLowerCase().includes(searchTerm);
        const payerMatch = (bill.payer || '').toLowerCase().includes(searchTerm);
        const partsMatch = (bill.participants || []).some(p => p.toLowerCase().includes(searchTerm));
        const itemsMatch = (bill.items || []).some(it => (it.name || '').toLowerCase().includes(searchTerm));
        if (!titleMatch && !payerMatch && !partsMatch && !itemsMatch) return false;
      }

      return true;
    });

    renderBillsList(filtered);
  }

  // Renders the list of bills as cards on the history page.
  function renderBillsList(bills) {
    const listEl = document.getElementById('history-bills-list');
    const emptyEl = document.getElementById('empty-state');

    if (!listEl) return;

    if (bills.length === 0) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    listEl.innerHTML = bills.map(bill => {
      const icon = categoryIcons[bill.category] || '🧾';
      const dateStr = bill.createdAt ? new Date(bill.createdAt).toLocaleDateString() : 'Recent';
      const itemsCount = (bill.items || []).length;
      const totalFormatted = Number(bill.totalAmount || 0).toFixed(2);
      const debts = bill.debts || [];
      const isSettled = isBillSettled(bill);
      const statusClass = isSettled ? 'badge-paid' : 'badge-pending';
      const statusText = isSettled ? 'Settled' : 'Pending';
      const unpaidDebts = debts.filter(d => !(d.settled === true || d.status === 'settled' || d.paid === true));
      const isQrOpen = openQrBills.has(bill.id);
      const receivingUpi = (bill.upiId || bill.receiverUpi || defaultUpiId || 'harsh@upi').trim();

      return `
        <div class="history-card" id="bill-card-${bill.id}">
          <div class="history-top">
            <div class="history-title-group" style="display: flex; gap: 12px; align-items: flex-start;">
              <div style="font-size: 24px; padding-top: 2px;">${icon}</div>
              <div>
                <h3>${escapeHtml(bill.title || 'Expense')}</h3>
                ${(bill.categoryMeta && bill.categoryMeta.subtitle) ? `
                  <div style="font-size: 11.5px; color: var(--accent); margin-top: 2px; font-weight: 500;">
                    ${escapeHtml(bill.categoryMeta.subtitle)}
                  </div>
                ` : ''}
                <div class="history-meta">
                  <span>📅 ${dateStr}</span>
                  <span>•</span>
                  <span>${escapeHtml(bill.category || 'General')}</span>
                  <span>•</span>
                  <span>${itemsCount} Items</span>
                </div>
              </div>
            </div>

            <div>
              <div class="history-total">₹${totalFormatted}</div>
              <div style="text-align: right; margin-top: 4px;">
                <span class="badge-status ${statusClass}">${statusText}</span>
              </div>
            </div>
          </div>

          <div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 12px;">
            <span class="chip" style="background: var(--surface-elevated); border-color: var(--border); color: var(--text); font-weight: 600;">
              🛡️ Paid by ${escapeHtml(bill.payer || 'User')}
            </span>
            ${(bill.participants || []).filter(p => p.toLowerCase().trim() !== (bill.payer || '').toLowerCase().trim()).map(p => {
              const userDebt = debts.find(d => (d.from || '').toLowerCase().trim() === p.toLowerCase().trim());
              const isPaid = userDebt ? (userDebt.settled === true || userDebt.status === 'settled' || userDebt.paid === true) : true;
              return `
                <span class="chip ${isPaid ? 'chip-paid' : ''}">
                  👤 ${escapeHtml(p)} ${userDebt ? (isPaid ? '✓' : `(₹${Math.round(userDebt.amount)})`) : ''}
                </span>
              `;
            }).join('')}
          </div>

          <div class="history-drawer ${openDrawers.has(bill.id) ? 'show' : ''}" id="drawer-${bill.id}">
            <div class="drawer-grid">
              <div class="drawer-col">
                <h4>Dish Allocations</h4>
                ${(bill.items && bill.items.length > 0) ? bill.items.map(it => `
                  <div class="drawer-item">
                    <span>${(it.quantity && it.quantity > 1) ? `<strong>${it.quantity}x</strong> ` : ''}${escapeHtml(it.name)} <small style="color: var(--text-dim);">(${((it.assignedTo || it.assigned || []).join(', '))})</small></span>
                    <strong style="color: var(--text);">₹${Number(it.price || 0).toFixed(2)}</strong>
                  </div>
                `).join('') : '<div style="color: var(--text-muted); font-size: 12px;">No line items</div>'}
                <div class="drawer-item" style="border: none; margin-top: 6px; color: var(--text-muted);">
                  <span>Tax: ₹${Number(bill.tax || 0).toFixed(2)} • Tip: ₹${Number(bill.tip || 0).toFixed(2)}</span>
                </div>
              </div>

              <div class="drawer-col">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                  <h4 style="margin: 0;">Settlement Balances</h4>
                  ${debts.length > 0 ? `
                    <button class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;" 
                      onclick="historyApp.toggleAllDebts('${bill.id}', ${!isSettled})">
                      ${isSettled ? 'Reopen All' : '✓ Settle All'}
                    </button>
                  ` : ''}
                </div>
                ${debts.length > 0 ? debts.map(d => {
                  const isPaid = (d.settled === true || d.status === 'settled' || d.paid === true);
                  return `
                    <div class="drawer-item" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0;">
                      <div>
                        <span><strong>${escapeHtml(d.from)}</strong> owes ${escapeHtml(d.to || bill.payer)}</span>
                        <div style="font-size: 11px; color: ${isPaid ? 'var(--emerald)' : 'var(--text-dim)'}; margin-top: 1px;">
                          ${isPaid ? '✓ Paid & Settled' : '⏱ Payment Pending'}
                        </div>
                      </div>
                      <div style="display: flex; align-items: center; gap: 8px;">
                        <strong style="color: var(--emerald);">₹${Number(d.amount || 0).toFixed(2)}</strong>
                        <button class="btn ${isPaid ? 'btn-secondary' : 'btn-primary'} btn-sm" 
                          onclick="historyApp.toggleDebt('${bill.id}', '${escapeHtml(d.from)}')" 
                          style="padding: 3px 8px; font-size: 11px;">
                          ${isPaid ? '✓ Settled' : 'Mark Paid'}
                        </button>
                      </div>
                    </div>
                  `;
                }).join('') : '<div style="color: var(--text-muted); font-size: 12px;">No individual debts (Fully settled)</div>'}
              </div>
            </div>
          </div>

          <!-- Inline QR Drawer for Unpaid Users -->
          <div class="history-qr-section ${isQrOpen ? 'show' : ''}" id="qr-section-${bill.id}">
            ${renderQrSectionHtml(bill, debts, unpaidDebts, receivingUpi)}
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border-light);">
            <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
              <button class="btn btn-secondary btn-sm" onclick="historyApp.toggleDrawer('${bill.id}')">
                View Items & Debts ▾
              </button>
              ${debts.length > 0 ? `
                <button class="btn ${isSettled ? 'btn-secondary' : 'btn-primary'} btn-sm" 
                  onclick="historyApp.toggleAllDebts('${bill.id}', ${!isSettled})">
                  ${isSettled ? 'Reopen' : '✓ Mark Paid'}
                </button>
                <button class="btn ${isQrOpen ? 'btn-primary' : 'btn-secondary'} btn-sm" id="btn-qr-${bill.id}"
                  onclick="historyApp.toggleQrSection('${bill.id}')">
                  ${isQrOpen ? 'Hide QR' : 'Show QR'}
                </button>
              ` : ''}
            </div>
            <button class="btn btn-danger btn-sm" onclick="historyApp.deleteBill('${bill.id}')">
              Delete
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Expands or collapses item and debt details for a bill card.
  function toggleDrawer(billId) {
    if (openDrawers.has(billId)) {
      openDrawers.delete(billId);
    } else {
      openDrawers.add(billId);
    }
    const drawer = document.getElementById(`drawer-${billId}`);
    if (drawer) {
      drawer.classList.toggle('show', openDrawers.has(billId));
    }
  }

  // Toggles the inline QR section for unpaid users on a bill card.
  function toggleQrSection(billId) {
    if (openQrBills.has(billId)) {
      openQrBills.delete(billId);
    } else {
      openQrBills.add(billId);
    }
    applyFilters();
  }

  // Renders the inline QR section markup for a bill card.
  function renderQrSectionHtml(bill, debts, unpaidDebts, receivingUpi) {
    if (unpaidDebts.length === 0) {
      return `
        <div style="text-align: center; color: var(--emerald); font-size: 13px; font-weight: 600; padding: 14px 8px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm);">
          ✓ All debts are settled! No unpaid users for this bill.
        </div>
      `;
    }

    const payerName = bill.payer || 'Payer';
    const billTitle = bill.title || 'Bill';

    return `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; gap: 8px;">
        <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted);">
          📲 Unpaid QR Codes (${unpaidDebts.length} Pending)
        </div>
        <div style="font-size: 11px; color: var(--text-dim); display: flex; align-items: center; gap: 6px;">
          <span>Pay to: <strong>${escapeHtml(payerName)}</strong></span>
          <span>•</span>
          <span>UPI: <strong style="color: var(--text);">${escapeHtml(receivingUpi)}</strong></span>
          <button type="button" class="btn btn-secondary btn-sm" onclick="historyApp.editBillUpiId('${bill.id}')" style="padding: 1px 6px; font-size: 10px;" title="Edit receiving UPI ID">Edit</button>
        </div>
      </div>
      <div class="history-qr-grid">
        ${unpaidDebts.map(d => {
          const debtAmt = Number(d.amount || 0).toFixed(2);
          const upiLink = `upi://pay?pa=${encodeURIComponent(receivingUpi)}&pn=${encodeURIComponent(payerName)}&am=${debtAmt}&cu=INR&tn=SplitWise%20${encodeURIComponent(billTitle)}`;
          const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(upiLink)}`;

          return `
            <div class="history-qr-card">
              <div class="history-qr-title">
                <strong>${escapeHtml(d.from)}</strong> owes <strong>${escapeHtml(d.to || payerName)}</strong>
              </div>
              <div class="history-qr-amount">₹${Number(d.amount || 0).toFixed(2)}</div>
              <div class="qr-box" style="margin: 4px 0; background: #ffffff; padding: 6px; border-radius: var(--radius-sm); display: inline-block;">
                <img src="${qrUrl}" alt="UPI QR for ${escapeHtml(d.from)}" style="width: 130px; height: 130px; display: block;">
              </div>
              <div style="font-size: 11px; color: var(--text-dim);">
                Scan to pay <strong>₹${Math.round(d.amount)}</strong>
              </div>
              <button class="btn btn-primary btn-sm" 
                onclick="historyApp.toggleDebt('${bill.id}', '${escapeHtml(d.from)}')"
                style="width: 100%; margin-top: 6px; font-size: 11px; padding: 4px 8px;">
                ✓ Mark Paid
              </button>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // Toggles payment status of a single person's debt.
  async function toggleDebt(billId, personFrom) {
    const bill = allBills.find(b => b.id === billId);
    if (!bill) return;

    const debts = bill.debts || [];
    const target = debts.find(d => (d.from || '').toLowerCase().trim() === personFrom.toLowerCase().trim());
    const newStatus = target ? !target.settled : true;

    if (target) {
      target.settled = newStatus;
    } else {
      debts.forEach(d => {
        if ((d.from || '').toLowerCase().trim() === personFrom.toLowerCase().trim()) {
          d.settled = newStatus;
        }
      });
    }

    renderStats();
    applyFilters();

    try {
      await ApiService.bills.updateDebtStatus(billId, personFrom, newStatus);
    } catch (err) {
      console.warn('Failed to update debt status on server:', err);
    }
  }

  // Marks all debts in a bill as paid or pending.
  async function toggleAllDebts(billId, setSettled) {
    const bill = allBills.find(b => b.id === billId);
    if (!bill) return;

    (bill.debts || []).forEach(d => {
      d.settled = setSettled;
    });

    renderStats();
    applyFilters();

    try {
      await ApiService.bills.updateDebtStatus(billId, 'all', setSettled);
    } catch (err) {
      console.warn('Failed to update all debts on server:', err);
    }
  }

  // Deletes a specific bill after confirmation.
  async function deleteBill(billId) {
    if (!confirm('Are you sure you want to delete this bill from history?')) return;
    try {
      await ApiService.bills.delete(billId);
      allBills = allBills.filter(b => b.id !== billId);
      renderStats();
      applyFilters();
    } catch (err) {
      alert('Failed to delete bill: ' + err.message);
    }
  }

  // Deletes all bills from history after confirmation.
  async function clearAllBills() {
    if (!confirm('Are you sure you want to delete ALL saved bills? This cannot be undone.')) return;
    for (const b of allBills) {
      try {
        await ApiService.bills.delete(b.id);
      } catch (e) {
        console.warn('Error deleting bill', b.id, e);
      }
    }
    allBills = [];
    renderStats();
    applyFilters();
  }

  // Updates the receiving UPI ID for a specific bill.
  async function editBillUpiId(billId) {
    const bill = allBills.find(b => b.id === billId);
    if (!bill) return;
    const currentUpi = (bill.upiId || bill.receiverUpi || defaultUpiId || '').trim();
    const entered = prompt('Enter receiving UPI ID for this bill (e.g. name@okhdfcbank):', currentUpi);
    if (entered && entered.trim() && entered.trim() !== currentUpi) {
      const cleanUpi = entered.trim();
      bill.upiId = cleanUpi;
      try {
        await ApiService.bills.updateBillUpi(billId, cleanUpi);
      } catch (err) {
        console.error('Failed to update UPI ID on server:', err);
      }
      applyFilters();
    }
  }

  // Escapes special HTML characters to prevent XSS.
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  window.addEventListener('click', function (e) {
    const menu = document.getElementById('profile-dropdown-menu');
    const btn = document.getElementById('avatar-circle-btn');
    if (menu && menu.classList.contains('show')) {
      if (!menu.contains(e.target) && (!btn || !btn.contains(e.target))) {
        menu.classList.remove('show');
      }
    }
  });

  document.addEventListener('DOMContentLoaded', init);

  return {
    setCategoryFilter,
    applyFilters,
    toggleDrawer,
    toggleQrSection,
    deleteBill,
    clearAllBills,
    toggleProfileDropdown,
    handleLogout,
    promptEditUpiId,
    toggleTheme,
    toggleDebt,
    toggleAllDebts,
    editBillUpiId
  };
})();
