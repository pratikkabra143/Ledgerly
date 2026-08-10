const { Pool } = require('pg');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    console.log('Starting migration to Supabase...');
    try {
        const dataPath = path.join(__dirname, 'products.json');
        const fileContent = fs.readFileSync(dataPath, 'utf8');
        const products = JSON.parse(fileContent);

        console.log(`Found ${products.length} products to migrate.`);
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            for (const prod of products) {
                const category = prod.category || 'Uncategorized';
                const purchaseRate = prod.purchase_rate || 0;
                const netQty = prod.net_qty || '---';
                const pcsPerBox = prod.pcs_per_box || 1;
                const sellingRate = prod.selling_rate || 0;

                const existing = await client.query('SELECT id FROM products WHERE name = $1', [prod.name]);

                if (existing.rows.length === 0) {
                    const insertRes = await client.query(
                        `INSERT INTO products (name, category, net_qty, pcs_per_box, purchase_rate, selling_rate) 
                         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
                        [prod.name, category, netQty, pcsPerBox, purchaseRate, sellingRate]
                    );
                    const productId = insertRes.rows[0].id;
                    
                    await client.query(
                        `INSERT INTO inventory (product_id, stock_boxes) VALUES ($1, 0) ON CONFLICT (product_id) DO NOTHING`,
                        [productId]
                    );
                    console.log(`+ Added: ${prod.name}`);
                } else {
                    await client.query(
                        `UPDATE products SET 
                            category = $1, net_qty = $2, pcs_per_box = $3, 
                            purchase_rate = $4, selling_rate = $5 
                         WHERE name = $6`,
                        [category, netQty, pcsPerBox, purchaseRate, sellingRate, prod.name]
                    );
                    console.log(`~ Updated ${prod.name}`);
                }
            }

            await client.query('COMMIT');
            console.log('✅ Migration completed successfully!');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (e) {
        console.error('Migration failed:', e.stack);
    } finally {
        pool.end();
    }
}

migrate();
