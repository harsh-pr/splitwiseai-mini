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
    trip: '✈️',
    general: '🧾'
  };

  let defaultUpiId = localStorage.getItem('splitwise_default_upi') || 'harsh@upi';

  // Initializes themes, user status, UPI display, and loads saved bills.
  async function init() {
    initTheme();
    checkUser();
    updateUpiDisplay();
    setupModalEvents();
    await loadHistory();
  }

  // Sets up scrolling and escape key event listeners for the breakdown modal.
  function setupModalEvents() {
    const modal = document.getElementById('user-breakdown-modal');
    if (modal) {
      modal.addEventListener('wheel', (e) => {
        const scrollable = e.target.closest('#modal-breakdown-body');
        if (!scrollable) {
          e.preventDefault();
        }
      }, { passive: false });

      modal.addEventListener('touchmove', (e) => {
        const scrollable = e.target.closest('#modal-breakdown-body');
        if (!scrollable) {
          e.preventDefault();
        }
      }, { passive: false });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeBreakdownModal();
      }
    });
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
                <button type="button" class="chip chip-clickable ${isPaid ? 'chip-paid' : ''}" 
                  onclick="historyApp.showUserBreakdown('${bill.id}', '${escapeHtml(p)}')" 
                  title="Click to view breakdown for ${escapeHtml(p)}">
                  👤 ${escapeHtml(p)} ${userDebt ? (isPaid ? '✓' : `(₹${Math.round(userDebt.amount)})`) : ''}
                </button>
              `;
            }).join('')}
          </div>

          <div class="history-drawer" id="drawer-${bill.id}">
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

          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border-light);">
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-secondary btn-sm" onclick="historyApp.toggleDrawer('${bill.id}')">
                View Items & Debts ▾
              </button>
              ${debts.length > 0 ? `
                <button class="btn ${isSettled ? 'btn-secondary' : 'btn-primary'} btn-sm" 
                  onclick="historyApp.toggleAllDebts('${bill.id}', ${!isSettled})">
                  ${isSettled ? 'Reopen' : '✓ Mark Paid'}
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
    const drawer = document.getElementById(`drawer-${billId}`);
    if (drawer) {
      drawer.classList.toggle('show');
    }
  }

  let currentModalBillId = null;
  let currentModalPerson = null;

  // Shows a modal with itemized cost breakdown and UPI QR code for a person.
  function showUserBreakdown(billId, personName) {
    const bill = allBills.find(b => b.id === billId);
    if (!bill) return;

    currentModalBillId = billId;
    currentModalPerson = personName;

    const modal = document.getElementById('user-breakdown-modal');
    const avatarEl = document.getElementById('modal-user-avatar');
    const nameEl = document.getElementById('modal-user-name');
    const titleEl = document.getElementById('modal-bill-title');
    const bodyEl = document.getElementById('modal-breakdown-body');
    const footerEl = document.getElementById('modal-breakdown-footer');

    if (!modal) return;

    const initial = (personName || 'U').trim().charAt(0).toUpperCase();
    if (avatarEl) avatarEl.textContent = initial;
    if (nameEl) nameEl.textContent = personName;
    if (titleEl) titleEl.textContent = `in "${bill.title || 'Expense'}" (${new Date(bill.createdAt || Date.now()).toLocaleDateString()})`;

    const isPayer = (bill.payer || '').toLowerCase().trim() === personName.toLowerCase().trim();
    const debts = bill.debts || [];
    const userDebt = debts.find(d => (d.from || '').toLowerCase().trim() === personName.toLowerCase().trim());
    const isPaid = userDebt ? (userDebt.settled === true || userDebt.status === 'settled' || userDebt.paid === true) : true;

    const personDishes = [];
    let personSubtotal = 0;

    (bill.items || []).forEach(it => {
      const assignees = (it.assignedTo && it.assignedTo.length > 0)
        ? it.assignedTo
        : ((it.assigned && it.assigned.length > 0) ? it.assigned : (bill.participants || []));

      const isAssigned = assignees.some(a => a.toLowerCase().trim() === personName.toLowerCase().trim());
      if (isAssigned) {
        const shareCount = assignees.length || 1;
        const others = assignees.filter(a => a.toLowerCase().trim() !== personName.toLowerCase().trim());
        const q = Number(it.quantity || it.qty || 1);
        let shareDesc = shareCount === 1 ? 'Solo order' : `Shared with ${others.join(', ')} (1 of ${shareCount} shares)`;
        if (q > 1) {
          const unitPrice = (Number(it.price) / q).toFixed(0);
          shareDesc += ` • ${q} Qty @ ₹${unitPrice}`;
        }
        const portionCost = Number(it.price || 0) / shareCount;
        personSubtotal += portionCost;
        personDishes.push({
          name: it.name || 'Dish',
          desc: shareDesc,
          cost: portionCost,
          fullPrice: Number(it.price || 0)
        });
      }
    });

    const itemsTotal = (bill.items || []).reduce((s, it) => s + Number(it.price || 0), 0);
    const isTaxInclusive = !!(bill.categoryMeta && bill.categoryMeta.taxInclusive);
    const taxTipRatio = itemsTotal > 0 ? (personSubtotal / itemsTotal) : (1 / (bill.participants.length || 1));
    const personTax = isTaxInclusive ? 0 : (Number(bill.tax || 0) * taxTipRatio);
    const personTip = Number(bill.tip || 0) * taxTipRatio;
    const personTotal = personSubtotal + personTax + personTip;

    let bodyHtml = `
      <div style="margin-bottom: 12px;">
        <span class="breakdown-role-badge ${isPayer ? 'breakdown-role-payer' : 'breakdown-role-debtor'}">
          ${isPayer ? '🛡️ Payer (Paid Upfront)' : '👤 Participant'}
        </span>
      </div>

      <div class="breakdown-section-title">Itemized Dishes (${personDishes.length})</div>
    `;

    if (personDishes.length === 0) {
      bodyHtml += `<div style="color: var(--text-muted); font-size: 13px; padding: 10px 0;">No individual dishes allocated.</div>`;
    } else {
      personDishes.forEach(d => {
        bodyHtml += `
          <div class="breakdown-dish-row">
            <div>
              <div class="breakdown-dish-name">${escapeHtml(d.name)}</div>
              <div class="breakdown-dish-meta">${escapeHtml(d.desc)}</div>
            </div>
            <div class="breakdown-dish-amt">₹${d.cost.toFixed(2)}</div>
          </div>
        `;
      });
    }

    bodyHtml += `
      <div class="breakdown-summary-box">
        <div class="breakdown-stat-line">
          <span>Dishes Subtotal:</span>
          <strong>₹${personSubtotal.toFixed(2)}</strong>
        </div>
        ${((!isTaxInclusive && Number(bill.tax || 0) > 0) || Number(bill.tip || 0) > 0) ? `
          <div class="breakdown-stat-line">
            <span>Tax & Tip Share:</span>
            <span>₹${(personTax + personTip).toFixed(2)}</span>
          </div>
        ` : (isTaxInclusive && Number(bill.tax || 0) > 0 ? `
          <div class="breakdown-stat-line" style="color: var(--text-dim); font-size: 11px;">
            <span>GST Included in bill:</span>
            <span>₹${(Number(bill.tax || 0) * taxTipRatio).toFixed(2)}</span>
          </div>
        ` : '')}
        <div class="breakdown-total-line">
          <span>Total Calculated Share:</span>
          <span style="color: var(--text);">₹${personTotal.toFixed(2)}</span>
        </div>
      </div>
    `;

    if (!isPayer && userDebt) {
      if (!isPaid) {
        const receivingUpi = (bill.upiId || bill.receiverUpi || defaultUpiId || 'harsh@upi').trim();
        const payerName = bill.payer || 'Payer';
        const billTitle = bill.title || 'Bill';
        const debtAmt = Number(userDebt.amount || personTotal || 0).toFixed(2);
        const upiLink = `upi://pay?pa=${encodeURIComponent(receivingUpi)}&pn=${encodeURIComponent(payerName)}&am=${debtAmt}&cu=INR&tn=SplitWise%20${encodeURIComponent(billTitle)}`;
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(upiLink)}`;

        bodyHtml += `
          <div style="background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 14px; text-align: center; margin-top: 14px;">
            <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 8px;">
              📲 Scan QR to Pay ₹${Math.round(userDebt.amount)} to ${escapeHtml(payerName)}
            </div>
            <div class="qr-box" style="margin: 0 auto 8px auto; background: #ffffff; padding: 6px; border-radius: var(--radius-sm); display: inline-block;">
              <img src="${qrUrl}" alt="UPI QR Code" style="width: 140px; height: 140px; display: block;">
            </div>
            <div style="font-size: 11px; color: var(--text-dim); font-family: var(--font-mono); display: flex; align-items: center; justify-content: center; gap: 8px;">
              <span>UPI ID: <strong style="color: var(--text);">${escapeHtml(receivingUpi)}</strong></span>
              <button type="button" class="btn btn-secondary btn-sm" onclick="historyApp.editBillUpiId('${bill.id}')" style="padding: 1px 6px; font-size: 10px;" title="Change receiving UPI ID for this bill">Edit</button>
            </div>
          </div>
        `;
      } else {
        bodyHtml += `
          <div style="background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px; text-align: center; margin-top: 14px; color: var(--emerald); font-size: 13px; font-weight: 600;">
            ✓ Payment Settled & Complete
          </div>
        `;
      }
    }

    if (isPayer) {
      const debtsToReceive = debts.filter(d => (d.to || bill.payer || '').toLowerCase().trim() === personName.toLowerCase().trim());
      bodyHtml += `
        <div class="breakdown-section-title" style="margin-top: 14px;">Payments from Group</div>
        <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 8px;">
          Paid full bill upfront: <strong>₹${Number(bill.totalAmount || 0).toFixed(2)}</strong>
        </div>
      `;
      if (debtsToReceive.length > 0) {
        debtsToReceive.forEach(d => {
          const debtorPaid = (d.settled === true || d.status === 'settled' || d.paid === true);
          bodyHtml += `
            <div class="drawer-item" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0;">
              <div>
                <span><strong>${escapeHtml(d.from)}</strong> owes you</span>
                <span style="font-size: 11px; margin-left: 6px; color: ${debtorPaid ? 'var(--emerald)' : 'var(--text-dim)'};">
                  ${debtorPaid ? '✓ Paid' : '⏱ Pending'}
                </span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <strong style="color: var(--emerald);">₹${Number(d.amount || 0).toFixed(2)}</strong>
                <button class="btn ${debtorPaid ? 'btn-secondary' : 'btn-primary'} btn-sm" 
                  onclick="historyApp.toggleDebt('${bill.id}', '${escapeHtml(d.from)}')" 
                  style="padding: 2px 7px; font-size: 11px;">
                  ${debtorPaid ? 'Mark Pending' : '✓ Mark Paid'}
                </button>
              </div>
            </div>
          `;
        });
      } else {
        bodyHtml += `<div style="color: var(--text-muted); font-size: 12px;">No debts to collect from others.</div>`;
      }
    }

    bodyEl.innerHTML = bodyHtml;

    if (isPayer) {
      footerEl.innerHTML = `
        <span class="badge-status badge-paid" style="padding: 5px 12px;">✓ Paid Entire Bill Upfront</span>
        <button type="button" class="btn btn-secondary btn-sm" onclick="historyApp.closeBreakdownModal()">Close</button>
      `;
    } else if (userDebt) {
      footerEl.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 12px; color: var(--text-muted);">Debt Status:</span>
          <span class="badge-status ${isPaid ? 'badge-paid' : 'badge-pending'}" style="padding: 4px 10px;">
            ${isPaid ? '✓ Payment Settled' : '⏱ Payment Pending'}
          </span>
        </div>
        <div style="display: flex; gap: 8px;">
          <button type="button" class="btn ${isPaid ? 'btn-secondary' : 'btn-primary'} btn-sm" 
            onclick="historyApp.toggleDebt('${bill.id}', '${escapeHtml(personName)}')">
            ${isPaid ? 'Mark as Pending' : '✓ Mark as Paid'}
          </button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="historyApp.closeBreakdownModal()">Close</button>
        </div>
      `;
    } else {
      footerEl.innerHTML = `
        <span style="font-size: 12px; color: var(--text-muted);">No remaining debt for this bill.</span>
        <button type="button" class="btn btn-secondary btn-sm" onclick="historyApp.closeBreakdownModal()">Close</button>
      `;
    }

    modal.classList.add('show');
    document.body.classList.add('modal-open');
    document.documentElement.classList.add('modal-open');
  }

  // Closes the user breakdown modal dialog.
  function closeBreakdownModal() {
    const modal = document.getElementById('user-breakdown-modal');
    if (modal) modal.classList.remove('show');
    document.body.classList.remove('modal-open');
    document.documentElement.classList.remove('modal-open');
    currentModalBillId = null;
    currentModalPerson = null;
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

    if (currentModalBillId === billId && currentModalPerson) {
      showUserBreakdown(currentModalBillId, currentModalPerson);
    }

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

    if (currentModalBillId === billId && currentModalPerson) {
      showUserBreakdown(currentModalBillId, currentModalPerson);
    }

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
      if (currentModalBillId === billId && currentModalPerson) {
        showUserBreakdown(billId, currentModalPerson);
      }
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
    deleteBill,
    clearAllBills,
    toggleProfileDropdown,
    handleLogout,
    promptEditUpiId,
    toggleTheme,
    showUserBreakdown,
    closeBreakdownModal,
    toggleDebt,
    toggleAllDebts,
    editBillUpiId
  };
})();
