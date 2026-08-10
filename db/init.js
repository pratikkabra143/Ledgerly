const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'ledgerly.db');
const PRODUCTS_JSON_PATH = path.join(__dirname, '..', 'products.json');

function normalizeProduct(product) {
    return {
        name: String(product.name || '').trim(),
        net_qty: String(product.net_qty || '').trim(),
        pcs_per_box: Number.isFinite(Number(product.pcs_per_box)) ? Number(product.pcs_per_box) : 1,
        selling_rate: Number.isFinite(Number(product.selling_rate)) ? Number(product.selling_rate) : 0,
        purchase_rate: Number.isFinite(Number(product.purchase_rate)) ? Number(product.purchase_rate) : 0,
        category: String(product.category || 'General').trim() || 'General'
    };
}

function readProductsJson() {
    if (!fs.existsSync(PRODUCTS_JSON_PATH)) {
        return [];
    }

    const raw = fs.readFileSync(PRODUCTS_JSON_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
        throw new Error('products.json must contain an array of products');
    }

    return parsed
        .map(normalizeProduct)
        .filter((product) => product.name && product.net_qty);
}

function writeProductsJson(products) {
    const normalized = products
        .map(normalizeProduct)
        .filter((product) => product.name && product.net_qty)
        .sort((a, b) => {
            const categoryCompare = a.category.localeCompare(b.category);
            if (categoryCompare !== 0) return categoryCompare;
            return a.name.localeCompare(b.name);
        });

    fs.writeFileSync(PRODUCTS_JSON_PATH, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
}

function initDB() {
    // Ensure data directory exists
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    const db = new Database(DB_PATH);

    // Enable WAL mode for better performance
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Create tables
    db.exec(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            net_qty TEXT NOT NULL,
            pcs_per_box INTEGER NOT NULL DEFAULT 1,
            selling_rate REAL NOT NULL DEFAULT 0,
            purchase_rate REAL NOT NULL DEFAULT 0,
            category TEXT DEFAULT 'General',
            hsn_code TEXT DEFAULT '21050000',
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS inventory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL UNIQUE,
            stock_boxes REAL NOT NULL DEFAULT 0,
            last_purchase_rate REAL NOT NULL DEFAULT 0,
            last_updated TEXT DEFAULT (datetime('now','localtime')),
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS stock_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('IN', 'OUT', 'ADJUST')),
            boxes REAL NOT NULL,
            purchase_rate REAL DEFAULT 0,
            reference TEXT,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_no TEXT UNIQUE NOT NULL,
            date TEXT NOT NULL,
            customer_name TEXT NOT NULL DEFAULT 'WALK-IN CUSTOMER',
            customer_phone TEXT DEFAULT '',
            customer_gstin TEXT DEFAULT '',
            subtotal REAL NOT NULL DEFAULT 0,
            cgst REAL NOT NULL DEFAULT 0,
            sgst REAL NOT NULL DEFAULT 0,
            total REAL NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS invoice_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_id INTEGER NOT NULL,
            product_id INTEGER,
            product_name TEXT NOT NULL,
            net_qty TEXT,
            pcs INTEGER DEFAULT 0,
            boxes REAL NOT NULL DEFAULT 0,
            rate REAL NOT NULL DEFAULT 0,
            amount REAL NOT NULL DEFAULT 0,
            hsn_code TEXT DEFAULT '21050000',
            FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product_id);
        CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
        CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date);
        CREATE INDEX IF NOT EXISTS idx_stock_transactions_product ON stock_transactions(product_id);

        CREATE TABLE IF NOT EXISTS purchases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            supplier_name TEXT NOT NULL,
            date TEXT NOT NULL,
            total_boxes REAL NOT NULL DEFAULT 0,
            total_amount REAL NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS purchase_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            purchase_id INTEGER NOT NULL,
            product_id INTEGER,
            product_name TEXT NOT NULL,
            boxes REAL NOT NULL DEFAULT 0,
            purchase_rate REAL NOT NULL DEFAULT 0,
            amount REAL NOT NULL DEFAULT 0,
            hsn_code TEXT DEFAULT '21050000',
            FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(date);
        CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id);
    `);

    // Migrations for existing SQLite database
    try { db.exec("ALTER TABLE products ADD COLUMN hsn_code TEXT DEFAULT '21050000'"); } catch (e) {}
    try { db.exec("ALTER TABLE invoice_items ADD COLUMN hsn_code TEXT DEFAULT '21050000'"); } catch (e) {}
    try { db.exec("ALTER TABLE purchase_items ADD COLUMN hsn_code TEXT DEFAULT '21050000'"); } catch (e) {}

    return db;
}

function seedProducts(db) {
    if (!fs.existsSync(PRODUCTS_JSON_PATH)) {
        console.log('No products.json found, skipping startup sync.');
        return;
    }

    const products = readProductsJson();

    const upsertProduct = db.prepare(`
        INSERT INTO products (name, net_qty, pcs_per_box, selling_rate, purchase_rate, category, is_active)
        VALUES (@name, @net_qty, @pcs_per_box, @selling_rate, @purchase_rate, @category, 1)
        ON CONFLICT(name) DO UPDATE SET
            net_qty = excluded.net_qty,
            pcs_per_box = excluded.pcs_per_box,
            selling_rate = excluded.selling_rate,
            purchase_rate = excluded.purchase_rate,
            category = excluded.category,
            is_active = 1,
            updated_at = datetime('now','localtime')
    `);

    const getProductIdByName = db.prepare('SELECT id FROM products WHERE name = ?');
    const ensureInventory = db.prepare(`
        INSERT OR IGNORE INTO inventory (product_id, stock_boxes, last_purchase_rate)
        VALUES (?, 0, 0)
    `);

    const syncAll = db.transaction((jsonProducts) => {
        for (const product of jsonProducts) {
            upsertProduct.run(product);
            const row = getProductIdByName.get(product.name);
            if (row?.id) {
                ensureInventory.run(row.id);
            }
        }

        if (jsonProducts.length === 0) {
            db.prepare(`
                UPDATE products
                SET is_active = 0, updated_at = datetime('now','localtime')
            `).run();
            return;
        }

        const names = jsonProducts.map((product) => product.name);
        const placeholders = names.map(() => '?').join(', ');
        db.prepare(`
            UPDATE products
            SET is_active = 0, updated_at = datetime('now','localtime')
            WHERE name NOT IN (${placeholders})
        `).run(...names);
    });

    syncAll(products);
    console.log(`Synced ${products.length} products from products.json to database`);
}

function syncProductsDbToJson(db) {
    const products = db.prepare(`
        SELECT name, net_qty, pcs_per_box, selling_rate, purchase_rate, category
        FROM products
        WHERE is_active = 1
        ORDER BY category, name
    `).all();

    writeProductsJson(products);
}

module.exports = { initDB, seedProducts, syncProductsDbToJson, DB_PATH };
