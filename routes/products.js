const express = require('express');

// Helper to update local JSON file (this might fail on Netlify because it's a readonly filesystem, but kept for local parity)
function syncProductsDbToJson(db) {
    // Note: We might want to remove this for full Serverless deployment since local FS is ephemeral
}

module.exports = function(pool) {
    const router = express.Router();

    // GET /api/products — List all products
    router.get('/', async (req, res) => {
        try {
            const { search, category, active } = req.query;
            let query = 'SELECT * FROM products WHERE 1=1';
            const params = [];

            if (active !== undefined) {
                params.push(parseInt(active));
                query += ` AND is_active = $${params.length}`;
            } else {
                query += ' AND is_active = 1';
            }

            if (search) {
                params.push(`%${search}%`);
                query += ` AND name ILIKE $${params.length}`;
            }

            if (category) {
                params.push(category);
                query += ` AND category = $${params.length}`;
            }

            query += ' ORDER BY category, name';
            const { rows } = await pool.query(query, params);
            res.json(rows);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    });

    // GET /api/products/categories — List all categories
    router.get('/categories', async (req, res) => {
        try {
            const { rows } = await pool.query('SELECT DISTINCT category FROM products WHERE is_active = 1 ORDER BY category');
            res.json(rows.map(c => c.category));
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    });

    // GET /api/products/:id — Get single product
    router.get('/:id', async (req, res) => {
        try {
            const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
            if (rows.length === 0) return res.status(404).json({ error: 'Product not found' });
            res.json(rows[0]);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    });

    // POST /api/products — Add new product
    router.post('/', async (req, res) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { name, net_qty, pcs_per_box, selling_rate, purchase_rate, category, hsn_code } = req.body;
            
            if (!name || !net_qty) {
                return res.status(400).json({ error: 'Name and net_qty are required' });
            }

            const insertRes = await client.query(`
                INSERT INTO products (name, net_qty, pcs_per_box, selling_rate, purchase_rate, category, hsn_code)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *
            `, [
                name,
                net_qty,
                pcs_per_box || 1,
                selling_rate || 0,
                purchase_rate || 0,
                category || 'General',
                hsn_code || '21050000'
            ]);

            const newProduct = insertRes.rows[0];

            // Create inventory entry
            await client.query('INSERT INTO inventory (product_id, stock_boxes) VALUES ($1, 0)', [newProduct.id]);
            
            await client.query('COMMIT');
            res.status(201).json(newProduct);
        } catch (err) {
            await client.query('ROLLBACK');
            if (err.message.includes('unique') || err.message.includes('UNIQUE')) {
                return res.status(409).json({ error: 'Product with this name already exists' });
            }
            res.status(500).json({ error: err.message });
        } finally {
            client.release();
        }
    });

    // PUT /api/products/:id — Update product
    router.put('/:id', async (req, res) => {
        try {
            const { name, net_qty, pcs_per_box, selling_rate, purchase_rate, category, hsn_code } = req.body;
            
            const fetchRes = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
            if (fetchRes.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
            const existing = fetchRes.rows[0];

            const updateRes = await pool.query(`
                UPDATE products SET
                    name = $1,
                    net_qty = $2,
                    pcs_per_box = $3,
                    selling_rate = $4,
                    purchase_rate = $5,
                    category = $6,
                    hsn_code = $7,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $8
                RETURNING *
            `, [
                name || existing.name,
                net_qty || existing.net_qty,
                pcs_per_box ?? existing.pcs_per_box,
                selling_rate ?? existing.selling_rate,
                purchase_rate ?? existing.purchase_rate,
                category || existing.category,
                hsn_code || existing.hsn_code,
                req.params.id
            ]);

            res.json(updateRes.rows[0]);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    });

    // DELETE /api/products/:id — Soft delete
    router.delete('/:id', async (req, res) => {
        try {
            const updateRes = await pool.query(`
                UPDATE products SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id
            `, [req.params.id]);

            if (updateRes.rowCount === 0) return res.status(404).json({ error: 'Product not found' });

            res.json({ message: 'Product deactivated', id: req.params.id });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
