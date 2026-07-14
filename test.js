const http = require('http');
const { spawn } = require('child_process');

// Start server
const server = spawn('node', ['server/index.js'], { cwd: __dirname, stdio: 'pipe' });
server.stdout.on('data', (d) => process.stdout.write(d));
server.stderr.on('data', (d) => process.stderr.write(d));

function post(path, data, headers) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const h = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers };
    const req = http.request({ hostname: '127.0.0.1', port: 3000, path, method: 'POST', headers: h }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(d); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function get(path, headers) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: 3000, path, headers: headers || {} }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(d); } });
    }).on('error', reject);
  });
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function test() {
  await wait(2000);
  console.log('=== HafirPay Full Test ===\n');

  // 1. Register
  const reg = await post('/api/auth/register', { email: 'demo' + Date.now() + '@hafirpay.com', password: 'demo123', businessName: 'Hafir Demo Store' });
  const apiKey = reg.merchant?.apiKey;
  console.log('1. Register:     ', reg.success ? 'OK - Key: ' + apiKey : 'FAIL - ' + reg.error);

  // 2. Add bank
  const bank = await post('/api/bank-details', { bankName: 'Access Bank', accountHolder: 'Hafir Demo', accountNumber: '1234567890', country: 'NG', currency: 'NGN' }, { 'x-api-key': apiKey });
  console.log('2. Add Bank:     ', bank.success ? 'OK' : 'FAIL - ' + bank.error);

  // 3. Create agent key
  const agent = await post('/api/agent-keys', { name: 'AI Bot', permissions: 'payments,invoices' }, { 'x-api-key': apiKey });
  console.log('3. Agent Key:    ', agent.key ? 'OK - ' + agent.key : 'FAIL - ' + agent.error);

  // 4. Agent creates payment
  const txn = await post('/api/agent/transactions/create', { amount: 5000, currency: 'NGN', description: 'Website design', customerName: 'Jane Smith', customerEmail: 'jane@example.com' }, { 'x-agent-key': agent.key });
  console.log('4. Agent Payment:', txn.success ? 'OK - Ref: ' + txn.reference : 'FAIL - ' + txn.error);
  console.log('                  Pay URL:', txn.payUrl);

  // 5. Get payment info (public)
  const pay = await get('/api/payment/' + txn.reference);
  console.log('5. Get Payment:  ', pay.reference ? 'OK - ' + pay.amount + ' ' + pay.currency + ' to ' + pay.bank?.accountHolder : 'FAIL');

  // 6. Agent sends invoice
  const inv = await post('/api/agent/transactions/' + txn.reference + '/send-invoice', {}, { 'x-agent-key': agent.key });
  console.log('6. Send Invoice: ', inv.success ? 'OK - ' + inv.message : 'FAIL - ' + inv.error);

  // 7. Stats
  const stats = await get('/api/stats', { 'x-api-key': apiKey });
  console.log('7. Stats:        ', 'Transactions: ' + stats.totalTransactions + ' | Revenue: ' + stats.totalRevenue + ' | Pending: ' + stats.pendingTransactions);

  // 8. Confirm payment
  const confirm = await post('/api/payment/' + txn.reference + '/confirm', {});
  console.log('8. Confirm:      ', confirm.success ? 'OK' : 'FAIL');

  console.log('\n=== Server running at http://localhost:3000 ===');
  server.kill();
  process.exit(0);
}

test().catch(e => { console.error('TEST FAIL:', e.message); server.kill(); process.exit(1); });
