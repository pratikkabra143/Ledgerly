const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const dbUrl = process.env.DATABASE_URL && process.env.DATABASE_URL.trim();

let pool;

if (dbUrl) {
    pool = new Pool({
        connectionString: dbUrl,
        ssl: dbUrl.includes('localhost') ? false : { rejectUnauthorized: false }
    });
} else {
    const sqliteInit = require('./init');
    const sqliteDb = sqliteInit.initDB();
    sqliteInit.seedProducts(sqliteDb);

    function pgToSqlite(sql) {
        let s = sql.replace(/\$([0-9]+)/g, '@p$1');
        s = s.replace(/\bILIKE\b/gi, 'LIKE');
        s = s.replace(/\bGREATEST\(([^,]+),\s*([^)]+)\)/gi, 'MAX($1, $2)');
        return s;
    }

    function runQuery(sql, params = []) {
        const cleanSql = pgToSqlite(sql).trim();
        const isSelect = /^SELECT/i.test(cleanSql);
        const hasReturning = /RETURNING/i.test(cleanSql);

        let queryParams = params;
        if (Array.isArray(params) && params.length > 0) {
            queryParams = {};
            params.forEach((p, i) => { queryParams['p' + (i + 1)] = p; });
        }

        if (isSelect || hasReturning) {
            const rows = sqliteDb.prepare(cleanSql).all(queryParams);
            return { rows, rowCount: rows.length };
        } else {
            const info = sqliteDb.prepare(cleanSql).run(queryParams);
            return { rows: [], rowCount: info.changes };
        }
    }

    pool = {
        query: async (sql, params) => runQuery(sql, params),
        connect: async () => ({
            query: async (sql, params) => runQuery(sql, params),
            release: () => {}
        }),
        end: async () => {
            sqliteDb.close();
        }
    };
}

async function initDB() {
    if (dbUrl) {
        const client = await pool.connect();
        try {
            await client.query(`
                CREATE TABLE IF NOT EXISTS products (
                    id SERIAL PRIMARY KEY,
                    name TEXT UNIQUE NOT NULL,
                    net_qty TEXT NOT NULL,
                    pcs_per_box INTEGER NOT NULL DEFAULT 1,
                    selling_rate REAL NOT NULL DEFAULT 0,
                    purchase_rate REAL NOT NULL DEFAULT 0,
                    category TEXT DEFAULT 'General',
                    hsn_code TEXT DEFAULT '21050000',
                    is_active INTEGER NOT NULL DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS inventory (
                    id SERIAL PRIMARY KEY,
                    product_id INTEGER NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
                    stock_boxes REAL NOT NULL DEFAULT 0,
                    last_purchase_rate REAL NOT NULL DEFAULT 0,
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS stock_transactions (
                    id SERIAL PRIMARY KEY,
                    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                    type TEXT NOT NULL CHECK(type IN ('IN', 'OUT', 'ADJUST')),
                    boxes REAL NOT NULL,
                    purchase_rate REAL DEFAULT 0,
                    reference TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS invoices (
                    id SERIAL PRIMARY KEY,
                    invoice_no TEXT UNIQUE NOT NULL,
                    date TEXT NOT NULL,
                    customer_name TEXT NOT NULL DEFAULT 'WALK-IN CUSTOMER',
                    customer_phone TEXT DEFAULT '',
                    customer_gstin TEXT DEFAULT '',
                    subtotal REAL NOT NULL DEFAULT 0,
                    cgst REAL NOT NULL DEFAULT 0,
                    sgst REAL NOT NULL DEFAULT 0,
                    total REAL NOT NULL DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS invoice_items (
                    id SERIAL PRIMARY KEY,
                    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
                    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
                    product_name TEXT NOT NULL,
                    net_qty TEXT,
                    pcs INTEGER DEFAULT 0,
                    boxes REAL NOT NULL DEFAULT 0,
                    rate REAL NOT NULL DEFAULT 0,
                    amount REAL NOT NULL DEFAULT 0,
                    hsn_code TEXT DEFAULT '21050000'
                );

                CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product_id);
                CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
                CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date);
                CREATE INDEX IF NOT EXISTS idx_stock_transactions_product ON stock_transactions(product_id);

                CREATE TABLE IF NOT EXISTS purchases (
                    id SERIAL PRIMARY KEY,
                    supplier_name TEXT NOT NULL,
                    date TEXT NOT NULL,
                    total_boxes REAL NOT NULL DEFAULT 0,
                    total_amount REAL NOT NULL DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS purchase_items (
                    id SERIAL PRIMARY KEY,
                    purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
                    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
                    product_name TEXT NOT NULL,
                    boxes REAL NOT NULL DEFAULT 0,
                    purchase_rate REAL NOT NULL DEFAULT 0,
                    amount REAL NOT NULL DEFAULT 0
                );

                CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(date);
                CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id);
                
                ALTER TABLE products ADD COLUMN IF NOT EXISTS hsn_code TEXT DEFAULT '21050000';
                ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS hsn_code TEXT DEFAULT '21050000';
                ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS hsn_code TEXT DEFAULT '21050000';
            `);
            console.log('PostgreSQL schema initialized successfully.');
        } catch (err) {
            console.error('Error initializing PostgreSQL schema:', err);
        } finally {
            client.release();
        }
    } else {
        console.log('Local SQLite WAL engine active (./data/ledgerly.db).');
    }
    return pool;
}

module.exports = { initDB, pool };
