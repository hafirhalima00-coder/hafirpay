# HafirPay — Payments Without Borders

A modern payment gateway for underserved regions. Zero fees, no approval process, direct bank transfers.

## Quick Start

```bash
npm install
npm start
# Open http://localhost:3000
```

## Features

- **Merchant Dashboard** — Transaction tracking, revenue stats
- **Payment Links** — Generate shareable links with QR codes
- **Email Invoicing** — Professional HTML invoices via SMTP
- **Agent API Keys** — AI agents can create payments and send invoices
- **REST API** — Full API for e-commerce integration
- **Multi-Currency** — 13+ currencies, 50+ countries

## How It Works

1. Merchant adds bank account details
2. Shares payment link with customer
3. Customer sees modern checkout page
4. Customer transfers directly to merchant's bank
5. Merchant gets paid — no middleman

## API

```bash
# Create payment
curl -X POST http://localhost:3000/api/transactions/create \
  -H "x-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"amount": 25.00, "currency": "USD", "description": "Order #1"}'

# Agent creates payment
curl -X POST http://localhost:3000/api/agent/transactions/create \
  -H "x-agent-key: AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"amount": 50.00, "currency": "NGN", "customerEmail": "client@example.com"}'
```

## Tech Stack

- Node.js + Express
- SQLite (better-sqlite3)
- Vanilla JS frontend
- Nodemailer (email)
- QRCode generation

## License

MIT
