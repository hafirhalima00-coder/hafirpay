const API = '/api';
let currentMerchant = null;
let currentTxnRef = null;

function navigate(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  window.scrollTo(0, 0);
  if (view === 'dashboard') loadDashboard();
}

function showDashTab(tab) {
  document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelectorAll('.sidebar-nav a').forEach(a => a.classList.remove('active'));
  event.target.classList.add('active');
}

function showError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 4000);
}

function formatMoney(amount, currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(amount);
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// AUTH
document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await fetch(API + '/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      businessName: document.getElementById('reg-business').value,
      email: document.getElementById('reg-email').value,
      password: document.getElementById('reg-password').value
    })
  });
  const data = await res.json();
  if (!data.success) return showError('reg-error', data.error);
  currentMerchant = data.merchant;
  localStorage.setItem('hp_merchant', JSON.stringify(data.merchant));
  updateNav();
  navigate('dashboard');
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await fetch(API + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: document.getElementById('login-email').value, password: document.getElementById('login-password').value })
  });
  const data = await res.json();
  if (!data.success) return showError('login-error', data.error);
  currentMerchant = data.merchant;
  localStorage.setItem('hp_merchant', JSON.stringify(data.merchant));
  updateNav();
  navigate('dashboard');
});

function logout() {
  currentMerchant = null;
  localStorage.removeItem('hp_merchant');
  updateNav();
  navigate('landing');
}

function updateNav() {
  const loggedIn = !!currentMerchant;
  document.getElementById('nav-login').style.display = loggedIn ? 'none' : '';
  document.getElementById('nav-register').style.display = loggedIn ? 'none' : '';
}

// DASHBOARD
async function loadDashboard() {
  if (!currentMerchant) return navigate('login');
  document.getElementById('dash-business-name').textContent = currentMerchant.businessName;
  document.getElementById('api-key-display').value = currentMerchant.apiKey;

  const [statsRes, txnsRes, banksRes, agentsRes, smtpRes] = await Promise.all([
    fetch(API + '/stats', { headers: { 'x-api-key': currentMerchant.apiKey } }),
    fetch(API + '/transactions', { headers: { 'x-api-key': currentMerchant.apiKey } }),
    fetch(API + '/bank-details', { headers: { 'x-api-key': currentMerchant.apiKey } }),
    fetch(API + '/agent-keys', { headers: { 'x-api-key': currentMerchant.apiKey } }),
    fetch(API + '/smtp', { headers: { 'x-api-key': currentMerchant.apiKey } })
  ]);

  const stats = await statsRes.json();
  const { transactions } = await txnsRes.json();
  const { bankDetails } = await banksRes.json();
  const { agentKeys } = await agentsRes.json();
  const smtp = await smtpRes.json();

  document.getElementById('stat-revenue').textContent = formatMoney(stats.completedRevenue);
  document.getElementById('stat-count').textContent = stats.totalTransactions;
  document.getElementById('stat-completed').textContent = stats.completedTransactions;
  document.getElementById('stat-pending').textContent = stats.pendingTransactions;

  renderTransactions('recent-txns', transactions.slice(0, 5));
  renderTransactions('all-txns', transactions);
  renderBankDetails(bankDetails);
  renderAgentKeys(agentKeys);

  if (smtp.configured) {
    document.getElementById('smtp-status').innerHTML = '<div style="color:var(--success);font-size:0.9rem">✓ SMTP configured and ready</div>';
  }
}

function renderTransactions(containerId, txns) {
  const el = document.getElementById(containerId);
  if (!txns.length) {
    el.innerHTML = '<div class="empty-state"><p>No transactions yet</p><span>Share a payment link to get started</span></div>';
    return;
  }
  el.innerHTML = txns.map(t => `
    <div class="txn-item">
      <div>
        <div class="txn-desc">${t.description || 'Payment'}</div>
        <div class="txn-ref">${t.reference}</div>
      </div>
      <div style="color:var(--text-muted);font-size:0.8rem">${formatDate(t.created_at)}</div>
      <div class="txn-amount">${formatMoney(t.amount, t.currency)}</div>
      <div style="display:flex;gap:0.5rem;align-items:center">
        <div class="txn-status ${t.status}">${t.status}</div>
        ${t.status === 'pending' && t.customer_email ? `<button class="btn btn-sm btn-outline" onclick="sendInvoice('${t.reference}')">📧</button>` : ''}
      </div>
    </div>
  `).join('');
}

