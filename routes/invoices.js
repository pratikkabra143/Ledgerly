const express = require('express');

module.exports = function(pool) {
    const router = express.Router();

    // GET /api/invoices/next-number — Get next invoice number
    router.get('/next-number', async (req, res) => {
        try {
            const date = new Date();
            const yearShort = String(date.getFullYear()).slice(-2);
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const prefix = `INV-${yearShort}${month}-`;

            const { rows } = await pool.query(`
                SELECT invoice_no FROM invoices
                WHERE invoice_no LIKE $1
                ORDER BY id DESC LIMIT 1
            `, [`${prefix}%`]);

            let nextNum = 1;
            if (rows.length > 0) {
                const lastNum = parseInt(rows[0].invoice_no.replace(prefix, ''));
                if (!isNaN(lastNum)) nextNum = lastNum + 1;
            }

            const invoiceNo = `${prefix}${String(nextNum).padStart(3, '0')}`;
            res.json({ invoice_no: invoiceNo });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    });

    // POST /api/invoices — Create invoice + deduct stock
    router.post('/', async (req, res) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { invoice_no, date, customer_name, customer_phone, customer_gstin, subtotal, cgst, sgst, total, items } = req.body;

            if (!invoice_no || !items || items.length === 0) {
                return res.status(400).json({ error: 'Invoice number and items are required' });
            }

            // Insert invoice header
            const invRes = await client.query(`
                INSERT INTO invoices (invoice_no, date, customer_name, customer_phone, customer_gstin, subtotal, cgst, sgst, total)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING id
            `, [
                invoice_no,
                date || new Date().toLocaleDateString('en-GB'),
                customer_name || 'WALK-IN CUSTOMER',
                customer_phone || '',
                customer_gstin || '',
                subtotal || 0,
                cgst || 0,
                sgst || 0,
                total || 0
            ]);

            const invoiceId = invRes.rows[0].id;

            for (const item of items) {
                let hsnCode = '21050000';
                if (item.product_id) {
                    const pRes = await client.query('SELECT hsn_code FROM products WHERE id = $1', [item.product_id]);
                    if (pRes.rows.length > 0 && pRes.rows[0].hsn_code) {
                        hsnCode = pRes.rows[0].hsn_code;
                    }
                }

                await client.query(`
                    INSERT INTO invoice_items (invoice_id, product_id, product_name, net_qty, pcs, boxes, rate, amount, hsn_code)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                `, [
                    invoiceId,
                    item.product_id || null,
                    item.product_name,
                    item.net_qty || '',
                    item.pcs || 0,
                    item.boxes,
                    item.rate,
                    item.amount,
                    hsnCode
                ]);

                // Deduct from inventory
                if (item.product_id) {
                    await client.query(`
                        UPDATE inventory SET
                            stock_boxes = GREATEST(0, stock_boxes - $2),
                            last_updated = CURRENT_TIMESTAMP
                        WHERE product_id = $1
                    `, [item.product_id, item.boxes]);

                    await client.query(`
                        INSERT INTO stock_transactions (product_id, type, boxes, reference)
                        VALUES ($1, 'OUT', $2, $3)
                    `, [item.product_id, -item.boxes, `Invoice ${invoice_no}`]);
                }
            }

            await client.query('COMMIT');

            const savedInv = await pool.query('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
            const savedItems = await pool.query('SELECT * FROM invoice_items WHERE invoice_id = $1', [invoiceId]);

            res.status(201).json({ ...savedInv.rows[0], items: savedItems.rows });
        } catch (err) {
            await client.query('ROLLBACK');
            console.error(err);
            if (err.message.includes('unique') || err.message.includes('UNIQUE')) {
                return res.status(409).json({ error: 'Invoice number already exists' });
            }
            res.status(500).json({ error: err.message });
        } finally {
            client.release();
        }
    });

    // GET /api/invoices — List all invoices (with pagination)
    router.get('/', async (req, res) => {
        try {
            const { page, limit, from, to, search } = req.query;
            const pageNum = parseInt(page) || 1;
            const pageSize = parseInt(limit) || 25;
            const offset = (pageNum - 1) * pageSize;

            let query = 'SELECT * FROM invoices WHERE 1=1';
            let countQuery = 'SELECT COUNT(*) as total FROM invoices WHERE 1=1';
            const params = [];

            if (from) {
                params.push(from);
                const pLen = params.length;
                query += ` AND date >= $${pLen}`;
                countQuery += ` AND date >= $${pLen}`;
            }
            if (to) {
                params.push(to);
                const pLen = params.length;
                query += ` AND date <= $${pLen}`;
                countQuery += ` AND date <= $${pLen}`;
            }
            if (search) {
                params.push(`%${search}%`);
                const pLen = params.length;
                query += ` AND (customer_name ILIKE $${pLen} OR invoice_no ILIKE $${pLen})`;
                countQuery += ` AND (customer_name ILIKE $${pLen} OR invoice_no ILIKE $${pLen})`;
            }

            const { rows: countRows } = await pool.query(countQuery, params);
            const total = parseInt(countRows[0].total);

            // Add pagination to specific query array params
            params.push(pageSize);
            query += ` ORDER BY id DESC LIMIT $${params.length}`;
            params.push(offset);
            query += ` OFFSET $${params.length}`;

            const { rows: invoices } = await pool.query(query, params);

            res.json({
                invoices,
                pagination: {
                    page: pageNum,
                    limit: pageSize,
                    total,
                    pages: Math.ceil(total / pageSize)
                }
            });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    });

    // GET /api/invoices/:id — Get full invoice with items
    router.get('/:id', async (req, res) => {
        try {
            const { rows: invRows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
            if (invRows.length === 0) return res.status(404).json({ error: 'Invoice not found' });

            const { rows: items } = await pool.query('SELECT * FROM invoice_items WHERE invoice_id = $1', [req.params.id]);
            res.json({ ...invRows[0], items });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    });

    // DELETE /api/invoices/:id — Delete invoice and restore stock
    router.delete('/:id', async (req, res) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const invId = req.params.id;
            
            // Get invoice info before deleting
            const invRes = await client.query('SELECT invoice_no FROM invoices WHERE id = $1', [invId]);
            if (invRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Invoice not found' });
            }
            
            const invoiceNo = invRes.rows[0].invoice_no;

            // Get all items to restore their stock
            const itemsRes = await client.query('SELECT product_id, boxes FROM invoice_items WHERE invoice_id = $1', [invId]);
            
            for (const item of itemsRes.rows) {
                if (item.product_id) {
                    // Restore stock
                    await client.query(`
                        UPDATE inventory SET
                            stock_boxes = stock_boxes + $2,
                            last_updated = CURRENT_TIMESTAMP
                        WHERE product_id = $1
                    `, [item.product_id, item.boxes]);

                    // Log the restoration
                    await client.query(`
                        INSERT INTO stock_transactions (product_id, type, boxes, reference)
                        VALUES ($1, 'ADJUST', $2, $3)
                    `, [item.product_id, item.boxes, `Reverted: Invoice ${invoiceNo}`]);
                }
            }

            // Delete the invoice (invoice_items handle CASCADE internally via schema)
            await client.query('DELETE FROM invoices WHERE id = $1', [invId]);

            await client.query('COMMIT');
            res.json({ message: 'Invoice deleted and stock restored successfully' });
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
