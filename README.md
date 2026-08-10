# Ledgerly — GST Invoicing, Inventory & Compliance

[![Node.js](https://img.shields.io/badge/Node.js-v18+-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.21-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com/)
[![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?style=flat-square&logo=sqlite&logoColor=white)](https://sqlite.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-pg--pool-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

**Ledgerly** is a full-stack GST invoicing, inventory management, and compliance web app built for Indian retail distributors and wholesale merchants. It combines fast GST billing, box-to-piece stock tracking, inward purchase management, sales reporting, and CA-ready exports in a single system.

> **Local-first, cloud-ready:** Ledgerly can run against a local SQLite database for a single-machine setup or use PostgreSQL for multi-device cloud deployments.

---

## ✨ Features

### 🧾 GST Invoicing & Thermal Printing
- Automatic calculation of subtotal, CGST, SGST, IGST, and rounded invoice totals.
- Fast customer and product lookup for day-to-day billing.
- Invoice layouts optimized for standard desktop and thermal bill printers.
- One-click WhatsApp receipt generation with pre-filled customer messages.

### 📦 Inventory & Stock Ledger
- Automatically deducts stock when an invoice is completed.
- Supports wholesale box-to-piece inventory calculations.
- Tracks stock movements as `IN`, `OUT`, and `ADJUST` transactions.
- Reversible deletion restores the affected inventory quantities while preserving invoice numbering.

### 📥 Inward Purchases & ITC
- Record bulk inventory purchases from suppliers.
- Automatically calculate unit purchase costs and update stock balances.
- Maintain purchase history and Input Tax Credit (ITC) data for compliance workflows.

### 📊 Sales Reports & GST Exports
- Filter sales history by date range.
- View aggregate revenue and tax totals.
- Export itemized Sales Registers as Excel (`.xlsx`) files using CA/Tally-oriented columns.
- Export structured JSON containing `b2b`, `b2cs`, and `hsn` data for GST filing workflows.

---

## 🎯 Why Ledgerly?

Ledgerly is designed around a practical problem: small distributors need billing software that is quick enough for daily checkout without turning routine inventory and GST work into a separate accounting exercise.

The project focuses on three things:

1. **Fast billing** — Minimize the steps required to create a GST invoice.
2. **Reliable inventory** — Keep physical box/piece stock and transaction history synchronized with sales and purchases.
3. **Useful compliance data** — Turn operational records into reports and structured exports that can be handed to accounting workflows.

---

## 🏗️ Architecture

```mermaid
graph TD
    UI["Web UI / PWA"] -->|"REST API + Bearer JWT"| Server["Node.js + Express"]

    subgraph Data_Layer ["Data Layer"]
        SQLite[("SQLite / WAL")]
        Postgres[("PostgreSQL")]
    end

    subgraph Deployment_Layer ["Deployment"]
        Netlify["Netlify"]
    end

    Server -->|"Local Mode"| SQLite
    Server -->|"Cloud Mode"| Postgres
    Server -->|"serverless-http"| Netlify
```

### Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, Vanilla JavaScript (ES6+), Vanilla CSS |
| Backend | Node.js, Express.js |
| Authentication | JWT (`jsonwebtoken`) |
| Local database | SQLite via `better-sqlite3` with WAL mode |
| Cloud database | PostgreSQL via `pg` connection pooling |
| Excel exports | `exceljs` |
| GST exports | Structured JSON generation |
| Offline/PWA | Service Worker + Web App Manifest |
| Serverless deployment | Netlify + `serverless-http` |

For a deeper breakdown of the database model, authentication flow, database abstraction, PWA layer, and deployment architecture, see **[ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

---

## 🚀 Quick Start

### Prerequisites

- Node.js **v18+**
- npm **v9+**

### 1. Clone & Install

```bash
git clone https://github.com/pratikkabra143/ledgerly.git
cd ledgerly
npm install
```

### 2. Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Example configuration:

```env
# Database Configuration (Leave blank for local SQLite)
# DATABASE_URL="postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres"

# Authentication
JWT_SECRET="change_this_to_a_secure_random_secret"
ADMIN_PASSWORD="change_this_to_a_secure_password"

# Server Port
PORT=3000
```

> **Security:** Never commit your real `.env` file or production secrets to Git.

### 3. Start the Development Server

```bash
npm run dev
```

Then open:

- **Billing:** `http://localhost:3000`
- **Inventory:** `http://localhost:3000/inventory.html`
- **Sales Reports:** `http://localhost:3000/sales.html`
- **Purchases:** `http://localhost:3000/purchases-registry.html`
- **Login:** `http://localhost:3000/login.html`

---

## 🗄️ Database Modes

### Option A — Local SQLite

No database server is required.

When `DATABASE_URL` is omitted, Ledgerly initializes:

```text
./data/ledgerly.db
```

This mode is intended for a straightforward single-machine deployment.

### Option B — PostgreSQL / Supabase

For multi-device or cloud deployments:

1. Create a PostgreSQL database using Supabase or another PostgreSQL host.
2. Add the connection string to `.env`:

```env
DATABASE_URL="postgresql://postgres:your_password@db.your_ref.supabase.co:5432/postgres"
```

3. Restart the application.

The PostgreSQL schema is initialized automatically on startup.

---

## ☁️ Netlify Deployment

Ledgerly includes a Netlify serverless adapter at `functions/api.js`.

High-level deployment:

1. Push the repository to GitHub.
2. Import the repository into Netlify.
3. Configure the publish directory as `public`.
4. Add the required environment variables:
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `ADMIN_PASSWORD`
5. Deploy.

The serverless adapter allows the Express application to run through Netlify Functions while the PostgreSQL database provides persistent cloud storage.

---

## 🌐 API Overview

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `POST` | `/api/auth/login` | Authenticate and issue a 30-day JWT | No |
| `GET` | `/api/products` | Fetch product catalog and HSN rates | Yes |
| `GET` | `/api/products/categories` | Get unique product categories | Yes |
| `GET` | `/api/products/:id` | Fetch specific product details | Yes |
| `POST` | `/api/products` | Create a new product | Yes |
| `PUT` | `/api/products/:id` | Update an existing product | Yes |
| `DELETE` | `/api/products/:id` | Delete a product | Yes |
| `GET` | `/api/inventory` | Fetch stock levels and alerts | Yes |
| `GET` | `/api/inventory/summary` | Get aggregated inventory valuation | Yes |
| `PUT` | `/api/inventory/:productId` | Add, deduct, or adjust stock | Yes |
| `GET` | `/api/inventory/transactions` | Fetch all inventory ledger entries | Yes |
| `DELETE` | `/api/inventory/transaction/:id` | Reverse an inventory transaction | Yes |
| `GET` | `/api/invoices/next-number` | Get the next sequential invoice prefix | Yes |
| `GET` | `/api/invoices` | Retrieve all invoices | Yes |
| `POST` | `/api/invoices` | Create invoice and deduct stock | Yes |
| `GET` | `/api/invoices/:id` | Retrieve specific invoice details | Yes |
| `DELETE` | `/api/invoices/:id` | Reversibly delete an invoice | Yes |
| `GET` | `/api/sales/report` | Generate date-range sales summary | Yes |
| `GET` | `/api/sales/export` | Export CA-oriented Sales Register (Excel) | Yes |
| `GET` | `/api/sales/export/gstr1` | Export GSTR-1 JSON | Yes |
| `GET` | `/api/purchases` | Retrieve inward purchase history | Yes |
| `POST` | `/api/purchases` | Record purchase and update inventory | Yes |
| `GET` | `/api/purchases/:id` | Retrieve specific purchase details | Yes |
| `DELETE` | `/api/purchases/:id` | Delete an inward purchase | Yes |
| `GET` | `/api/purchases/export` | Export Inward Purchase Register (Excel) | Yes |
| `GET` | `/api/purchases/export/gstr2`| Export GSTR-2 JSON | Yes |

---

## 🎨 Customization

### Store Information

Update the store details in `public/index.html` to change the business name, address, GSTIN, phone number, and email shown by the application.

### Product Catalog

Update `products.json` to configure initial products, packaging sizes, selling/purchase rates, and HSN codes.

### Theme

Adjust the CSS variables in `public/css/style.css` under `:root` to customize the application's visual theme.

---

## 📁 Project Structure

```text
ledgerly/
├── .env.example                 # Environment configuration template
├── .env                         # Local environment configuration
├── server.js                    # Express server and API entry point
├── package.json                 # Node.js dependencies and scripts
├── products.json                # Product catalog seed data
│
├── db/
│   ├── init.js                  # SQLite initialization and transaction setup
│   └── init_pg.js               # PostgreSQL schema initialization
│
├── functions/
│   └── api.js                   # Netlify serverless function entry point
│
├── routes/
│   ├── products.js              # Product API handlers
│   ├── inventory.js             # Inventory API handlers
│   ├── invoices.js              # Invoice API handlers
│   ├── sales.js                 # Sales reporting and export handlers
│   └── purchases.js             # Inward purchase API handlers
│
├── public/
│   ├── index.html               # Main invoice interface
│   ├── inventory.html           # Inventory dashboard
│   ├── sales.html               # Sales and export dashboard
│   ├── purchases-registry.html  # Inward purchase registry
│   ├── login.html               # Authentication page
│   ├── manifest.json            # PWA manifest
│   ├── sw.js                    # Service worker
│   ├── css/
│   │   └── style.css            # Shared design system
│   └── js/
│       ├── auth.js              # Client-side JWT session handling
│       ├── invoice.js           # Invoice interface controller
│       ├── inventory.js         # Inventory page controller
│       └── shared.js            # Shared UI utilities
│
└── docs/
    └── ARCHITECTURE.md          # Detailed technical architecture
```

---

## 📚 Documentation

- **[Technical Architecture](docs/ARCHITECTURE.md)** — Database design, security model, dual-database layer, PWA behavior, and serverless deployment.
- **[License](LICENSE)** — MIT License.

---

## 📜 License

Released under the **MIT License**.

**Author:** Pratik Kabra