function renderBankDetails(details) {
  const el = document.getElementById('existing-banks');
  if (!details.length) { el.innerHTML = '<div class="empty-state"><p>No bank accounts added yet</p></div>'; return; }
  el.innerHTML = details.map(b => `<div class="bank-detail-card"><h4>${b.bank_name}</h4><p>${b.account_holder} • •••${b.account_number.slice(-4)} • ${b.country}</p></div>`).join('');
}

function renderAgentKeys(keys) {
  const el = document.getElementById('existing-agents');
  if (!keys.length) { el.innerHTML = '<div class="empty-state"><p>No agent keys created yet</p></div>'; return; }
  el.innerHTML = keys.map(k => `
    <div class="bank-detail-card" style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <h4>${k.name}</h4>
        <p style="font-family:monospace;font-size:0.8rem">${k.key.slice(0, 16)}... • ${k.permissions} • ${k.active ? 'Active' : 'Revoked'}</p>
      </div>
      ${k.active ? `<button class="btn btn-sm btn-outline" onclick="revokeAgentKey('${k.id}')" style="color:var(--danger)">Revoke</button>` : ''}
    </div>
  `).join('');
}

async function sendInvoice(reference) {
  if (!currentMerchant) return;
  const res = await fetch(API + `/transactions/${reference}/send-invoice`, {
    method: 'POST', headers: { 'x-api-key': currentMerchant.apiKey }
  });
  const data = await res.json();
  if (data.success) {
    alert('Invoice sent!');
    loadDashboard();
  } else {
    alert('Error: ' + data.error);
  }
}

async function revokeAgentKey(keyId) {
  if (!currentMerchant || !confirm('Revoke this agent key?')) return;
  await fetch(API + `/agent-keys/${keyId}/revoke`, {
    method: 'POST', headers: { 'x-api-key': currentMerchant.apiKey }
  });
  loadDashboard();
}

// BANK FORM
document.getElementById('bank-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentMerchant) return;
  const res = await fetch(API + '/bank-details', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': currentMerchant.apiKey },
    body: JSON.stringify({
      bankName: document.getElementById('bank-name').value,
      accountHolder: document.getElementById('bank-holder').value,
      accountNumber: document.getElementById('bank-account').value,
      routingNumber: document.getElementById('bank-routing').value,
      iban: document.getElementById('bank-iban').value,
      swiftCode: document.getElementById('bank-swift').value,
      country: document.getElementById('bank-country').value,
      currency: document.getElementById('bank-currency').value
    })
  });
  const data = await res.json();
  if (!data.success) return alert(data.error);
  document.getElementById('bank-form').reset();
  loadDashboard();
});

// PAYMENT LINK FORM
document.getElementById('link-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentMerchant) return;
  const res = await fetch(API + '/transactions/create', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': currentMerchant.apiKey },
    body: JSON.stringify({
      amount: parseFloat(document.getElementById('link-amount').value),
      currency: document.getElementById('link-currency').value,
      description: document.getElementById('link-desc').value,
      customerName: document.getElementById('link-name').value,
      customerEmail: document.getElementById('link-email').value
    })
  });
  const data = await res.json();
  if (!data.success) return alert(data.error);
  const payUrl = window.location.origin + '/pay/' + data.reference;
  document.getElementById('generated-link').value = payUrl;
  document.getElementById('link-result').style.display = 'block';
});

function copyLink() { navigator.clipboard.writeText(document.getElementById('generated-link').value); }
function copyApiKey() { navigator.clipboard.writeText(document.getElementById('api-key-display').value); }
function copyAgentKey() { navigator.clipboard.writeText(document.getElementById('agent-key-display').value); }

