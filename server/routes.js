const express = require('express');
const QRCode = require('qrcode');
const { sendInvoice } = require('./email');
const {
  createMerchant, authenticateMerchant, authenticateByApiKey,
  authenticateAgentKey, createAgentKey, getAgentKeys, revokeAgentKey,
  updateSmtp, getMerchantSmtp,
  addBankDetail, getBankDetails, createTransaction, getTransaction,
  updateTransactionStatus, markInvoiceSent, getMerchantTransactions,
  getMerchantStats, createProduct, getMerchantProducts
} = require('./db');

const router = express.Router();

// Merchant auth middleware
function authMiddleware(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'API key required' });
  const merchant = authenticateByApiKey(apiKey);
  if (!merchant) return res.status(401).json({ error: 'Invalid API key' });
  req.merchant = merchant;
  next();
}

// Agent auth middleware
function agentAuth(req, res, next) {
  const key = req.headers['x-agent-key'];
  if (!key) return res.status(401).json({ error: 'Agent key required' });
  const agent = authenticateAgentKey(key);
  if (!agent) return res.status(401).json({ error: 'Invalid or revoked agent key' });
  req.agent = agent;
  req.merchant = { id: agent.merchantId, businessName: agent.businessName };
  next();
}

// AUTH
router.post('/auth/register', (req, res) => {
  try {
    const { email, password, businessName } = req.body;
    if (!email || !password || !businessName) return res.status(400).json({ error: 'Email, password, and business name required' });
    const merchant = createMerchant(email, password, businessName);
    res.json({ success: true, merchant });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Email already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.post('/auth/login', (req, res) => {
  const { email, password } = req.body;
  const merchant = authenticateMerchant(email, password);
  if (!merchant) return res.status(401).json({ error: 'Invalid credentials' });
  res.json({ success: true, merchant });
});

// AGENT KEYS
router.post('/agent-keys', authMiddleware, (req, res) => {
  try {
    const { name, permissions } = req.body;
    if (!name) return res.status(400).json({ error: 'Agent name required' });
    const key = createAgentKey(req.merchant.id, name, permissions);
    res.json({ success: true, ...key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/agent-keys', authMiddleware, (req, res) => {
  const keys = getAgentKeys(req.merchant.id);
  res.json({ agentKeys: keys });
});

router.post('/agent-keys/:id/revoke', authMiddleware, (req, res) => {
  revokeAgentKey(req.merchant.id, req.params.id);
  res.json({ success: true });
});

// SMTP
router.post('/smtp', authMiddleware, (req, res) => {
  try {
    const { host, port, user, pass, from } = req.body;
    if (!host || !user || !pass) return res.status(400).json({ error: 'SMTP host, user, and password required' });
    updateSmtp(req.merchant.id, { host, port: port || 587, user, pass, from });
    res.json({ success: true, message: 'SMTP configured' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/smtp', authMiddleware, (req, res) => {
  const smtp = getMerchantSmtp(req.merchant.id);
  const safe = smtp ? { host: smtp.smtp_host, port: smtp.smtp_port, user: smtp.smtp_user, from: smtp.smtp_from, configured: !!smtp.smtp_host } : { configured: false };
  res.json(safe);
});

// BANK DETAILS
router.post('/bank-details', authMiddleware, (req, res) => {
  try {
    const { bankName, accountHolder, accountNumber, routingNumber, iban, swiftCode, country, currency } = req.body;
    if (!bankName || !accountHolder || !accountNumber || !country) return res.status(400).json({ error: 'Bank name, account holder, account number, and country required' });
    const id = addBankDetail(req.merchant.id, { bankName, accountHolder, accountNumber, routingNumber, iban, swiftCode, country, currency });
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/bank-details', authMiddleware, (req, res) => {
  const details = getBankDetails(req.merchant.id);
  res.json({ bankDetails: details });
});

// PRODUCTS
router.post('/products', authMiddleware, (req, res) => {
  try {
    const { name, description, price, currency } = req.body;
    if (!name || !price) return res.status(400).json({ error: 'Name and price required' });
    const id = createProduct(req.merchant.id, { name, description, price, currency });
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/products', authMiddleware, (req, res) => {
  const products = getMerchantProducts(req.merchant.id);
  res.json({ products });
});

// TRANSACTIONS — merchant
router.post('/transactions/create', authMiddleware, (req, res) => {
  try {
    const { amount, currency, customerName, customerEmail, description, bankDetailId } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Valid amount required' });
    let bId = bankDetailId;
    if (!bId) {
      const details = getBankDetails(req.merchant.id);
      if (details.length > 0) bId = details[0].id;
    }
    const txn = createTransaction(req.merchant.id, { amount, currency, customerName, customerEmail, description, bankDetailId: bId });
    res.json({ success: true, ...txn });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/transactions', authMiddleware, (req, res) => {
  const transactions = getMerchantTransactions(req.merchant.id);
  res.json({ transactions });
});

router.get('/stats', authMiddleware, (req, res) => {
  const stats = getMerchantStats(req.merchant.id);
  res.json(stats);
});

// SEND INVOICE — merchant
router.post('/transactions/:reference/send-invoice', authMiddleware, async (req, res) => {
  try {
    const txn = getTransaction(req.params.reference);
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });
    if (txn.merchant_id !== req.merchant.id) return res.status(403).json({ error: 'Forbidden' });
    if (!txn.customer_email) return res.status(400).json({ error: 'No customer email on this transaction' });

    const smtp = getMerchantSmtp(req.merchant.id);
    if (!smtp || !smtp.smtp_host) return res.status(400).json({ error: 'SMTP not configured. Go to Settings > Email to set up.' });

    const baseUrl = req.protocol + '://' + req.get('host');
    await sendInvoice(smtp, txn, baseUrl);
    markInvoiceSent(txn.reference);
    res.json({ success: true, message: 'Invoice sent to ' + txn.customer_email });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send invoice: ' + err.message });
  }
});

// TRANSACTIONS — agent
router.post('/agent/transactions/create', agentAuth, (req, res) => {
  try {
    const { amount, currency, customerName, customerEmail, description, bankDetailId } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Valid amount required' });
    if (!req.agent.permissions.includes('payments')) return res.status(403).json({ error: 'Agent lacks payments permission' });

    let bId = bankDetailId;
    if (!bId) {
      const details = getBankDetails(req.agent.merchantId);
      if (details.length > 0) bId = details[0].id;
    }
    const txn = createTransaction(req.agent.merchantId, { amount, currency, customerName, customerEmail, description, bankDetailId: bId });
    const payUrl = (req.protocol + '://' + req.get('host')) + '/pay/' + txn.reference;
    res.json({ success: true, ...txn, payUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SEND INVOICE — agent
router.post('/agent/transactions/:reference/send-invoice', agentAuth, async (req, res) => {
  try {
    if (!req.agent.permissions.includes('invoices')) return res.status(403).json({ error: 'Agent lacks invoices permission' });

    const txn = getTransaction(req.params.reference);
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });
    if (txn.merchant_id !== req.agent.merchantId) return res.status(403).json({ error: 'Forbidden' });
    if (!txn.customer_email) return res.status(400).json({ error: 'No customer email on this transaction' });

    const smtp = req.agent.smtp;
    if (!smtp || !smtp.host) return res.status(400).json({ error: 'Merchant SMTP not configured' });

    const baseUrl = req.protocol + '://' + req.get('host');
    await sendInvoice(smtp, txn, baseUrl);
    markInvoiceSent(txn.reference);
    res.json({ success: true, message: 'Invoice sent to ' + txn.customer_email });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send invoice: ' + err.message });
  }
});

// PUBLIC — payment page
router.get('/payment/:reference', async (req, res) => {
  const txn = getTransaction(req.params.reference);
  if (!txn) return res.status(404).json({ error: 'Transaction not found' });

  const paymentInfo = {
    reference: txn.reference, amount: txn.amount, currency: txn.currency,
    status: txn.status, businessName: txn.business_name, description: txn.description,
    bank: {
      name: txn.bank_name, accountHolder: txn.account_holder,
      accountNumber: txn.account_number ? '****' + txn.account_number.slice(-4) : null,
      iban: txn.iban ? '****' + txn.iban.slice(-4) : null,
      swiftCode: txn.swift_code, routingNumber: txn.routing_number, country: txn.bank_country
    }
  };

  try {
    const qrData = `HafirPay Reference: ${txn.reference}\nAmount: ${txn.currency} ${txn.amount}\nTo: ${txn.account_holder}\nBank: ${txn.bank_name}`;
    paymentInfo.qrCode = await QRCode.toDataURL(qrData);
  } catch (e) {}

  res.json(paymentInfo);
});

router.post('/payment/:reference/confirm', (req, res) => {
  const txn = getTransaction(req.params.reference);
  if (!txn) return res.status(404).json({ error: 'Transaction not found' });
  updateTransactionStatus(req.params.reference, 'completed');
  res.json({ success: true, message: 'Payment confirmed' });
});

router.post('/payment/:reference/cancel', (req, res) => {
  const txn = getTransaction(req.params.reference);
  if (!txn) return res.status(404).json({ error: 'Transaction not found' });
  updateTransactionStatus(req.params.reference, 'cancelled');
  res.json({ success: true, message: 'Payment cancelled' });
});

module.exports = router;
