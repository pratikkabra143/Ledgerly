const express = require('express');

module.exports = function(pool) {
    const router = express.Router();

    // GET /api/inventory — Get all stock levels with product details
    router.get('/', async (req, res) => {
        try {
            const { search, category, low_stock } = req.query;
            let query = `
                SELECT p.*, i.stock_boxes, i.last_purchase_rate, i.last_updated as stock_updated
                FROM products p
                LEFT JOIN inventory i ON p.id = i.product_id
                WHERE p.is_active = 1
            `;
            const params = [];

            if (search) {
                params.push(`%${search}%`);
                query += ` AND p.name ILIKE $${params.length}`;
            }
            if (category) {
                params.push(category);
                query += ` AND p.category = $${params.length}`;
            }
            if (low_stock === '1') {
                query += ' AND (i.stock_boxes IS NULL OR i.stock_boxes <= 2)';
            }

            query += ' ORDER BY p.category, p.name';
            const { rows } = await pool.query(query, params);
            res.json(rows);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    });

    // GET /api/inventory/summary — Stock value summary
    router.get('/summary', async (req, res) => {
        try {
            const { rows } = await pool.query(`
                SELECT
                    COUNT(DISTINCT p.id) as total_products,
                    COALESCE(SUM(i.stock_boxes), 0) as total_boxes,
                    COALESCE(SUM(i.stock_boxes * p.purchase_rate), 0) as total_purchase_cost,
                    COALESCE(SUM(i.stock_boxes * p.selling_rate), 0) as total_selling_value_excl_gst,
                    COALESCE(SUM(i.stock_boxes * p.selling_rate * 1.05), 0) as total_selling_value_incl_gst,
                    COALESCE(SUM(CASE WHEN i.stock_boxes <= 2 THEN 1 ELSE 0 END), 0) as low_stock_count
                FROM products p
                LEFT JOIN inventory i ON p.id = i.product_id
                WHERE p.is_active = 1
            `);
            const summary = rows[0];

            // Convert to numbers since Postgres SUM might return strings
            summary.total_products = parseInt(summary.total_products);
            summary.total_boxes = parseFloat(summary.total_boxes);
            summary.total_purchase_cost = parseFloat(summary.total_purchase_cost);
            summary.total_selling_value_excl_gst = parseFloat(summary.total_selling_value_excl_gst);
            summary.total_selling_value_incl_gst = parseFloat(summary.total_selling_value_incl_gst);
            summary.low_stock_count = parseInt(summary.low_stock_count);
            summary.estimated_profit = summary.total_selling_value_incl_gst - summary.total_purchase_cost;

            res.json(summary);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    });

    // PUT /api/inventory/:productId — Manually adjust stock
    router.put('/:productId', async (req, res) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { stock_boxes } = req.body;
            const productId = req.params.productId;

            if (stock_boxes === undefined || stock_boxes < 0) {
                return res.status(400).json({ error: 'Valid stock_boxes value required' });
            }

            const currentRes = await client.query('SELECT stock_boxes FROM inventory WHERE product_id = $1', [productId]);
            const oldStock = currentRes.rows.length > 0 ? currentRes.rows[0].stock_boxes : 0;

            await client.query(`
                INSERT INTO inventory (product_id, stock_boxes, last_updated)
                VALUES ($1, $2, CURRENT_TIMESTAMP)
                ON CONFLICT (product_id) DO UPDATE SET
                    stock_boxes = EXCLUDED.stock_boxes,
                    last_updated = CURRENT_TIMESTAMP
            `, [productId, stock_boxes]);

            // Log adjustment
            await client.query(`
                INSERT INTO stock_transactions (product_id, type, boxes, reference)
                VALUES ($1, 'ADJUST', $2, $3)
            `, [productId, stock_boxes - oldStock, `Adjusted from ${oldStock} to ${stock_boxes}`]);

            await client.query('COMMIT');
            res.json({ message: 'Stock updated', product_id: productId, stock_boxes });
        } catch (err) {
            await client.query('ROLLBACK');
            console.error(err);
            res.status(500).json({ error: err.message });
        } finally {
            client.release();
        }
    });

    // GET /api/inventory/transactions — Stock transaction history
    router.get('/transactions', async (req, res) => {
        try {
            const { product_id, limit } = req.query;
            let query = `
                SELECT st.*, p.name as product_name
                FROM stock_transactions st
                JOIN products p ON st.product_id = p.id
            `;
            const params = [];

            if (product_id) {
                params.push(product_id);
                query += ` WHERE st.product_id = $${params.length}`;
            }

            query += ' ORDER BY st.created_at DESC';
            
            const reqLimit = parseInt(limit) || 50;
            params.push(reqLimit);
            query += ` LIMIT $${params.length}`;

            const { rows } = await pool.query(query, params);
            res.json(rows);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    });

    // DELETE /api/inventory/transaction/:id — Revert a stock transaction
    router.delete('/transaction/:id', async (req, res) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const transId = req.params.id;

            // Fetch transaction details
            const transRes = await client.query('SELECT product_id, boxes, type FROM stock_transactions WHERE id = $1', [transId]);
            if (transRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Transaction not found' });
            }

            const { product_id, boxes } = transRes.rows[0];

            // Revert stock (subtract the exact boxes amount that was originally logged)
            await client.query(`
                UPDATE inventory SET
                    stock_boxes = GREATEST(0, stock_boxes - $2),
                    last_updated = CURRENT_TIMESTAMP
                WHERE product_id = $1
            `, [product_id, boxes]);

            // Delete the transaction from history
            await client.query('DELETE FROM stock_transactions WHERE id = $1', [transId]);

            await client.query('COMMIT');
            res.json({ message: 'Transaction reverted and deleted successfully' });
        } catch (err) {
            await client.query('ROLLBACK');
            console.error(err);
            res.status(500).json({ error: err.message });
        } finally {
            client.release();
        }
    });

    return router;
};
