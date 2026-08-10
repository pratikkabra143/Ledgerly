const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'ledgerly.db');

async function cleanDatabase() {
    console.log('Cleaning local SQLite database (./data/ledgerly.db)...');
    
    if (fs.existsSync(DB_PATH)) {
        const db = new Database(DB_PATH);
        
        db.exec(`
            DELETE FROM invoice_items;
            DELETE FROM invoices;
            DELETE FROM purchase_items;
            DELETE FROM purchases;
            DELETE FROM stock_transactions;
            UPDATE inventory SET stock_boxes = 0, last_purchase_rate = 0;
            DELETE FROM sqlite_sequence WHERE name IN ('invoices', 'invoice_items', 'purchases', 'purchase_items', 'stock_transactions');
        `);
        
        console.log('✅ SQLite database is now 100% clean (all test transactions cleared, products preserved)!');
        db.close();
    } else {
        console.log('No local SQLite database file found.');
    }

    if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) {
        const { Pool } = require('pg');
        console.log('Connecting to PostgreSQL to clean test data...');
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('TRUNCATE TABLE invoices, invoice_items RESTART IDENTITY CASCADE;');
            await client.query('TRUNCATE TABLE purchases, purchase_items RESTART IDENTITY CASCADE;');
            await client.query('TRUNCATE TABLE stock_transactions RESTART IDENTITY CASCADE;');
            await client.query('UPDATE inventory SET stock_boxes = 0, last_purchase_rate = 0;');
            await client.query('COMMIT');
            console.log('✅ PostgreSQL database is now 100% clean!');
        } catch (err) {
            await client.query('ROLLBACK');
            console.error('Failed to clean PostgreSQL database:', err.message);
        } finally {
            client.release();
            await pool.end();
        }
    }
}

cleanDatabase();
