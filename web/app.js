// Controls the bill splitting wizard, AI chat, live items editor, and payment settlement.
const app = (function () {
  let currentUser = null;
  let currentStep = 1;
  let currentCategory = 'restaurant';
  let currentReceiptFile = null;
  let currentMerchant = 'Restaurant & Dining';
  let currentPayer = '';
  let currentParticipants = [];
  let currentItems = [];
  let currentTax = 0.0;
  let currentTip = 0.0;
  let currentTaxInclusive = false;
  let defaultUpiId = localStorage.getItem('splitwise_default_upi') || 'harsh@upi';
  let billUpiId = defaultUpiId;
  let currentDebts = [];
  let paidStatusMap = {};
  let authMode = 'login';
  let expandedBreakdowns = {};
  let currentCategoryMeta = null;
  let currentUtilityMode = 'auto';
  let currentBillingDays = 30;
  let currentBillingPeriod = 'Monthly Bill (30 Days)';
  let currentBillTotal = 0.0;

  // Initializes the application, loads user state, themes, and binds event listeners.
  function init() {
    initTheme();
    checkAuth();
    updateUpiDisplay();
    setupDropzone();
    setupChatInput();
    setupAuthModalEvents();
    renderFriendsChips();
    renderPayerSelect();
  }

  // Sets up scrolling and escape key event listeners for the authentication modal.
  function setupAuthModalEvents() {
    const modal = document.getElementById('auth-modal');
    if (modal) {
      modal.addEventListener('wheel', (e) => {
        const scrollable = e.target.closest('.modal-box');
        if (!scrollable) {
          e.preventDefault();
        }
      }, { passive: false });

      modal.addEventListener('touchmove', (e) => {
        const scrollable = e.target.closest('.modal-box');
        if (!scrollable) {
          e.preventDefault();
        }
      }, { passive: false });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeAuthModal();
      }
    });
  }

  // Configures auto-resizing and enter-key submission for the chat input box.
  function setupChatInput() {
    const input = document.getElementById('chat-input-box');
    if (!input) return;
    input.addEventListener('input', function () {
      this.style.height = '46px';
      if (this.scrollHeight > 46) {
        this.style.height = Math.min(this.scrollHeight, 100) + 'px';
        this.style.overflowY = this.scrollHeight > 100 ? 'auto' : 'hidden';
      } else {
        this.style.overflowY = 'hidden';
      }
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleChatSubmit(e);
      }
    });
  }

  // Loads and applies the saved color theme from storage.
  function initTheme() {
    const saved = localStorage.getItem('splitwise_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeButton(saved);
  }

  // Switches between dark and light themes and saves the preference.
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

  // Updates displayed UPI IDs across menus and inputs.
  function updateUpiDisplay() {
    const menuUpi = document.getElementById('menu-upi-id');
    const displayUpi = document.getElementById('display-upi-id');
    const customInput = document.getElementById('custom-upi-input');
    const effectiveBillUpi = billUpiId || defaultUpiId;
    if (menuUpi) menuUpi.textContent = defaultUpiId;
    if (displayUpi) displayUpi.textContent = effectiveBillUpi;
    if (customInput && document.activeElement !== customInput) {
      customInput.value = effectiveBillUpi;
    }
  }

  // Prompts user to change the default account UPI ID.
  function promptEditUpiId() {
    const entered = prompt('Enter your default account UPI ID (e.g. name@okhdfcbank):', defaultUpiId);
    if (entered && entered.trim().length > 0) {
      defaultUpiId = entered.trim();
      localStorage.setItem('splitwise_default_upi', defaultUpiId);
      if (!billUpiId || billUpiId === defaultUpiId) {
        billUpiId = defaultUpiId;
      }
      updateUpiDisplay();
      if (currentStep === 4 || currentStep === 5) {
        computeDebtsAndRenderQRs();
        if (currentStep === 5) renderSummaryStep();
      }
      showBanner(`Default account UPI ID updated to ${defaultUpiId}`, 'success');
    }
  }

  // Updates the receiving UPI ID for the current bill as the user types.
  function handleUpiInput(val) {
    if (val !== undefined && val !== null) {
      const clean = String(val).trim();
      if (clean.length > 0) {
        billUpiId = clean;
        const displayUpi = document.getElementById('display-upi-id');
        if (displayUpi) displayUpi.textContent = billUpiId;
        computeDebtsAndRenderQRs();
        if (currentStep === 5) renderSummaryStep();
      }
    }
  }

  // Saves a manual UPI ID entered for the current bill.
  function updateUpiId(manualVal) {
    const customInput = document.getElementById('custom-upi-input');
    const val = (typeof manualVal === 'string' ? manualVal : (customInput ? customInput.value : '')).trim();
    if (val) {
      billUpiId = val;
      const displayUpi = document.getElementById('display-upi-id');
      if (displayUpi) displayUpi.textContent = billUpiId;
      computeDebtsAndRenderQRs();
      if (currentStep === 5) renderSummaryStep();
      showBanner(`Receiving UPI ID for this split set to ${billUpiId}`, 'success');
    }
  }

  // Checks if a user session exists and sets current user details.
  async function checkAuth() {
    try {
      currentUser = await ApiService.auth.getMe();
      updateAuthUI();
      renderFriendsChips();
      renderPayerSelect();
    } catch {
      currentUser = null;
      updateAuthUI();
    }
  }

  // Updates the navigation bar based on whether a user is logged in.
  function updateAuthUI() {
    const loginBtn = document.getElementById('auth-login-btn');
    const dropdownWrap = document.getElementById('profile-dropdown-wrap');
    const avatarInitial = document.getElementById('avatar-initial');
    const menuName = document.getElementById('menu-user-name');
    const menuEmail = document.getElementById('menu-user-email');

    if (currentUser) {
      if (loginBtn) loginBtn.style.display = 'none';
      if (dropdownWrap) dropdownWrap.style.display = 'inline-block';
      const initial = (currentUser.name || 'U').trim().charAt(0).toUpperCase();
      if (avatarInitial) avatarInitial.textContent = initial;
      if (menuName) menuName.textContent = currentUser.name || 'User';
      if (menuEmail) menuEmail.textContent = currentUser.email || '';
    } else {
      if (loginBtn) loginBtn.style.display = 'inline-flex';
      if (dropdownWrap) dropdownWrap.style.display = 'none';
    }
  }

  // Opens or closes the profile dropdown menu in the header.
  function toggleProfileDropdown(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('profile-dropdown-menu');
    if (menu) {
      menu.classList.toggle('show');
    }
  }

  // Logs out the user and clears session state.
  function handleLogout() {
    const menu = document.getElementById('profile-dropdown-menu');
    if (menu) menu.classList.remove('show');
    ApiService.auth.logout().then(() => {
      currentUser = null;
      updateAuthUI();
      showBanner('Logged out successfully', 'success');
    }).catch(() => {
      currentUser = null;
      updateAuthUI();
    });
  }

  // Opens the login or sign-up modal dialog.
  function openAuthModal() {
    authMode = 'login';
    const b = document.getElementById('auth-banner');
    if (b) {
      b.className = 'banner';
      b.textContent = '';
      b.style.display = 'none';
    }
    renderAuthModal();
    const modal = document.getElementById('auth-modal');
    if (modal) modal.classList.add('show');
    document.body.classList.add('modal-open');
    document.documentElement.classList.add('modal-open');
    setTimeout(() => {
      const emailInput = document.getElementById('auth-email');
      if (emailInput) emailInput.focus();
    }, 100);
  }

  // Closes the authentication modal dialog.
  function closeAuthModal() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.classList.remove('show');
    document.body.classList.remove('modal-open');
    document.documentElement.classList.remove('modal-open');
  }

  // Switches the modal between login and sign-up modes.
  function toggleAuthMode(e) {
    if (e) e.preventDefault();
    authMode = (authMode === 'login') ? 'register' : 'login';
    const b = document.getElementById('auth-banner');
    if (b) {
      b.className = 'banner';
      b.textContent = '';
      b.style.display = 'none';
    }
    renderAuthModal();
  }

  // Updates modal text and fields based on login or sign-up mode.
  function renderAuthModal() {
    const isLogin = (authMode === 'login');
    const titleEl = document.getElementById('auth-modal-title');
    const nameGrp = document.getElementById('auth-name-group');
    const submitBtn = document.getElementById('auth-submit-btn');
    const toggleMsg = document.getElementById('auth-toggle-msg');
    const toggleLink = document.getElementById('auth-toggle-link');

    if (titleEl) titleEl.textContent = isLogin ? 'Login' : 'Create Account';
    if (nameGrp) nameGrp.style.display = isLogin ? 'none' : 'block';
    if (submitBtn) submitBtn.textContent = isLogin ? 'Login' : 'Sign Up';
    if (toggleMsg) toggleMsg.textContent = isLogin ? "Don't have an account?" : 'Already have an account?';
    if (toggleLink) toggleLink.textContent = isLogin ? 'Sign Up' : 'Login';
  }

  // Submits the login or registration form to the backend.
  async function handleAuthSubmit(e) {
    e.preventDefault();
    const emailEl = document.getElementById('auth-email');
    const passEl = document.getElementById('auth-password');
    const nameEl = document.getElementById('auth-name');
    const btn = document.getElementById('auth-submit-btn');
    const banner = document.getElementById('auth-banner');

    const email = emailEl ? emailEl.value.trim() : '';
    const password = passEl ? passEl.value : '';
    const name = nameEl ? nameEl.value.trim() : '';

    if (!email || !password) {
      if (banner) {
        banner.className = 'banner banner-error show';
        banner.style.display = 'block';
        banner.textContent = 'Please enter email and password.';
      }
      return;
    }

    if (btn) btn.disabled = true;

    try {
      if (authMode === 'login') {
        currentUser = await ApiService.auth.login(email, password);
      } else {
        currentUser = await ApiService.auth.register(name || 'User', email, password);
      }
      closeAuthModal();
      showBanner(`Welcome, ${currentUser.name}!`, 'success');
      checkAuth();
    } catch (err) {
      if (banner) {
        banner.className = 'banner banner-error show';
        banner.style.display = 'block';
        banner.textContent = err.message || 'Authentication failed';
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // Moves wizard navigation to the specified step number.
  function goToStep(step) {
    if (step < 1 || step > 5) return;
    currentStep = step;

    for (let i = 1; i <= 5; i++) {
      const panel = document.getElementById(`panel-step-${i}`);
      const pStep = document.getElementById(`p-step-${i}`);
      if (panel) {
        if (i === step) {
          panel.classList.add('active');
        } else {
          panel.classList.remove('active');
        }
      }
      if (pStep) {
        if (i === step) {
          pStep.className = 'progress-step active';
        } else if (i < step) {
          pStep.className = 'progress-step completed';
        } else {
          pStep.className = 'progress-step';
        }
      }
    }

    if (step === 3) {
      setupStep3CategoryGreeting();
      renderItemsPanel();
    } else if (step === 4) {
      const unassigned = currentItems.filter(it => !it.assignedTo || it.assignedTo.length === 0);
      if (unassigned.length > 0 && currentParticipants.length > 0) {
        const autoSplit = confirm(`Notice: ${unassigned.length} items are currently unassigned.\n\nClick OK to split them equally among all friends, or Cancel to go back and allocate them.`);
        if (autoSplit) {
          unassigned.forEach(it => it.assignedTo = [...currentParticipants]);
          renderItemsPanel();
        } else {
          goToStep(3);
          return;
        }
      }
      computeDebtsAndRenderQRs();
    } else if (step === 5) {
      renderSummaryStep();
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Displays a status notification message banner at the top.
  function showBanner(msg, type = 'success', timeout = 4000) {
    const b = document.getElementById('status-banner');
    if (!b) return;
    b.className = `banner banner-${type} show`;
    b.textContent = msg;
    if (timeout > 0) {
      setTimeout(() => b.classList.remove('show'), timeout);
    }
  }

  // Selects an expense category and updates UI elements.
  function selectCategory(cat, el) {
    currentCategory = cat;
    currentUtilityMode = 'auto';
    currentBillTotal = 0.0;
    expandedBreakdowns = {};
    document.querySelectorAll('.category-card').forEach(c => c.classList.remove('active'));
    if (el) el.classList.add('active');
    updateCategoryUI();
  }

  // Updates placeholder text and quick preset buttons for the active category.
  function updateCategoryUI() {
    const titleInput = document.getElementById('direct-split-title');
    if (titleInput) {
      const placeholders = {
        utilities: 'e.g. BESCOM Electricity, Tata Play Wi-Fi, Society Maintenance, Flat Rent',
        grocery: 'e.g. DMart Supermarket, Blinkit Snacks, Kirana Store',
        entertainment: 'e.g. BookMyShow Dune 2, PVR IMAX, Concert Tickets',
        restaurant: 'e.g. Social Cafe, Dominos Pizza, Dine-in Dinner'
      };
      titleInput.placeholder = placeholders[currentCategory] || 'Expense title';
    }

    const presetContainer = document.getElementById('direct-split-preset-chips');
    if (presetContainer) {
      const presetsByCategory = {
        utilities: [
          { label: '⚡ Electricity Bill', val: 'Electricity Bill' },
          { label: '📶 Wi-Fi / Broadband', val: 'Wi-Fi Broadband Bill' },
          { label: '🏢 Society Maintenance', val: 'Society Maintenance' },
          { label: '🏠 Flat Rent', val: 'Flat Rent' }
        ],
        grocery: [
          { label: '🛒 D-Mart Haul', val: 'DMart Supermarket' },
          { label: '⚡ Blinkit / Zepto', val: 'Blinkit Quick Mart' },
          { label: '🥛 Kirana Supplies', val: 'Kirana Supplies' }
        ],
        restaurant: [
          { label: '☕ Cafe Outing', val: 'Cafe Outing' },
          { label: '🍕 Dominos Pizza', val: 'Dominos Pizza' },
          { label: '🍽️ Dine-in Dinner', val: 'Dinner Bill' }
        ],
        entertainment: [
          { label: '🎟️ Movie Tickets', val: 'Cinema Movie Tickets' },
          { label: '🍿 IMAX & Snacks', val: 'IMAX Tickets & Popcorn' }
        ]
      };
      const list = presetsByCategory[currentCategory] || [];
      presetContainer.innerHTML = list.map(item => `
        <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 8px; border-radius: 12px; cursor: pointer;"
          onclick="app.setDirectSplitTitle('${escapeHtml(item.val)}')">${escapeHtml(item.label)}</button>
      `).join('');
    }

    updateDirectSplitButton();
  }

  // Fills the direct split title input with a preset value.
  function setDirectSplitTitle(val) {
    const titleInput = document.getElementById('direct-split-title');
    if (titleInput) {
      titleInput.value = val;
      titleInput.focus();
    }
  }

  // Updates the title of the bill across the UI.
  function updateSplitTitle(newTitle) {
    if (newTitle !== undefined && newTitle !== null) {
      currentMerchant = newTitle.trim() || 'Split Expense';
    }
    const nameEl = document.getElementById('items-merchant-name');
    if (nameEl) {
      nameEl.textContent = currentMerchant;
    }
    const summaryTitle = document.getElementById('summary-bill-title');
    if (summaryTitle) {
      summaryTitle.textContent = `${currentMerchant} - Split Summary`;
    }
  }

  // Shows the title input box so the user can edit the bill name.
  function startEditingTitle(step) {
    if (step === 3) {
      const viewEl = document.getElementById('step3-title-view');
      const editEl = document.getElementById('step3-title-edit');
      const input = document.getElementById('step3-title-input');
      if (viewEl) viewEl.style.display = 'none';
      if (editEl) editEl.style.display = 'flex';
      if (input) {
        input.value = (currentMerchant && currentMerchant !== 'Line Items') ? currentMerchant : '';
        input.focus();
        input.select();
      }
    } else if (step === 5) {
      const viewEl = document.getElementById('step5-title-view');
      const editEl = document.getElementById('step5-title-edit');
      const input = document.getElementById('step5-title-input');
      if (viewEl) viewEl.style.display = 'none';
      if (editEl) editEl.style.display = 'flex';
      if (input) {
        input.value = currentMerchant || '';
        input.focus();
        input.select();
      }
    }
  }

  // Saves the edited bill title and updates the screen.
  function saveEditingTitle(step) {
    let input = null;
    if (step === 3) {
      input = document.getElementById('step3-title-input');
    } else if (step === 5) {
      input = document.getElementById('step5-title-input');
    }

    if (input) {
      const newTitle = input.value.trim();
      if (newTitle) {
        currentMerchant = newTitle;
      }
    }

    cancelEditingTitle(step);

    const nameEl = document.getElementById('items-merchant-name');
    if (nameEl) nameEl.textContent = currentMerchant || 'Line Items';
    const summaryTitle = document.getElementById('summary-bill-title');
    if (summaryTitle) summaryTitle.textContent = `${currentMerchant} - Split Summary`;

    showBanner(`Split title updated to "${currentMerchant}"!`, 'success');
  }

  // Closes the title editing box without saving.
  function cancelEditingTitle(step) {
    if (step === 3) {
      const viewEl = document.getElementById('step3-title-view');
      const editEl = document.getElementById('step3-title-edit');
      if (viewEl) viewEl.style.display = 'flex';
      if (editEl) editEl.style.display = 'none';
    } else if (step === 5) {
      const viewEl = document.getElementById('step5-title-view');
      const editEl = document.getElementById('step5-title-edit');
      if (viewEl) viewEl.style.display = 'flex';
      if (editEl) editEl.style.display = 'none';
    }
  }

  // Shows category-specific starter instructions in the AI chat box.
  function setupStep3CategoryGreeting() {
    const isDirectSplit = currentCategoryMeta && currentCategoryMeta.directSplit;
    const isItemizedChat = isDirectSplit && (!currentCategoryMeta.hasFixedAmount || currentItems.length === 0);

    const greetings = {
      utilities: isItemizedChat
        ? `Ready to split ${currentMerchant}! Tell me who paid or mention how to split among friends.`
        : "Ready to split Flat & Utilities! Tell me who paid or mention how to split among friends.",
      grocery: isItemizedChat
        ? `Ready to split ${currentMerchant}! Tell me what items you bought (e.g. 'milk 60, eggs 120, rice 300'), who shares what, and who paid.`
        : "Ready to split groceries! I've itemized your supermarket/mart items. Tell me which items are shared household essentials and which are personal snacks.",
      entertainment: isItemizedChat
        ? `Ready to split ${currentMerchant}! Tell me tickets or concessions (e.g. '3 tickets for 600, popcorn 350'), who got what, and who paid.`
        : "Ready to split your outing! I've itemized tickets and concessions. Tell me who got which seats or who shared the popcorn & snacks.",
      restaurant: isItemizedChat
        ? `Ready to split ${currentMerchant}! Tell me what was ordered (e.g. '3 cold coffee for 300, 1 pizza for 250'), who had what, and who paid.`
        : "Ready to split dining! I've itemized the dishes and drinks. Tell me who ordered what or who covered the bill."
    };
    const box = document.getElementById('chat-messages');
    if (box) {
      box.innerHTML = `<div class="msg bot">${escapeHtml(greetings[currentCategory] || greetings.restaurant).replace(/\n/g, '<br>')}</div>`;
    }

    const input = document.getElementById('chat-input-box');
    if (input) {
      if (currentCategory === 'grocery') {
        input.placeholder = "e.g. 'Milk and rice are shared, chips for Sarthak'...";
      } else if (currentCategory === 'entertainment') {
        input.placeholder = "e.g. 'Harsh paid', '2 tickets for Rohan', 'Split tickets equally'...";
      } else {
        input.placeholder = "Type instruction (e.g. 'Harsh paid', 'Split equally')...";
      }
    }
  }

  // Updates direct split button text when an amount is typed.
  function updateDirectSplitButton() {
    const amtInput = document.getElementById('direct-split-amount');
    const btn = document.getElementById('btn-direct-split');
    if (!btn) return;
    const rawAmt = amtInput ? parseFloat(amtInput.value) : 0;
    if (rawAmt && !isNaN(rawAmt) && rawAmt > 0) {
      btn.textContent = `Quick Split ₹${Math.round(rawAmt)} ➔`;
    } else {
      btn.textContent = 'Itemize in Chat ➔';
    }
  }

  // Sets up a direct bill without receipt scanning and proceeds to step 3.
  function handleDirectSplit() {
    const titleInput = document.getElementById('direct-split-title');
    const amtInput = document.getElementById('direct-split-amount');
    const rawTitle = titleInput ? titleInput.value.trim() : '';
    const rawAmtStr = amtInput ? amtInput.value.trim() : '';
    const rawAmt = rawAmtStr ? parseFloat(rawAmtStr) : 0;
    const hasFixedAmount = !isNaN(rawAmt) && rawAmt > 0;

    const defaultTitles = {
      utilities: 'Flat Utilities Bill',
      grocery: 'Groceries & Mart',
      entertainment: 'Entertainment Outing',
      restaurant: 'Dining Expense'
    };

    const title = rawTitle || defaultTitles[currentCategory] || 'Shared Expense';
    currentMerchant = title;
    currentTax = 0.0;
    currentTip = 0.0;
    currentCategoryMeta = {
      subtitle: hasFixedAmount ? 'Direct Split (Fixed Amount)' : 'Itemized Split (AI Chat)',
      directSplit: true,
      hasFixedAmount: hasFixedAmount
    };
    if (currentCategory === 'utilities') {
      currentBillingDays = 30;
      currentBillingPeriod = 'Monthly Bill (30 Days)';
      currentCategoryMeta.billingDays = 30;
      currentCategoryMeta.billingPeriod = 'Monthly Bill (30 Days)';
    }

    if (currentParticipants.length === 0) {
      currentPayer = (currentUser && currentUser.name) ? currentUser.name : '';
      renderFriendsChips();
      renderPayerSelect();
    }

    if (hasFixedAmount) {
      currentBillTotal = Math.round(rawAmt * 100) / 100;
      const isSpecificItem = title.toLowerCase().includes('bill')
        || title.toLowerCase().includes('rent')
        || title.toLowerCase().includes('electricity')
        || title.toLowerCase().includes('wifi')
        || title.toLowerCase().includes('maintenance')
        || title.toLowerCase().includes('ticket');
      const initialItemName = isSpecificItem ? title : 'Bill Total';

      currentItems = [
        {
          name: initialItemName,
          quantity: 1,
          price: Math.round(rawAmt * 100) / 100,
          unitPrice: Math.round(rawAmt * 100) / 100,
          assignedTo: []
        }
      ];
      showBanner(`Created "${title}" for ₹${Math.round(rawAmt)}. Ready to split with friends!`, 'success');
    } else {
      currentBillTotal = 0.0;
      currentItems = [];
      showBanner(`Created "${title}". Tell the AI what was ordered in Step 3!`, 'success');
    }

    goToStep(3);
  }

  // Sets up drag-and-drop and file selection for bill uploads.
  function setupDropzone() {
    const dropzone = document.getElementById('receipt-dropzone');
    const input = document.getElementById('receipt-file-input');

    if (!dropzone || !input) return;

    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleReceiptFile(file);
    });

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        handleReceiptFile(e.dataTransfer.files[0]);
      }
    });
  }

  // Previews the selected image or PDF receipt.
  function handleReceiptFile(file) {
    currentReceiptFile = file;
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = document.getElementById('receipt-preview-img');
      const pdfPreview = document.getElementById('receipt-preview-pdf');
      const box = document.getElementById('preview-box');
      const topPrompt = document.getElementById('dropzone-top-prompt');
      if (topPrompt) topPrompt.style.display = 'none';

      if (isPdf) {
        if (img) img.style.display = 'none';
        if (pdfPreview) {
          pdfPreview.style.display = 'block';
          const sizeKb = Math.round(file.size / 1024);
          pdfPreview.innerHTML = `
            <div style="font-size: 38px; margin-bottom: 6px;">📄</div>
            <div style="font-weight: 600; font-size: 13px; color: var(--text-main); word-break: break-all;">${escapeHtml(file.name)}</div>
            <div style="font-size: 11px; color: var(--text-dim); margin-top: 4px;">PDF Invoice (${sizeKb} KB)</div>
          `;
        }
      } else {
        if (pdfPreview) pdfPreview.style.display = 'none';
        if (img) {
          img.src = e.target.result;
          img.style.display = 'block';
        }
      }
      if (box) {
        box.style.display = 'flex';
        box.style.flexDirection = 'column';
        box.style.alignItems = 'center';
        box.style.justifyContent = 'center';
      }
    };
    reader.readAsDataURL(file);
    showBanner(`Selected: ${file.name}. Click "Scan Receipt with AI" to analyze.`, 'success');
  }

  // Sends receipt image or document to AI to extract items and amounts.
  async function scanReceiptWithAI() {
    if (!currentReceiptFile) {
      alert('Please upload or select a bill/receipt photo or PDF first.');
      return;
    }

    const isPdf = currentReceiptFile.type === 'application/pdf' || currentReceiptFile.name.toLowerCase().endsWith('.pdf');
    const mimeType = isPdf ? 'application/pdf' : (currentReceiptFile.type || 'image/jpeg');

    const btn = document.getElementById('btn-scan-ocr');
    btn.disabled = true;
    btn.textContent = isPdf ? 'Analyzing PDF invoice with AI...' : 'Analyzing bill photo...';

    try {
      const base64 = await readFileAsBase64(currentReceiptFile);
      const data = await ApiService.ai.analyzeReceipt(base64, mimeType, currentCategory);

      currentMerchant = data.merchantName || data.restaurantName || 'Scanned Bill';
      currentTaxInclusive = !!data.taxInclusive;
      currentTax = Number(data.tax || data.infoGst || 0);
      currentTip = Number(data.tip || 0);
      currentUtilityMode = 'auto';
      currentCategoryMeta = {
        subtitle: data.categorySubtitle || '',
        confidence: data.confidence || '95%',
        taxInclusive: currentTaxInclusive,
        infoGst: currentTax
      };

      if (currentCategory === 'utilities') {
        currentBillingDays = parseInt(data.billingDays, 10) || 30;
        currentBillingPeriod = data.billingPeriod || data.billingMonth || `${currentBillingDays} Days (Monthly Bill)`;
        currentCategoryMeta.billingDays = currentBillingDays;
        currentCategoryMeta.billingPeriod = currentBillingPeriod;
      }

      if (currentParticipants.length === 0) {
        currentPayer = (currentUser && currentUser.name) ? currentUser.name : '';
        renderFriendsChips();
        renderPayerSelect();
      }

      if (Array.isArray(data.items) && data.items.length > 0) {
        const filtered = [];
        data.items.forEach(it => {
          const name = (it.name || '').trim();
          const p = Number(it.price || 0);
          if (!name || p <= 0) return;

          const lower = name.toLowerCase();
          const isTax = (currentCategory !== 'utilities') && (
            lower.includes('igst') || lower.includes('cgst') || lower.includes('sgst') ||
            lower.includes('gst') || /\b(tax|taxes|vat)\b/i.test(lower)
          );
          const isFee = (currentCategory !== 'utilities') && (
            lower.includes('booking charge') || lower.includes('booking fee') ||
            lower.includes('convenience fee') || lower.includes('convenience charge') ||
            lower.includes('platform fee') || lower.includes('platform charge') ||
            lower.includes('service fee') || lower.includes('internet handling') ||
            lower.includes('packaging charge') || lower.includes('delivery fee')
          );

          if (isTax) {
            if (currentTax <= 0) currentTax = p;
            return;
          }
          if (isFee) {
            if (currentTip <= 0) currentTip = p;
            return;
          }

          const q = parseInt(it.quantity || it.qty || it.count || 1, 10) || 1;
          const safeQ = Math.max(1, q);
          filtered.push({
            name: it.name || 'Item',
            quantity: safeQ,
            price: p,
            unitPrice: safeQ > 0 ? (p / safeQ) : p,
            assignedTo: []
          });
        });

        if (filtered.length > 0) {
          currentItems = filtered;
        } else {
          const p = Number(data.total || 0);
          currentItems = [
            { name: currentMerchant, quantity: 1, price: p, unitPrice: p, assignedTo: [] }
          ];
        }

        let itemsTotalSum = 0;
        currentItems.forEach(it => itemsTotalSum += Number(it.price || 0));
        const parsedTotal = Number(data.total || 0);
        const extraTotal = currentTax + currentTip;
        if (parsedTotal > 0 && extraTotal > 0 && Math.abs((itemsTotalSum + extraTotal) - parsedTotal) <= 1.0) {
          currentTaxInclusive = false;
        }
        if (parsedTotal > 0) {
          currentBillTotal = parsedTotal;
        } else {
          currentBillTotal = itemsTotalSum + (currentTaxInclusive ? 0 : currentTax) + currentTip;
        }
      } else {
        const p = Number(data.total || 0);
        currentItems = [
          { name: currentMerchant, quantity: 1, price: p, unitPrice: p, assignedTo: [] }
        ];
        currentBillTotal = p;
      }

      showBanner(`Extracted ${currentItems.length} line items from ${currentMerchant}!`, 'success');
      goToStep(3);

    } catch (err) {
      alert('Receipt scanning failed: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Scan Receipt with AI ➔';
    }
  }

  // Reads a file and converts it into a base64 encoded string.
  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  // Adds the currently logged in user to participants if clicked
  function addCurrentUserToParticipants() {
    if (currentUser && currentUser.name && !currentParticipants.includes(currentUser.name)) {
      currentParticipants.push(currentUser.name);
      if (!currentPayer) currentPayer = currentUser.name;
      renderFriendsChips();
      renderPayerSelect();
      renderItemsPanel();
    }
  }

  // Renders friend name badges with remove buttons.
  function renderFriendsChips() {
    const container = document.getElementById('friends-chips-container');
    if (!container) return;
    if (currentParticipants.length === 0) {
      if (currentUser && currentUser.name) {
        container.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span style="color: var(--text-dim); font-size: 12px; font-style: italic;">No friends added yet.</span>
            <button type="button" class="btn btn-outline btn-xs" style="padding: 2px 8px; font-size: 11px; border-radius: 999px; cursor: pointer;" onclick="app.addCurrentUserToParticipants()">+ Add Me (${escapeHtml(currentUser.name)})</button>
          </div>
        `;
      } else {
        container.innerHTML = '<span style="color: var(--text-dim); font-size: 12px; font-style: italic;">No friends added yet. Type a name and click Add.</span>';
      }
      return;
    }
    let html = currentParticipants.map(name => `
      <span class="chip">
        ${escapeHtml(name)}
        <span class="chip-del" onclick="app.removeFriend('${escapeHtml(name)}')">&times;</span>
      </span>
    `).join('');

    if (currentUser && currentUser.name && !currentParticipants.includes(currentUser.name)) {
      html += `
        <button type="button" class="btn btn-outline btn-xs" style="padding: 2px 8px; font-size: 11px; border-radius: 999px; margin-left: 6px; cursor: pointer;" onclick="app.addCurrentUserToParticipants()">+ Add Me (${escapeHtml(currentUser.name)})</button>
      `;
    }

    container.innerHTML = html;
  }

  // Adds a new friend to the bill participants list.
  function handleAddFriend(e) {
    if (e) e.preventDefault();
    const input = document.getElementById('add-friend-input');
    const name = input ? input.value.trim() : '';
    if (!name) return;
    if (!currentParticipants.includes(name)) {
      currentParticipants.push(name);
      if (!currentPayer) currentPayer = name;
      renderFriendsChips();
      renderPayerSelect();
      renderItemsPanel();
    }
    if (input) input.value = '';
  }

  // Removes a friend from participants and item assignments.
  function removeFriend(name) {
    currentParticipants = currentParticipants.filter(p => p !== name);
    if (currentPayer === name) {
      currentPayer = currentParticipants.length > 0 ? currentParticipants[0] : '';
    }
    currentItems.forEach(it => {
      it.assignedTo = (it.assignedTo || []).filter(p => p !== name);
      if (it.assignedTo.length === 0 && currentParticipants.length > 0) {
        it.assignedTo = [...currentParticipants];
      }
    });
    renderFriendsChips();
    renderPayerSelect();
    renderItemsPanel();
  }

  // Populates the dropdown menu used to choose who paid the bill.
  function renderPayerSelect() {
    const sel = document.getElementById('bill-payer-select');
    if (!sel) return;
    currentParticipants = currentParticipants.filter(p => typeof p === 'string' && p.toLowerCase() !== 'you');
    if (currentParticipants.length === 0) {
      sel.innerHTML = '<option value="">-- Add a friend first --</option>';
      currentPayer = '';
      return;
    }
    if (!currentPayer || currentPayer.toLowerCase() === 'you' || !currentParticipants.includes(currentPayer)) {
      currentPayer = currentParticipants[0];
    }
    sel.innerHTML = currentParticipants.map(name => `
      <option value="${escapeHtml(name)}" ${name === currentPayer ? 'selected' : ''}>
        ${escapeHtml(name)}
      </option>
    `).join('');
  }

  // Sets which person paid for the bill.
  function updatePayer(val) {
    currentPayer = val;
  }

  // Prompts user to manually add a new item to the bill.
  function addNewDishItem() {
    const categoryPrompts = {
      utilities: 'utility charge (e.g. Wi-Fi, Water Can, Electricity)',
      grocery: 'grocery product / item (e.g. Milk, Rice, Detergent)',
      entertainment: 'ticket, pass or concession item (e.g. Popcorn Combo, Seat Ticket)',
      restaurant: 'dish / drink'
    };
    const label = categoryPrompts[currentCategory] || 'item';
    const name = prompt(`Enter ${label} name:`, 'Extra Item');
    if (!name) return;
    const qtyStr = prompt('Enter quantity:', '1');
    const quantity = Math.max(1, parseInt(qtyStr, 10) || 1);
    const priceStr = prompt('Enter total price in ₹:', '100');
    const price = parseFloat(priceStr) || 0;

    const unitPrice = quantity > 0 ? (price / quantity) : price;
    currentItems.push({
      name: name.trim(),
      quantity: quantity,
      price: price,
      unitPrice: unitPrice,
      assignedTo: []
    });
    renderItemsPanel();
  }

  // Renders line items, prices, quantities, and participant assignment tags.
  function renderItemsPanel() {
    const nameEl = document.getElementById('items-merchant-name');
    const totalEl = document.getElementById('items-total-display');
    const listEl = document.getElementById('items-list-container');
    const taxLabel = document.getElementById('editor-tax-label');
    const taxInput = document.getElementById('editor-tax-input');
    const tipInput = document.getElementById('editor-tip-input');

    if (nameEl) nameEl.textContent = currentMerchant || 'Line Items';
    cancelEditingTitle(3);
    const subEl = document.getElementById('items-merchant-subtitle');
    if (subEl) {
      if (currentCategoryMeta && currentCategoryMeta.subtitle) {
        subEl.textContent = currentCategoryMeta.subtitle;
        subEl.style.display = 'block';
      } else {
        subEl.style.display = 'none';
      }
    }

    if (taxLabel) {
      if (currentTaxInclusive) {
        taxLabel.innerHTML = 'Taxes / GST <span style="font-size: 10px; color: #10b981; font-weight: 600;">(incl.)</span>:';
      } else {
        taxLabel.innerHTML = 'Taxes / GST:';
      }
    }

    if (taxInput && document.activeElement !== taxInput) {
      taxInput.value = currentTax.toFixed(2);
    }
    if (tipInput && document.activeElement !== tipInput) {
      tipInput.value = currentTip.toFixed(2);
    }

    const tipLabel = document.getElementById('editor-tip-label');
    if (tipLabel) {
      if (currentCategory === 'entertainment') {
        tipLabel.textContent = 'Booking / Extra:';
      } else if (currentCategory === 'restaurant') {
        tipLabel.textContent = 'Tip / Service Chg:';
      } else {
        tipLabel.textContent = 'Charges / Extra:';
      }
    }

    let itemsSum = 0;
    currentItems.forEach(it => itemsSum += Number(it.price || 0));
    const effectiveTax = currentTaxInclusive ? 0 : currentTax;
    const grandTotal = itemsSum + effectiveTax + currentTip;
    if (totalEl) totalEl.textContent = `₹${grandTotal.toFixed(2)}`;

    if (!listEl) return;

    if (currentItems.length === 0) {
      listEl.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 36px 16px;"><div style="font-size: 32px; margin-bottom: 8px;">🍽️</div><div style="font-weight: 600; font-size: 14px; color: var(--text-main); margin-bottom: 4px;">No items added yet</div><div style="font-size: 12px; max-width: 260px; margin: 0 auto; line-height: 1.4;">Type what you ordered in the chat (e.g. <i>"3 cold coffee for 300, 1 pizza for 250"</i>) or click <b>+ Add Item</b> above.</div></div>';
      return;
    }

    const isUtility = (currentCategory === 'utilities');
    const hasDurationItems = isUtility && currentItems.some(it => /\b(\d+)\s*(days?|wks?|weeks?)\b/i.test(it.name));

    if (currentUtilityMode === 'auto') {
      currentUtilityMode = hasDurationItems ? 'duration' : 'normal';
    } else if (hasDurationItems) {
      currentUtilityMode = 'duration';
    } else if (isUtility && currentItems.length > 0 && !hasDurationItems && currentUtilityMode === 'duration') {
      currentUtilityMode = 'normal';
    }
    const isDurationMode = isUtility && (currentUtilityMode === 'duration');

    let headerHtml = '';
    if (isDurationMode) {
      const cycleDays = currentBillingDays || 30;
      const cycleLabel = currentBillingPeriod || `${cycleDays} Days (Monthly Bill)`;
      const dailyFlatCost = cycleDays > 0 ? (grandTotal / cycleDays) : 0;
      const sharingCount = currentParticipants.length || currentItems.length || 1;

      headerHtml = `
        <div class="utility-duration-strip">
          <span>📅 Billing Period: <b>${escapeHtml(cycleLabel)}</b></span>
          <span class="strip-dot">•</span>
          <span>👥 <b>${sharingCount} ${sharingCount === 1 ? 'Flatmate' : 'Flatmates'} Sharing</b></span>
          <span class="strip-dot">•</span>
          <span>💰 <b>₹${dailyFlatCost.toFixed(2)}/day</b> flat expense</span>
        </div>
      `;
    }

    const itemsHtml = currentItems.map((item, idx) => {
      const assigned = item.assignedTo || [];
      const qty = item.quantity || item.qty || 1;
      const isDurationItem = isUtility && /\b(\d+)\s*(days?|wks?|weeks?)\b/i.test(item.name);

      return `
        <div class="item-row">
          <div class="item-name-row">
            <input type="text" class="item-name-input" value="${escapeHtml(item.name)}" 
              onchange="app.updateItemProp(${idx}, 'name', this.value)" placeholder="Item / Share name">
            <button class="btn btn-danger btn-sm" onclick="app.removeItem(${idx})" title="Delete item">&times;</button>
          </div>

          <div class="item-controls-row">
            ${!isUtility ? `
              <div class="item-qty-wrap" title="Quantity">
                <span class="qty-tag">Qty</span>
                <button type="button" class="qty-btn" onclick="app.stepItemQty(${idx}, -1)" title="Decrease">−</button>
                <input type="text" inputmode="numeric" class="item-qty-input" value="${qty}" 
                  onchange="app.updateItemProp(${idx}, 'quantity', this.value)" 
                  onkeydown="if(event.key==='Enter'){this.blur();}"
                  oninput="this.value = this.value.replace(/[^0-9]/g, '')">
                <button type="button" class="qty-btn" onclick="app.stepItemQty(${idx}, 1)" title="Increase">+</button>
              </div>
            ` : `
              <span class="utility-badge-tag">${isDurationItem ? '📅 Stay Duration Share' : '⚡ Flat Utility Charge'}</span>
            `}

            <div class="item-price-wrap" title="${qty > 1 ? `Unit price: ₹${((item.unitPrice || (item.price / qty))).toFixed(2)} each` : ''}">
              <span>₹</span>
              <input type="number" step="0.01" class="item-price-input" value="${item.price}" 
                onchange="app.updateItemProp(${idx}, 'price', this.value)"
                onkeydown="if(event.key==='Enter'){this.blur();}">
            </div>
          </div>

          <div class="item-assigned-row">
            <span style="color: var(--text-dim);">${isDurationItem ? 'Allocated to:' : 'Shared by:'}</span>
            ${currentParticipants.map(friend => {
        const isSelected = assigned.includes(friend);
        return `
                <span class="assignee-badge ${isSelected ? 'selected' : ''}" 
                  onclick="app.toggleItemAssignee(${idx}, '${escapeHtml(friend)}')">
                  ${isSelected ? '✓ ' : ''}${escapeHtml(friend)}
                </span>
              `;
      }).join('')}
            ${currentParticipants.length === 0 ? '<span style="color: var(--text-dim); font-size: 11px; font-style: italic;">Add friends above to assign</span>' : ''}
          </div>
        </div>
      `;
    }).join('');

    listEl.innerHTML = headerHtml + itemsHtml;
  }

  // Updates a property like name, price, or quantity for a line item.
  function updateItemProp(index, prop, value) {
    if (currentItems[index]) {
      const item = currentItems[index];
      if (prop === 'price') {
        const newPrice = Math.max(0, parseFloat(value) || 0);
        item.price = newPrice;
        const currentQty = Math.max(1, parseInt(item.quantity || 1, 10) || 1);
        item.unitPrice = currentQty > 0 ? (newPrice / currentQty) : newPrice;
      } else if (prop === 'quantity' || prop === 'qty') {
        const currentQty = Math.max(1, parseInt(item.quantity || 1, 10) || 1);
        const nextQty = Math.max(1, parseInt(value, 10) || 1);
        let unitPrice = (typeof item.unitPrice === 'number' && !isNaN(item.unitPrice)) ? item.unitPrice : null;
        if (unitPrice === null || unitPrice === undefined) {
          unitPrice = currentQty > 0 ? (Number(item.price || 0) / currentQty) : Number(item.price || 0);
        }
        item.quantity = nextQty;
        item.unitPrice = unitPrice;
        item.price = Math.round(unitPrice * nextQty * 100) / 100;
      } else {
        item[prop] = value;
      }
      renderItemsPanel();
    }
  }

  // Increases or decreases the quantity of a line item by 1.
  function stepItemQty(idx, delta) {
    if (currentItems[idx]) {
      const item = currentItems[idx];
      const row = document.querySelectorAll('.item-row')[idx];
      const qtyInput = row ? row.querySelector('.item-qty-input') : null;
      let currentQty = Math.max(1, parseInt(item.quantity || item.qty || 1, 10) || 1);
      if (qtyInput && qtyInput.value) {
        const domVal = parseInt(qtyInput.value, 10);
        if (!isNaN(domVal) && domVal >= 1) {
          currentQty = domVal;
        }
      }

      const nextQty = Math.max(1, currentQty + delta);

      let unitPrice = (typeof item.unitPrice === 'number' && !isNaN(item.unitPrice)) ? item.unitPrice : null;
      if (unitPrice === null || unitPrice === undefined) {
        const baseQty = Math.max(1, parseInt(item.quantity || 1, 10) || 1);
        unitPrice = baseQty > 0 ? (Number(item.price || 0) / baseQty) : Number(item.price || 0);
      }

      item.quantity = nextQty;
      item.unitPrice = unitPrice;
      item.price = Math.round(unitPrice * nextQty * 100) / 100;
      renderItemsPanel();
    }
  }

  // Toggles assignment of a line item for a specific friend.
  function toggleItemAssignee(itemIdx, friendName) {
    const item = currentItems[itemIdx];
    if (!item) return;
    let assigned = item.assignedTo || [];
    if (assigned.includes(friendName)) {
      assigned = assigned.filter(p => p !== friendName);
    } else {
      assigned.push(friendName);
    }
    item.assignedTo = assigned;
    renderItemsPanel();
  }

  // Deletes a line item from the bill.
  function removeItem(index) {
    currentItems.splice(index, 1);
    renderItemsPanel();
  }

  // Updates the tax amount on the bill.
  function updateTax(val) {
    currentTax = Math.max(0, parseFloat(val) || 0);
    renderItemsPanel();
  }

  // Toggles whether taxes are already included in item prices.
  function toggleTaxInclusive() {
    currentTaxInclusive = !currentTaxInclusive;
    renderItemsPanel();
  }

  // Updates the tip or service charge amount.
  function updateTip(val) {
    currentTip = Math.max(0, parseFloat(val) || 0);
    renderItemsPanel();
  }

  // Sends a predefined suggestion prompt into the chat.
  function sendQuickPrompt(text) {
    if (text === 'Split all items equally among everyone') {
      if (currentParticipants.length === 0) {
        alert('Please add at least one friend in the friends bar above first.');
        return;
      }
      currentItems.forEach(it => {
        it.assignedTo = [...currentParticipants];
      });
      renderItemsPanel();
      appendMsg('Split all items equally among all friends.', 'bot');
      return;
    }
    if (text === 'Assign all items to me') {
      const me = (currentUser && currentUser.name) ? currentUser.name : (currentParticipants[0] || 'Me');
      currentItems.forEach(it => {
        it.assignedTo = [me];
      });
      renderItemsPanel();
      appendMsg(`Assigned all items to ${me}.`, 'bot');
      return;
    }
    const input = document.getElementById('chat-input-box');
    if (input) {
      input.value = text;
      handleChatSubmit(new Event('submit'));
    }
  }

  // Helper to filter out placeholder items created during splits.
  function isDummyItemName(name) {
    if (!name || typeof name !== 'string') return false;
    const lower = name.trim().toLowerCase();
    return lower.includes('remaining') || lower.includes('unallocated') || lower === 'balance' || lower === 'difference';
  }

  // Sends chat messages to AI to dynamically update split allocations.
  async function handleChatSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    const input = document.getElementById('chat-input-box');
    const prompt = (input ? input.value : '').trim();
    if (!prompt) return;

    appendMsg(prompt, 'user');
    input.value = '';
    input.style.height = '46px';
    input.style.overflowY = 'hidden';

    const sendBtn = document.getElementById('chat-submit-btn');
    if (sendBtn) sendBtn.disabled = true;

    const renameMatch = prompt.match(/^(?:rename(?:\s+(?:bill|split|expense|title))?\s+(?:to|as)\s+|change(?:\s+(?:bill|split|expense))?\s+title\s+(?:to|as)\s+|set(?:\s+(?:bill|split|expense))?\s+title\s+(?:to|as)\s+|title:\s*)(.+)$/i);
    if (renameMatch && renameMatch[1]) {
      const newTitle = renameMatch[1].trim();
      if (newTitle) {
        updateSplitTitle(newTitle);
        renderItemsPanel();
        appendMsg(`Renamed split to "${newTitle}".`, 'bot');
        if (sendBtn) sendBtn.disabled = false;
        return;
      }
    }

    try {
      const cleanItems = (currentItems || []).filter(it => !isDummyItemName(it.name));
      const isFixedTotal = (currentCategory === 'utilities') || (currentCategoryMeta && currentCategoryMeta.hasFixedAmount);
      const targetItemsTotal = (isFixedTotal && currentBillTotal > 0)
        ? (currentTaxInclusive ? currentBillTotal : Math.max(0, currentBillTotal - currentTax - currentTip))
        : 0;
      const res = await ApiService.ai.splitChat(
        prompt,
        cleanItems,
        currentParticipants,
        currentCategory,
        (currentPayer && currentPayer.toLowerCase() !== 'you') ? currentPayer : '',
        targetItemsTotal
      );
      appendMsg(res.assistantMessage || 'Updated allocations.', 'bot');

      const promptMentionsMe = prompt.toLowerCase().match(/\b(me|i|myself|mine)\b/);
      const selfName = (currentUser && currentUser.name) ? currentUser.name : (promptMentionsMe ? 'Me' : '');

      if (Array.isArray(res.updatedParticipants) && res.updatedParticipants.length > 0) {
        const mapped = res.updatedParticipants
          .filter(p => typeof p === 'string' && p.toLowerCase() !== 'you')
          .filter(p => {
            if (!promptMentionsMe && (p.toLowerCase() === 'me' || p.toLowerCase() === 'myself')) {
              return false;
            }
            return true;
          })
          .map(p => {
            if (p.toLowerCase() === 'me' || p.toLowerCase() === 'i' || p.toLowerCase() === 'myself') {
              return selfName || p;
            }
            return p;
          })
          .filter(p => p && p.trim().length > 0);
        currentParticipants = Array.from(new Set(mapped));
        renderFriendsChips();
        renderPayerSelect();
      }

      if (Array.isArray(res.updatedItems) && res.updatedItems.length > 0) {
        const nonDummy = res.updatedItems
          .filter(it => !isDummyItemName(it.name))
          .filter(it => {
            if (!promptMentionsMe && /^me\s*\(/i.test((it.name || '').trim())) {
              return false;
            }
            return true;
          });
        if (nonDummy.length > 0) {
          currentItems = nonDummy.map(it => {
            const q = Math.max(1, parseInt(it.quantity || it.qty || 1, 10) || 1);
            const p = Number(it.price || 0);
            const rawAssignees = Array.isArray(it.assignedTo) ? it.assignedTo : [];
            const assignees = rawAssignees
              .filter(a => typeof a === 'string' && a.toLowerCase() !== 'you')
              .filter(a => {
                if (!promptMentionsMe && (a.toLowerCase() === 'me' || a.toLowerCase() === 'myself')) {
                  return false;
                }
                return true;
              })
              .map(a => {
                if (a.toLowerCase() === 'me' || a.toLowerCase() === 'i' || a.toLowerCase() === 'myself') {
                  return selfName || a;
                }
                return a;
              })
              .filter(a => a && a.trim().length > 0);
            return {
              name: it.name || 'Item',
              quantity: q,
              price: p,
              unitPrice: q > 0 ? (p / q) : p,
              assignedTo: Array.from(new Set(assignees))
            };
          });
        }
      }

      if (res.payer) {
        let pName = String(res.payer).trim();
        if (pName.toLowerCase() === 'me' || pName.toLowerCase() === 'i' || pName.toLowerCase() === 'myself') {
          pName = selfName || (currentParticipants.length > 0 ? currentParticipants[0] : '');
        }
        if (pName.toLowerCase() !== 'you' && pName.length > 0) {
          currentPayer = pName;
          renderPayerSelect();
        }
      }

      renderItemsPanel();

    } catch (err) {
      appendMsg('Sorry, could not process request: ' + err.message, 'bot');
    } finally {
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  // Adds a message bubble to the chat conversation history.
  function appendMsg(text, sender) {
    const box = document.getElementById('chat-messages');
    if (!box) return;
    const msg = document.createElement('div');
    msg.className = `msg ${sender}`;
    msg.innerHTML = escapeHtml(text);
    box.appendChild(msg);
    box.scrollTop = box.scrollHeight;
  }

  // Calculates who owes whom and generates UPI payment QR cards.
  async function computeDebtsAndRenderQRs() {
    let itemsSum = 0;
    currentItems.forEach(it => itemsSum += Number(it.price || 0));
    const effectiveTax = currentTaxInclusive ? 0 : currentTax;
    const grandTotal = itemsSum + effectiveTax + currentTip;

    const personShares = {};
    currentParticipants.forEach(p => personShares[p] = 0);

    currentItems.forEach(it => {
      const assignees = it.assignedTo && it.assignedTo.length > 0 ? it.assignedTo : currentParticipants;
      const share = Number(it.price || 0) / (assignees.length || 1);
      assignees.forEach(p => {
        personShares[p] = (personShares[p] || 0) + share;
      });
    });

    const extra = effectiveTax + currentTip;
    if (itemsSum > 0 && extra > 0) {
      currentParticipants.forEach(p => {
        personShares[p] += (personShares[p] / itemsSum) * extra;
      });
    }

    currentDebts = [];
    currentParticipants.forEach(p => {
      if (p !== currentPayer) {
        const amt = Math.round((personShares[p] || 0) * 100) / 100;
        if (amt > 0.01) {
          currentDebts.push({
            from: p,
            to: currentPayer,
            amount: amt
          });
        }
      }
    });

    const grid = document.getElementById('upi-qr-grid');
    if (!grid) return;

    if (currentDebts.length === 0) {
      grid.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 24px; grid-column: 1/-1;">All expenses are settled or absorbed by the payer!</div>';
      return;
    }

    const receivingUpi = billUpiId || defaultUpiId;
    grid.innerHTML = currentDebts.map(d => {
      const isPaid = paidStatusMap[d.from] === true;
      const upiLink = `upi://pay?pa=${encodeURIComponent(receivingUpi)}&pn=${encodeURIComponent(currentPayer)}&am=${d.amount.toFixed(2)}&cu=INR&tn=SplitWise%20${encodeURIComponent(currentMerchant)}`;
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(upiLink)}`;

      return `
        <div class="upi-card">
          <h4>${escapeHtml(d.from)} owes ${escapeHtml(d.to)}</h4>
          <div class="upi-card-amt">₹${d.amount.toFixed(0)}</div>
          <div class="qr-box">
            <img src="${qrUrl}" alt="UPI QR for ${escapeHtml(d.from)}">
          </div>
          <div style="display: flex; gap: 8px; justify-content: center;">
            <button class="btn ${isPaid ? 'btn-primary' : 'btn-secondary'} btn-sm" 
              onclick="app.toggleDebtPaid('${escapeHtml(d.from)}')">
              ${isPaid ? '✓ Marked Paid' : 'Mark Paid'}
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Toggles whether a friend has settled their debt.
  function toggleDebtPaid(friendName) {
    paidStatusMap[friendName] = !paidStatusMap[friendName];
    computeDebtsAndRenderQRs();
    if (currentStep === 5) {
      renderSummaryStep();
    }
  }

  // Expands or collapses itemized order details for a participant.
  function togglePersonBreakdown(name) {
    if (expandedBreakdowns[name] === undefined) {
      expandedBreakdowns[name] = false;
    }
    expandedBreakdowns[name] = !expandedBreakdowns[name];
    const orderEl = document.getElementById(`order-${name}`);
    const chevEl = document.getElementById(`chevron-${name}`);
    if (orderEl) orderEl.classList.toggle('show', expandedBreakdowns[name]);
    if (chevEl) chevEl.textContent = expandedBreakdowns[name] ? '∧' : '∨';
  }

  // Renders final overview metrics, progress bars, QR cards, and breakdown.
  async function renderSummaryStep() {
    let itemsSum = 0;
    currentItems.forEach(it => itemsSum += Number(it.price || 0));
    const effectiveTax = currentTaxInclusive ? 0 : currentTax;
    const grandTotal = itemsSum + effectiveTax + currentTip;

    const personShares = {};
    currentParticipants.forEach(p => personShares[p] = 0);

    currentItems.forEach(it => {
      const assignees = it.assignedTo && it.assignedTo.length > 0 ? it.assignedTo : currentParticipants;
      const share = Number(it.price || 0) / (assignees.length || 1);
      assignees.forEach(p => {
        personShares[p] = (personShares[p] || 0) + share;
      });
    });

    const extra = effectiveTax + currentTip;
    if (itemsSum > 0 && extra > 0) {
      currentParticipants.forEach(p => {
        personShares[p] += (personShares[p] / itemsSum) * extra;
      });
    }

    currentDebts = [];
    currentParticipants.forEach(p => {
      if (p !== currentPayer) {
        const amt = Math.round((personShares[p] || 0) * 100) / 100;
        if (amt > 0.01) {
          currentDebts.push({
            from: p,
            to: currentPayer,
            amount: amt
          });
        }
      }
    });

    let collected = 0;
    let pending = 0;

    currentDebts.forEach(d => {
      if (paidStatusMap[d.from]) {
        collected += d.amount;
      } else {
        pending += d.amount;
      }
    });

    const payerShare = personShares[currentPayer] || 0;
    const totalToCollect = grandTotal - payerShare;
    const pct = totalToCollect > 0 ? Math.round((collected / totalToCollect) * 100) : 100;

    const billTitleEl = document.getElementById('summary-bill-title');
    const billSubEl = document.getElementById('summary-bill-subtitle');
    if (billTitleEl && currentMerchant && currentMerchant !== 'Split Expense') {
      billTitleEl.textContent = `${currentMerchant} - Split Summary`;
    }
    if (billSubEl && currentCategoryMeta && currentCategoryMeta.subtitle) {
      billSubEl.textContent = currentCategoryMeta.subtitle;
    }

    const totalBillEl = document.getElementById('summary-total-bill');
    const collectedEl = document.getElementById('summary-collected');
    const pendingEl = document.getElementById('summary-pending');
    const progressEl = document.getElementById('summary-progress');
    if (totalBillEl) totalBillEl.textContent = `₹${Math.round(grandTotal)}`;
    if (collectedEl) collectedEl.textContent = `₹${Math.round(collected)}`;
    if (pendingEl) pendingEl.textContent = `₹${Math.round(pending)}`;
    if (progressEl) progressEl.textContent = `${pct}%`;

    const statsText = document.getElementById('collection-stats-text');
    const fillBar = document.getElementById('collection-fill-bar');
    if (statsText) statsText.textContent = `₹${Math.round(collected)} of ₹${Math.round(totalToCollect)} settled`;
    if (fillBar) fillBar.style.width = `${pct}%`;

    const qrGridEl = document.getElementById('summary-qr-grid');
    if (qrGridEl) {
      const pendingDebts = currentDebts.filter(d => paidStatusMap[d.from] !== true);
      const receivingUpi = billUpiId || defaultUpiId;

      if (pendingDebts.length === 0) {
        if (currentDebts.length > 0) {
          qrGridEl.innerHTML = `
            <div style="color: var(--text-muted); text-align: center; padding: 24px; grid-column: 1/-1; background: var(--surface-alt); border-radius: var(--radius-sm); border: 1px solid var(--border);">
              <span style="font-size: 22px; display: block; margin-bottom: 6px;">🎉</span>
              <strong style="color: var(--text); font-size: 14px;">All debts have been settled and paid!</strong>
              <div style="font-size: 12px; color: var(--text-dim); margin-top: 4px;">No active payment QR codes required.</div>
            </div>
          `;
        } else {
          qrGridEl.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 18px; grid-column: 1/-1;">No pending debts in this split.</div>';
        }
      } else {
        qrGridEl.innerHTML = pendingDebts.map(d => {
          const initial = (d.from || 'U').trim().charAt(0).toUpperCase();
          const upiLink = `upi://pay?pa=${encodeURIComponent(receivingUpi)}&pn=${encodeURIComponent(currentPayer)}&am=${d.amount.toFixed(2)}&cu=INR&tn=SplitWise%20${encodeURIComponent(currentMerchant)}`;
          const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(upiLink)}`;
          return `
            <div class="summary-qr-card">
              <div class="qr-avatar-circle">
                <span>${initial}</span>
              </div>
              <div class="qr-debtor-name">
                <span class="debtor-from">${escapeHtml(d.from)}</span> 
                <span class="debtor-owes-text">owes</span> 
                <span class="debtor-to">${escapeHtml(d.to || currentPayer)}</span>
              </div>
              <div class="qr-amount-val">₹${Math.round(d.amount)}</div>
              <div class="qr-code-img-box">
                <img src="${qrUrl}" alt="UPI QR for ${escapeHtml(d.from)}">
              </div>
            </div>
          `;
        }).join('');
      }
    }

    const listEl = document.getElementById('participant-cards-list');
    if (listEl) {
      const catLabels = {
        utilities: { icon: '💡', noun: 'charges', title: 'UTILITY SHARES' },
        grocery: { icon: '🛒', noun: 'items', title: 'GROCERY ITEMS' },
        entertainment: { icon: '🎟️', noun: 'tickets & snacks', title: 'TICKETS & CONCESSIONS' },
        restaurant: { icon: '🍽️', noun: 'dishes', title: 'ITEMIZED ORDER' }
      };
      const catCfg = catLabels[currentCategory] || catLabels.restaurant;

      listEl.innerHTML = currentParticipants.map(p => {
        const isPayer = (p === currentPayer);
        const initial = (p || 'U').trim().charAt(0).toUpperCase();
        const isPaid = paidStatusMap[p] === true;
        const shareAmt = isPayer ? payerShare : (personShares[p] || 0);

        const personDishes = [];
        currentItems.forEach(it => {
          const assignees = (it.assignedTo && it.assignedTo.length > 0) ? it.assignedTo : currentParticipants;
          if (assignees.includes(p)) {
            const shareCount = assignees.length;
            const others = assignees.filter(a => a !== p);
            let shareDesc = shareCount === 1 ? 'Solo allocation' : `Shared with ${others.join(', ')} (1 of ${shareCount} shares)`;
            const q = Number(it.quantity || it.qty || 1);
            if (q > 1) {
              const unitPrice = (Number(it.price) / q).toFixed(0);
              shareDesc += ` • ${q} Qty @ ₹${unitPrice}`;
            }
            const portionCost = Number(it.price || 0) / (shareCount || 1);
            personDishes.push({
              name: it.name,
              desc: shareDesc,
              cost: portionCost
            });
          }
        });

        const isExpanded = expandedBreakdowns[p] === true;
        const dishCount = personDishes.length;

        return `
          <div class="participant-card">
            <div class="participant-card-header" onclick="app.togglePersonBreakdown('${escapeHtml(p)}')">
              <div class="participant-left">
                <div class="participant-avatar">${initial}</div>
                <span class="participant-name">${escapeHtml(p)}</span>
                <span class="badge-dishes">
                  ${catCfg.icon} ${dishCount} ${catCfg.noun} <span id="chevron-${escapeHtml(p)}">${isExpanded ? '∧' : '∨'}</span>
                </span>
                ${isPayer
            ? `<span class="badge-payer">Payer • Paid ₹${Math.round(grandTotal)} Upfront</span>`
            : `<span class="${isPaid ? 'badge-settled' : 'badge-pending'}">${isPaid ? '✓ Payment Settled' : '⏱ Payment Pending'}</span>`
          }
              </div>

              <div class="participant-right" onclick="event.stopPropagation()">
                <div class="share-col">
                  <span class="share-label">${isPayer ? 'OWN SHARE' : 'AMOUNT OWED'}</span>
                  <span class="share-val">₹${Math.round(shareAmt)}</span>
                </div>
                ${isPayer
            ? `<span class="badge-status-settled">✓ Paid Full Bill</span>`
            : `<button class="${isPaid ? 'btn-settled' : 'btn-mark-paid'}" onclick="app.toggleDebtPaid('${escapeHtml(p)}')">
                       ${isPaid ? '✓ Settled' : 'Mark as Paid'}
                     </button>`
          }
              </div>
            </div>

            <div class="person-order-expanded ${isExpanded ? 'show' : ''}" id="order-${escapeHtml(p)}">
              <div class="order-subheading">${catCfg.icon} ${escapeHtml(p.toUpperCase())}'S ${catCfg.title} (${dishCount} ${catCfg.noun.toUpperCase()})</div>
              ${personDishes.length === 0 ? '<div style="color: var(--text-dim); font-size: 12px; padding: 6px 0;">No items allocated to this participant.</div>' : ''}
              ${personDishes.map(d => `
                <div class="order-dish-row">
                  <div class="dish-row-left">
                    <div class="dish-row-name">${escapeHtml(d.name)}</div>
                    <div class="dish-row-sub">${escapeHtml(d.desc)}</div>
                  </div>
                  <div class="dish-row-price">₹${d.cost.toFixed(d.cost % 1 === 0 ? 0 : 1)}</div>
                </div>
              `).join('')}
              <div class="order-total-row">
                <span>Total Debt Balance (${dishCount} ${catCfg.noun})</span>
                <span>₹${Math.round(shareAmt)}</span>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // Saves the complete bill, items, and debts to local storage history.
  async function saveSplitToHistory() {
    const btn = document.getElementById('btn-save-history');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    let itemsSum = 0;
    currentItems.forEach(it => itemsSum += Number(it.price || 0));
    const effectiveTax = currentTaxInclusive ? 0 : currentTax;
    const grandTotal = itemsSum + effectiveTax + currentTip;

    const debtsWithStatus = currentDebts.map(d => ({
      ...d,
      settled: paidStatusMap[d.from] === true
    }));

    const effectiveUpi = (billUpiId || defaultUpiId || '').trim();
    const billData = {
      title: currentMerchant,
      category: currentCategory,
      categoryMeta: currentCategoryMeta,
      payer: currentPayer,
      upiId: effectiveUpi,
      participants: currentParticipants,
      items: currentItems,
      tax: currentTax,
      tip: currentTip,
      totalAmount: grandTotal,
      debts: debtsWithStatus
    };

    try {
      await ApiService.bills.create(billData);
      showBanner(`Bill "${currentMerchant}" saved successfully!`, 'success');
      setTimeout(() => {
        window.location.href = 'history.html';
      }, 1000);
    } catch (err) {
      alert('Failed to save bill: ' + err.message);
      btn.disabled = false;
      btn.textContent = '💾 Save Split to History';
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
    goToStep,
    selectCategory,
    handleDirectSplit,
    updateDirectSplitButton,
    setDirectSplitTitle,
    scanReceiptWithAI,
    handleAddFriend,
    addCurrentUserToParticipants,
    removeFriend,
    addNewDishItem,
    updateItemProp,
    stepItemQty,
    toggleItemAssignee,
    removeItem,
    sendQuickPrompt,
    handleChatSubmit,
    updateUpiId,
    handleUpiInput,
    toggleDebtPaid,
    saveSplitToHistory,
    updatePayer,
    updateTax,
    toggleTaxInclusive,
    updateTip,
    openAuthModal,
    closeAuthModal,
    toggleAuthMode,
    handleAuthSubmit,
    toggleTheme,
    toggleProfileDropdown,
    handleLogout,
    promptEditUpiId,
    togglePersonBreakdown,
    updateSplitTitle,
    startEditingTitle,
    saveEditingTitle,
    cancelEditingTitle
  };
})();