// AGENT KEY FORM
document.getElementById('agent-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentMerchant) return;
  const perms = [];
  if (document.getElementById('perm-payments').checked) perms.push('payments');
  if (document.getElementById('perm-invoices').checked) perms.push('invoices');
  const res = await fetch(API + '/agent-keys', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': currentMerchant.apiKey },
    body: JSON.stringify({ name: document.getElementById('agent-name').value, permissions: perms.join(',') })
  });
  const data = await res.json();
  if (!data.success) return alert(data.error);
  document.getElementById('agent-key-display').value = data.key;
  document.getElementById('agent-result').style.display = 'block';
  document.getElementById('agent-form').reset();
  loadDashboard();
});

// SMTP FORM
document.getElementById('smtp-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentMerchant) return;
  const res = await fetch(API + '/smtp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': currentMerchant.apiKey },
    body: JSON.stringify({
      host: document.getElementById('smtp-host').value,
      port: parseInt(document.getElementById('smtp-port').value),
      user: document.getElementById('smtp-user').value,
      pass: document.getElementById('smtp-pass').value,
      from: document.getElementById('smtp-from').value
    })
  });
  const data = await res.json();
  if (data.success) {
    document.getElementById('smtp-status').innerHTML = '<div style="color:var(--success);font-size:0.9rem">✓ SMTP saved successfully</div>';
  } else {
    document.getElementById('smtp-status').innerHTML = '<div style="color:var(--danger);font-size:0.9rem">' + data.error + '</div>';
  }
});

// CHECKOUT
async function loadCheckout(reference) {
  currentTxnRef = reference;
  const res = await fetch(API + '/payment/' + reference);
  if (!res.ok) { document.getElementById('checkout-status').innerHTML = '<p style="color:var(--danger)">Payment not found</p>'; return; }
  const data = await res.json();
  document.getElementById('checkout-business').textContent = data.businessName;
  document.getElementById('checkout-amount').textContent = formatMoney(data.amount, data.currency);
  document.getElementById('checkout-desc').textContent = data.description || '';

  if (data.status === 'completed') {
    document.getElementById('checkout-bank').style.display = 'none';
    document.getElementById('checkout-complete').style.display = 'block';
    return;
  }

  if (data.bank) {
    document.getElementById('pay-bank-name').textContent = data.bank.name || 'N/A';
    document.getElementById('pay-account-holder').textContent = data.bank.accountHolder || 'N/A';
    document.getElementById('pay-account-number').textContent = data.bank.accountNumber || 'N/A';
    document.getElementById('pay-reference').textContent = data.reference;
    document.getElementById('pay-iban-row').style.display = data.bank.iban ? '' : 'none';
    document.getElementById('pay-swift-row').style.display = data.bank.swiftCode ? '' : 'none';
    if (data.bank.iban) document.getElementById('pay-iban').textContent = data.bank.iban;
    if (data.bank.swiftCode) document.getElementById('pay-swift').textContent = data.bank.swiftCode;
    if (data.qrCode) document.getElementById('checkout-qr').innerHTML = '<img src="' + data.qrCode + '" alt="QR">';
    document.getElementById('checkout-bank').style.display = 'block';
  }
}

async function confirmPayment() {
  if (!currentTxnRef) return;
  const res = await fetch(API + '/payment/' + currentTxnRef + '/confirm', { method: 'POST' });
  const data = await res.json();
  if (data.success) {
    document.getElementById('checkout-bank').style.display = 'none';
    document.getElementById('checkout-complete').style.display = 'block';
  }
}

async function cancelPayment() {
  if (!currentTxnRef) return;
  if (!confirm('Cancel this payment?')) return;
  await fetch(API + '/payment/' + currentTxnRef + '/cancel', { method: 'POST' });
  document.getElementById('checkout-bank').style.display = 'none';
  document.getElementById('checkout-status').innerHTML = '<p style="color:var(--danger)">Payment cancelled</p>';
}

// INIT
(function init() {
  const saved = localStorage.getItem('hp_merchant');
  if (saved) { currentMerchant = JSON.parse(saved); updateNav(); }
  const path = window.location.pathname;
  if (path.startsWith('/pay/')) { navigate('checkout'); loadCheckout(path.split('/pay/')[1]); }
})();
