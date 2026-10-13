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

  // init
  async function init() {
    initTheme();
    await checkUser();
    updateUpiDisplay();
    await loadHistory();
  }

  // init theme
  function initTheme() {
    const saved = localStorage.getItem('splitwise_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeButton(saved);
  }

  // toggle theme
  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('splitwise_theme', next);
    updateThemeButton(next);
  }

  // update theme button
  function updateThemeButton(theme) {
    const btn = document.getElementById('theme-toggle-btn');
    const icon = document.getElementById('theme-icon');
    if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙';
    if (btn) btn.title = theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
  }

  // check user
  async function checkUser() {
    try {
      const user = await ApiService.auth.getMe();
      updateAuthUI(user);
    } catch {
      updateAuthUI(null);
    }
  }

  // update auth ui
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

  // toggle profile dropdown
  function toggleProfileDropdown(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('profile-dropdown-menu');
    if (menu) menu.classList.toggle('show');
  }

  // logout
  async function handleLogout() {
    const menu = document.getElementById('profile-dropdown-menu');
    if (menu) menu.classList.remove('show');
    try {
      await ApiService.auth.logout();
    } catch {}
    updateAuthUI(null);
    window.location.href = 'index.html';
  }

  // update upi display
  function updateUpiDisplay() {
    const el = document.getElementById('menu-upi-id');
    if (el) el.textContent = defaultUpiId;
  }

  // edit default upi
  function promptEditUpiId() {
    const entered = prompt('Enter your default UPI ID (e.g. name@okhdfcbank):', defaultUpiId);
    if (entered && entered.trim().length > 0) {
      defaultUpiId = entered.trim();
      localStorage.setItem('splitwise_default_upi', defaultUpiId);
      updateUpiDisplay();
    }
  }

  // load bills from firebase
  async function loadHistory() {
    const listEl = document.getElementById('history-bills-list');
    const emptyEl = document.getElementById('empty-state');
    if (listEl) {
      listEl.innerHTML = `
        <div style="text-align: center; padding: 48px 20px; color: var(--text-dim);">
          <div style="display: inline-block; width: 28px; height: 28px; border: 3px solid rgba(255,255,255,0.15); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 12px;"></div>
          <div style="font-size: 13px;">Loading bills from Firebase...</div>
        </div>
      `;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    try {
      allBills = await ApiService.bills.getAll();
      renderStats();
      applyFilters();
    } catch (err) {
      console.error('Failed to load history:', err);
      if (listEl) {
        const isPerm = (err.message || '').toLowerCase().includes('permission');
        listEl.innerHTML = `
          <div style="text-align: center; padding: 36px 20px; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); max-width: 580px; margin: 20px auto;">
            <div style="font-size: 32px; margin-bottom: 10px;">⚠️</div>
            <div style="font-size: 15px; font-weight: 700; color: var(--rose); margin-bottom: 8px;">
              ${isPerm ? 'Firestore Permission Denied' : 'Unable to Load Bills'}
            </div>
            <div style="font-size: 13px; color: var(--text-dim); margin-bottom: 16px; line-height: 1.5;">
              ${isPerm 
                ? 'Your Firebase Firestore Security Rules are currently denying read access to the bills collection.' 
                : escapeHtml(err.message)}
            </div>
            ${isPerm ? `
              <div style="text-align: left; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; margin-bottom: 16px; font-family: monospace; font-size: 11.5px; line-height: 1.5; color: var(--accent);">
                rules_version = '2';<br>
                service cloud.firestore {<br>
                &nbsp;&nbsp;match /databases/{database}/documents {<br>
                &nbsp;&nbsp;&nbsp;&nbsp;match /{document=**} {<br>
                &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;allow read, write: if true;<br>
                &nbsp;&nbsp;&nbsp;&nbsp;}<br>
                &nbsp;&nbsp;}<br>
                }
              </div>
              <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 14px;">
                In Firebase Console &rarr; <b>Firestore Database</b> &rarr; <b>Rules</b>, paste the rules above and click <b>Publish</b>.
              </p>
            ` : ''}
            <button class="btn btn-primary btn-sm" onclick="historyApp.loadHistory()">Try Again</button>
          </div>
        `;
      }
    }
  }

  // is bill settled
  function isBillSettled(bill) {
    if (!bill) return false;
    if (bill.settled === true || bill.isSettled === true || bill.status === 'settled') return true;
    const debts = bill.debts || [];
    if (debts.length === 0) return true;
    return debts.every(d => d.settled === true || d.status === 'settled' || d.paid === true);
  }

  // render stats
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
          if (isPaid) totalSettled += Number(d.amount || 0);
          else totalPending += Number(d.amount || 0);
        });
      }
    });

    document.getElementById('stat-total-bills').textContent = allBills.length;
    document.getElementById('stat-total-spend').textContent = `₹${totalSpend.toFixed(2)}`;
    document.getElementById('stat-total-settled').textContent = `₹${totalSettled.toFixed(2)}`;
    document.getElementById('stat-total-pending').textContent = `₹${totalPending.toFixed(2)}`;
  }

  // set category filter
  function setCategoryFilter(cat, btn) {
    activeCategory = cat;
    document.querySelectorAll('.filter-pill').forEach(el => el.classList.remove('active'));
    if (btn) btn.classList.add('active');
    applyFilters();
  }

  // apply filters
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

  // render bills list
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

            <div class="history-amount-group">
              <span class="badge ${statusClass}">${statusText}</span>
              <div class="history-total">₹${totalFormatted}</div>
              <div class="history-paid-by">Paid by <strong>${escapeHtml(bill.payer || 'Self')}</strong></div>
            </div>
          </div>

          <div class="history-debts-summary">
            ${debts.length === 0 ? `
              <span style="color: var(--text-muted); font-size: 12px;">No split debts recorded</span>
            ` : debts.map(d => {
              const isPaid = (d.settled === true || d.status === 'settled' || d.paid === true);
              const pillClass = isPaid ? 'paid' : 'pending';
              const fromName = escapeHtml(d.from || 'Friend');
              const toName = escapeHtml(d.to || bill.payer || 'Payer');
              const amtStr = Number(d.amount || 0).toFixed(2);

              return `
                <div class="debt-pill ${pillClass}">
                  <span class="debt-pill-name">
                    ${fromName} owes ${toName}
                  </span>
                  <span class="debt-pill-amt">₹${amtStr}</span>
                  <button type="button" class="debt-pill-btn"
                    onclick="historyApp.toggleDebt('${bill.id}', '${fromName}')"
                    title="${isPaid ? 'Mark as Pending' : 'Mark as Paid'}">
                    ${isPaid ? '✓ Paid' : '○ Mark Paid'}
                  </button>
                </div>
              `;
            }).join('')}
          </div>

          <div class="history-actions-bar">
            <button class="btn btn-secondary btn-sm" onclick="historyApp.toggleDrawer('${bill.id}')">
              ${openDrawers.has(bill.id) ? '▲ Hide Details' : '▼ View Items'}
            </button>
            <button class="btn btn-secondary btn-sm" onclick="historyApp.toggleQrSection('${bill.id}')">
              ${isQrOpen ? '✕ Hide QR' : '📱 Show QR'}
            </button>
            <div style="flex: 1;"></div>
            ${debts.length > 0 ? `
              <button class="btn btn-outline btn-sm" onclick="historyApp.toggleAllDebts('${bill.id}', ${!isSettled})" style="font-size: 11px;">
                ${isSettled ? 'Mark All Pending' : '✓ Mark All Paid'}
              </button>
            ` : ''}
          </div>

          <div class="history-drawer ${openDrawers.has(bill.id) ? 'show' : ''}" id="drawer-${bill.id}">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <h4 style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); margin: 0;">
                Itemized Breakdown (${itemsCount})
              </h4>
            </div>

            <div class="history-items-table">
              ${(bill.items || []).map(it => {
                const assignees = Array.isArray(it.assignedTo) ? it.assignedTo.join(', ') : 'All';
                const qty = it.quantity || 1;
                const price = Number(it.price || 0).toFixed(2);
                return `
                  <div class="history-item-row">
                    <div>
                      <div class="item-name">${escapeHtml(it.name || 'Item')} ${qty > 1 ? `<span style="color: var(--text-dim); font-size: 11px;">×${qty}</span>` : ''}</div>
                      <div class="item-assigned">Shared with: ${escapeHtml(assignees || 'All')}</div>
                    </div>
                    <div class="item-price">₹${price}</div>
                  </div>
                `;
              }).join('')}
            </div>

            <div class="history-tax-calc">
              <span>Tax / GST: ₹${Number(bill.tax || 0).toFixed(2)}</span>
              <span>•</span>
              <span>Tip / Charges: ₹${Number(bill.tip || 0).toFixed(2)}</span>
              <span>•</span>
              <span>Total: ₹${totalFormatted}</span>
            </div>
          </div>

          <div class="history-qr-section ${isQrOpen ? 'show' : ''}" id="qr-section-${bill.id}">
            ${renderQrSectionHtml(bill, debts, unpaidDebts, receivingUpi)}
          </div>

          <div style="margin-top: 10px; display: flex; justify-content: flex-end;">
            <button class="btn btn-danger btn-sm" onclick="historyApp.deleteBill('${bill.id}')">
              Delete
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // toggle drawer
  function toggleDrawer(billId) {
    if (openDrawers.has(billId)) openDrawers.delete(billId);
    else openDrawers.add(billId);
    const drawer = document.getElementById(`drawer-${billId}`);
    if (drawer) drawer.classList.toggle('show', openDrawers.has(billId));
  }

  // toggle qr section
  function toggleQrSection(billId) {
    if (openQrBills.has(billId)) openQrBills.delete(billId);
    else openQrBills.add(billId);
    applyFilters();
  }

  // render qr section
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

  // toggle debt status
  async function toggleDebt(billId, personFrom) {
    const bill = allBills.find(b => b.id === billId);
    if (!bill) return;

    const debts = bill.debts || [];
    const target = debts.find(d => (d.from || '').toLowerCase().trim() === personFrom.toLowerCase().trim());
    const newStatus = target ? !target.settled : true;

    if (target) target.settled = newStatus;
    else {
      debts.forEach(d => {
        if ((d.from || '').toLowerCase().trim() === personFrom.toLowerCase().trim()) d.settled = newStatus;
      });
    }

    renderStats();
    applyFilters();

    try {
      await ApiService.bills.updateDebtStatus(billId, personFrom, newStatus);
    } catch (err) {
      console.warn('Failed to update debt status:', err);
    }
  }

  // toggle all debts
  async function toggleAllDebts(billId, setSettled) {
    const bill = allBills.find(b => b.id === billId);
    if (!bill) return;

    (bill.debts || []).forEach(d => d.settled = setSettled);
    renderStats();
    applyFilters();

    try {
      await ApiService.bills.updateDebtStatus(billId, 'all', setSettled);
    } catch (err) {
      console.warn('Failed to update all debts:', err);
    }
  }

  // delete bill
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

  // clear all bills
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

  // edit bill upi
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
        console.error('Failed to update UPI ID:', err);
      }
      applyFilters();
    }
  }

  // escape html
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
    loadHistory,
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
