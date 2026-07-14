const nodemailer = require('nodemailer');

function createTransporter(smtp) {
  if (!smtp || !smtp.host || !smtp.user) return null;
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port || 587,
    secure: (smtp.port === 465),
    auth: { user: smtp.user, pass: smtp.pass }
  });
}

function generateInvoiceHtml(data) {
  const { businessName, reference, amount, currency, customerName, description, bank, payUrl } = data;
  const bankRows = [];
  if (bank.name) bankRows.push(`<tr><td style="padding:8px 0;color:#666;">Bank</td><td style="padding:8px 0;font-weight:600;">${bank.name}</td></tr>`);
  if (bank.accountHolder) bankRows.push(`<tr><td style="padding:8px 0;color:#666;">Account Holder</td><td style="padding:8px 0;font-weight:600;">${bank.accountHolder}</td></tr>`);
  if (bank.accountNumber) bankRows.push(`<tr><td style="padding:8px 0;color:#666;">Account Number</td><td style="padding:8px 0;font-weight:600;">${bank.accountNumber}</td></tr>`);
  if (bank.iban) bankRows.push(`<tr><td style="padding:8px 0;color:#666;">IBAN</td><td style="padding:8px 0;font-weight:600;">${bank.iban}</td></tr>`);
  if (bank.swiftCode) bankRows.push(`<tr><td style="padding:8px 0;color:#666;">SWIFT</td><td style="padding:8px 0;font-weight:600;">${bank.swiftCode}</td></tr>`);

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,#6c5ce7,#a855f7);padding:32px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:24px;">${businessName}</h1>
    <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;font-size:14px;">Invoice</p>
  </div>
  <div style="padding:32px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="font-size:36px;font-weight:800;color:#1a1a2e;">${currency} ${amount.toFixed(2)}</div>
      <div style="margin-top:8px;"><span style="background:#fff3cd;color:#856404;padding:4px 12px;border-radius:50px;font-size:12px;font-weight:500;">PENDING PAYMENT</span></div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr><td style="padding:8px 0;color:#666;">Invoice</td><td style="padding:8px 0;font-weight:600;">${reference}</td></tr>
      ${customerName ? `<tr><td style="padding:8px 0;color:#666;">Bill To</td><td style="padding:8px 0;font-weight:600;">${customerName}</td></tr>` : ''}
      ${description ? `<tr><td style="padding:8px 0;color:#666;">Description</td><td style="padding:8px 0;">${description}</td></tr>` : ''}
    </table>
    <h3 style="font-size:14px;color:#666;margin-bottom:8px;">Bank Transfer Details</h3>
    <table style="width:100%;border-collapse:collapse;background:#f8f9fa;border-radius:8px;padding:12px;margin-bottom:24px;">
      ${bankRows.join('')}
      <tr><td style="padding:8px 0;color:#666;">Reference</td><td style="padding:8px 0;font-weight:700;color:#6c5ce7;">${reference}</td></tr>
    </table>
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${payUrl}" style="display:inline-block;background:#6c5ce7;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;">Pay Now</a>
    </div>
    <p style="color:#999;font-size:12px;text-align:center;">Please include the invoice number as payment reference.</p>
  </div>
  <div style="background:#f8f9fa;padding:16px;text-align:center;color:#999;font-size:11px;">
    Powered by HafirPay — Payments Without Borders
  </div>
</div>
</body></html>`;
}

async function sendInvoice(smtp, txn, baseUrl) {
  const transporter = createTransporter(smtp);
  if (!transporter) throw new Error('SMTP not configured');

  const payUrl = `${baseUrl}/pay/${txn.reference}`;
  const html = generateInvoiceHtml({
    businessName: txn.business_name,
    reference: txn.reference,
    amount: txn.amount,
    currency: txn.currency,
    customerName: txn.customer_name,
    description: txn.description,
    bank: {
      name: txn.bank_name,
      accountHolder: txn.account_holder,
      accountNumber: txn.account_number ? '****' + txn.account_number.slice(-4) : null,
      iban: txn.iban ? '****' + txn.iban.slice(-4) : null,
      swiftCode: txn.swift_code
    },
    payUrl
  });

  await transporter.sendMail({
    from: smtp.from || smtp.user,
    to: txn.customer_email,
    subject: `Invoice ${txn.reference} from ${txn.business_name} — ${txn.currency} ${txn.amount.toFixed(2)}`,
    html
  });

  return true;
}

module.exports = { sendInvoice, generateInvoiceHtml, createTransporter };
