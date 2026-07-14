const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

const db = new Database(path.join(__dirname, '..', 'hafirpay.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS merchants (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    business_name TEXT NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    smtp_host TEXT,
    smtp_port INTEGER DEFAULT 587,
    smtp_user TEXT,
    smtp_pass TEXT,
    smtp_from TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS agent_keys (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    key TEXT UNIQUE NOT NULL,
    permissions TEXT DEFAULT 'payments,invoices',
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
  );

  CREATE TABLE IF NOT EXISTS bank_details (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    bank_name TEXT NOT NULL,
    account_holder TEXT NOT NULL,
    account_number TEXT NOT NULL,
    routing_number TEXT,
    iban TEXT,
    swift_code TEXT,
    country TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    is_default INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    bank_detail_id TEXT,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    customer_name TEXT,
    customer_email TEXT,
    description TEXT,
    status TEXT DEFAULT 'pending',
    reference TEXT UNIQUE NOT NULL,
    invoice_sent INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    paid_at DATETIME,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id),
    FOREIGN KEY (bank_detail_id) REFERENCES bank_details(id)
  );

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
  );
`);

function createMerchant(email, password, businessName) {
  const id = uuidv4();
  const hashedPassword = bcrypt.hashSync(password, 10);
  const apiKey = 'hp_' + uuidv4().replace(/-/g, '');
  db.prepare('INSERT INTO merchants (id, email, password, business_name, api_key) VALUES (?, ?, ?, ?, ?)').run(id, email, hashedPassword, businessName, apiKey);
  return { id, email, businessName, apiKey };
}

function authenticateMerchant(email, password) {
  const merchant = db.prepare('SELECT * FROM merchants WHERE email = ?').get(email);
  if (!merchant || !bcrypt.compareSync(password, merchant.password)) return null;
  return { id: merchant.id, email: merchant.email, businessName: merchant.business_name, apiKey: merchant.api_key };
}

function authenticateByApiKey(apiKey) {
  const merchant = db.prepare('SELECT * FROM merchants WHERE api_key = ?').get(apiKey);
  if (!merchant) return null;
  return { id: merchant.id, email: merchant.email, businessName: merchant.business_name, apiKey: merchant.api_key };
}

function authenticateAgentKey(key) {
  const agent = db.prepare(`
    SELECT ak.*, m.id as merchant_id, m.business_name, m.email as merchant_email, m.api_key as merchant_api_key,
           m.smtp_host, m.smtp_port, m.smtp_user, m.smtp_pass, m.smtp_from
    FROM agent_keys ak
    JOIN merchants m ON ak.merchant_id = m.id
    WHERE ak.key = ? AND ak.active = 1
  `).get(key);
  if (!agent) return null;
  return {
    agentId: agent.id,
    agentName: agent.name,
    permissions: agent.permissions.split(','),
    merchantId: agent.merchant_id,
    businessName: agent.business_name,
    merchantEmail: agent.merchant_email,
    merchantApiKey: agent.merchant_api_key,
    smtp: { host: agent.smtp_host, port: agent.smtp_port, user: agent.smtp_user, pass: agent.smtp_pass, from: agent.smtp_from }
  };
}

function createAgentKey(merchantId, name, permissions) {
  const id = uuidv4();
  const key = 'hak_' + uuidv4().replace(/-/g, '');
  db.prepare('INSERT INTO agent_keys (id, merchant_id, name, key, permissions) VALUES (?, ?, ?, ?, ?)').run(id, merchantId, name, key, permissions || 'payments,invoices');
  return { id, name, key, permissions };
}

function getAgentKeys(merchantId) {
  return db.prepare('SELECT id, name, key, permissions, active, created_at FROM agent_keys WHERE merchant_id = ?').all(merchantId);
}

function revokeAgentKey(merchantId, keyId) {
  db.prepare('UPDATE agent_keys SET active = 0 WHERE id = ? AND merchant_id = ?').run(keyId, merchantId);
}

function updateSmtp(merchantId, smtp) {
  db.prepare('UPDATE merchants SET smtp_host = ?, smtp_port = ?, smtp_user = ?, smtp_pass = ?, smtp_from = ? WHERE id = ?')
    .run(smtp.host, smtp.port, smtp.user, smtp.pass, smtp.from, merchantId);
}

function getMerchantSmtp(merchantId) {
  const m = db.prepare('SELECT smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from FROM merchants WHERE id = ?').get(merchantId);
  return m;
}

function addBankDetail(merchantId, data) {
  const id = uuidv4();
  db.prepare('INSERT INTO bank_details (id, merchant_id, bank_name, account_holder, account_number, routing_number, iban, swift_code, country, currency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, merchantId, data.bankName, data.accountHolder, data.accountNumber, data.routingNumber || null, data.iban || null, data.swiftCode || null, data.country, data.currency || 'USD');
  return id;
}

function getBankDetails(merchantId) {
  return db.prepare('SELECT * FROM bank_details WHERE merchant_id = ?').all(merchantId);
}

function createTransaction(merchantId, data) {
  const id = uuidv4();
  const reference = 'HP-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6).toUpperCase();
  db.prepare('INSERT INTO transactions (id, merchant_id, bank_detail_id, amount, currency, customer_name, customer_email, description, reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, merchantId, data.bankDetailId || null, data.amount, data.currency || 'USD', data.customerName || null, data.customerEmail || null, data.description || null, reference);
  return { id, reference };
}

function getTransaction(reference) {
  return db.prepare(`
    SELECT t.*, m.business_name, m.email as merchant_email, b.bank_name, b.account_holder, b.account_number, b.iban, b.swift_code, b.routing_number, b.country as bank_country
    FROM transactions t
    JOIN merchants m ON t.merchant_id = m.id
    LEFT JOIN bank_details b ON t.bank_detail_id = b.id
    WHERE t.reference = ?
  `).get(reference);
}

function updateTransactionStatus(reference, status) {
  const paidAt = status === 'completed' ? new Date().toISOString() : null;
  if (paidAt) {
    db.prepare('UPDATE transactions SET status = ?, paid_at = ? WHERE reference = ?').run(status, paidAt, reference);
  } else {
    db.prepare('UPDATE transactions SET status = ? WHERE reference = ?').run(status, reference);
  }
}

function markInvoiceSent(reference) {
  db.prepare('UPDATE transactions SET invoice_sent = 1 WHERE reference = ?').run(reference);
}

function getMerchantTransactions(merchantId) {
  return db.prepare('SELECT * FROM transactions WHERE merchant_id = ? ORDER BY created_at DESC').all(merchantId);
}

function getMerchantStats(merchantId) {
  const total = db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM transactions WHERE merchant_id = ?').get(merchantId);
  const completed = db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM transactions WHERE merchant_id = ? AND status = ?').get(merchantId, 'completed');
  const pending = db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM transactions WHERE merchant_id = ? AND status = ?').get(merchantId, 'pending');
  return {
    totalTransactions: total.count, totalRevenue: total.total,
    completedTransactions: completed.count, completedRevenue: completed.total,
    pendingTransactions: pending.count, pendingRevenue: pending.total
  };
}

function createProduct(merchantId, data) {
  const id = uuidv4();
  db.prepare('INSERT INTO products (id, merchant_id, name, description, price, currency) VALUES (?, ?, ?, ?, ?, ?)').run(id, merchantId, data.name, data.description || null, data.price, data.currency || 'USD');
  return id;
}

function getMerchantProducts(merchantId) {
  return db.prepare('SELECT * FROM products WHERE merchant_id = ? AND active = 1').all(merchantId);
}

module.exports = {
  db, createMerchant, authenticateMerchant, authenticateByApiKey,
  authenticateAgentKey, createAgentKey, getAgentKeys, revokeAgentKey,
  updateSmtp, getMerchantSmtp,
  addBankDetail, getBankDetails, createTransaction, getTransaction,
  updateTransactionStatus, markInvoiceSent, getMerchantTransactions,
  getMerchantStats, createProduct, getMerchantProducts
};
