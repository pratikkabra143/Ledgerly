const express = require('express');

module.exports = function(pool) {
    const router = express.Router();

    // POST /api/purchases — Add a new bulk purchase bill
    router.post('/', async (req, res) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { supplier_name, date, items, total_boxes, total_amount } = req.body;

            if (!supplier_name || !date || !items || items.length === 0) {
                return res.status(400).json({ error: 'Missing required purchase details' });
            }

            // Insert Purchase Record
            const purRes = await client.query(`
                INSERT INTO purchases (supplier_name, date, total_boxes, total_amount)
                VALUES ($1, $2, $3, $4)
                RETURNING id
            `, [
                supplier_name,
                date,
                total_boxes || 0,
                total_amount || 0
            ]);

            const purchaseId = purRes.rows[0].id;

            for (const item of items) {
                let hsnCode = '21050000';
                if (item.product_id) {
                    const pRes = await client.query('SELECT hsn_code FROM products WHERE id = $1', [item.product_id]);
                    if (pRes.rows.length > 0 && pRes.rows[0].hsn_code) {
                        hsnCode = pRes.rows[0].hsn_code;
                    }
                }

                await client.query(`
                    INSERT INTO purchase_items (purchase_id, product_id, product_name, boxes, purchase_rate, amount, hsn_code)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                `, [
                    purchaseId,
                    item.product_id || null,
                    item.product_name,
                    item.boxes,
                    item.purchase_rate,
                    item.amount,
                    hsnCode
                ]);

                if (item.product_id) {
                    await client.query(`
                        INSERT INTO inventory (product_id, stock_boxes, last_purchase_rate, last_updated)
                        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
                        ON CONFLICT (product_id) DO UPDATE SET
                            stock_boxes = inventory.stock_boxes + EXCLUDED.stock_boxes,
                            last_purchase_rate = EXCLUDED.last_purchase_rate,
                            last_updated = CURRENT_TIMESTAMP
                    `, [item.product_id, item.boxes, item.purchase_rate]);
                    
                    await client.query(`
                        UPDATE products SET purchase_rate = $1, updated_at = CURRENT_TIMESTAMP
                        WHERE id = $2
                    `, [item.purchase_rate, item.product_id]);

                    await client.query(`
                        INSERT INTO stock_transactions (product_id, type, boxes, purchase_rate, reference)
                        VALUES ($1, 'IN', $2, $3, $4)
                    `, [
                        item.product_id,
                        item.boxes,
                        item.purchase_rate,
                        `Purchase #${purchaseId} from ${supplier_name}`
                    ]);
                }
            }

            await client.query('COMMIT');

            const savedPur = await pool.query('SELECT * FROM purchases WHERE id = $1', [purchaseId]);
            const savedItems = await pool.query('SELECT * FROM purchase_items WHERE purchase_id = $1', [purchaseId]);

            res.status(201).json({ ...savedPur.rows[0], items: savedItems.rows });
        } catch (err) {
            await client.query('ROLLBACK');
            console.error(err);
            res.status(500).json({ error: err.message });
        } finally {
            client.release();
        }
    });

    // GET /api/purchases — List purchases (History)
    router.get('/', async (req, res) => {
        try {
            const { from, to } = req.query;
            let query = 'SELECT * FROM purchases WHERE 1=1';
            const params = [];

            if (from) {
                params.push(from);
                query += ` AND date >= $${params.length}`;
            }
            if (to) {
                params.push(to);
                query += ` AND date <= $${params.length}`;
            }

            query += ' ORDER BY date DESC, id DESC LIMIT 100';
            
            const { rows } = await pool.query(query, params);
            res.json(rows);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    });

    // GET /api/purchases/export — Export as Excel (.xlsx)
    router.get('/export', async (req, res) => {
        try {
            const { from, to } = req.query;

            let purQuery = `
                SELECT id, date, supplier_name, total_boxes, total_amount
                FROM purchases WHERE 1=1
            `;
            const params = [];
            if (from) {
                params.push(from);
                purQuery += ` AND date >= $${params.length}`;
            }
            if (to) {
                params.push(to);
                purQuery += ` AND date <= $${params.length}`;
            }
            purQuery += ' ORDER BY id DESC';

            const { rows: purchases } = await pool.query(purQuery, params);

            const ExcelJS = require('exceljs');
            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'Ledgerly Engine';
            workbook.created = new Date();
            
            const worksheet = workbook.addWorksheet('Purchase Register', {
                views: [{ state: 'frozen', ySplit: 1 }]
            });
            worksheet.columns = [
                { header: 'Date', key: 'date', width: 12 },
                { header: 'Particulars', key: 'supplier', width: 35 },
                { header: 'Vch Type', key: 'vch_type', width: 12 },
                { header: 'Vch No.', key: 'id', width: 15 },
                { header: 'HSN/SAC', key: 'hsn_code', width: 12 },
                { header: 'Name of Item', key: 'product', width: 40 },
                { header: 'Quantity', key: 'boxes', width: 12 },
                { header: 'Rate', key: 'rate', width: 14, style: { numFmt: '#,##0.00' } },
                { header: 'Taxable Value', key: 'taxable', width: 16, style: { numFmt: '#,##0.00' } },
                { header: 'CGST', key: 'cgst', width: 16, style: { numFmt: '#,##0.00' } },
                { header: 'SGST', key: 'sgst', width: 16, style: { numFmt: '#,##0.00' } },
                { header: 'Gross Total', key: 'amount', width: 18, style: { numFmt: '#,##0.00' } },
            ];

            worksheet.getRow(1).font = { bold: true };
            worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

            for (const p of purchases) {
                const { rows: items } = await pool.query(`
                    SELECT pi.product_name, pi.boxes, pi.purchase_rate, pi.amount, pi.hsn_code, pr.pcs_per_box as pcs
                    FROM purchase_items pi
                    LEFT JOIN products pr ON pi.product_id = pr.id
                    WHERE pi.purchase_id = $1
                    ORDER BY pi.id ASC
                `, [p.id]);

                for (const item of items) {
                    const totalAmt = parseFloat(item.amount);
                    // Extract 5% built-in GST for ITC Claiming (Total = Taxable * 1.05)
                    const taxableVal = totalAmt / 1.05;
                    const cgst = (totalAmt - taxableVal) / 2;
                    const sgst = (totalAmt - taxableVal) / 2;

                    worksheet.addRow({
                        date: p.date,
                        supplier: p.supplier_name,
                        vch_type: 'Purchase',
                        id: `PUR-${p.id}`,
                        hsn_code: item.hsn_code || '21050000',
                        product: item.product_name,
                        boxes: parseFloat(item.boxes),
                        rate: parseFloat(item.purchase_rate),
                        taxable: taxableVal,
                        cgst: cgst,
                        sgst: sgst,
                        amount: totalAmt
                    });
                }
            }

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="Purchases_ITC_Export_${new Date().toISOString().split('T')[0]}.xlsx"`);

            await workbook.xlsx.write(res);
            res.end();
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    });

    // GET /api/purchases/:id — Get details of a specific purchase with items
    router.get('/:id', async (req, res) => {
        try {
            const { rows: purRow } = await pool.query('SELECT * FROM purchases WHERE id = $1', [req.params.id]);
            if (purRow.length === 0) return res.status(404).json({ error: 'Purchase not found' });

            const { rows: items } = await pool.query('SELECT * FROM purchase_items WHERE purchase_id = $1', [req.params.id]);
            res.json({ ...purRow[0], items });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    });

    // DELETE /api/purchases/:id — Delete purchase bill and revert stock
    router.delete('/:id', async (req, res) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const purId = req.params.id;
            
            // Get purchase info before deleting
            const purRes = await client.query('SELECT supplier_name FROM purchases WHERE id = $1', [purId]);
            if (purRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Purchase not found' });
            }
            
            const supplierName = purRes.rows[0].supplier_name;

            // Get all items to revert their stock
            const itemsRes = await client.query('SELECT product_id, boxes FROM purchase_items WHERE purchase_id = $1', [purId]);
            
            for (const item of itemsRes.rows) {
                if (item.product_id) {
                    // Revert stock (subtract)
                    await client.query(`
                        UPDATE inventory SET
                            stock_boxes = GREATEST(0, stock_boxes - $2),
                            last_updated = CURRENT_TIMESTAMP
                        WHERE product_id = $1
                    `, [item.product_id, item.boxes]);

                    // Log the reversion
                    await client.query(`
                        INSERT INTO stock_transactions (product_id, type, boxes, reference)
                        VALUES ($1, 'ADJUST', $2, $3)
                    `, [item.product_id, -item.boxes, `Reverted: Purchase #${purId} from ${supplierName}`]);
                }
            }

            // Delete the purchase (purchase_items handle CASCADE internally via schema)
            await client.query('DELETE FROM purchases WHERE id = $1', [purId]);

            await client.query('COMMIT');
            res.json({ message: 'Purchase deleted and stock reverted successfully' });
        } catch (err) {
            await client.query('ROLLBACK');
            console.error(err);
            res.status(500).json({ error: err.message });
        } finally {
            client.release();
        }
    });

    // GET /api/purchases/export/gstr2 — Official GST Portal JSON for Inward Supplies (GSTR-2B Recon format)
    router.get('/export/gstr2', async (req, res) => {
        try {
            const { from, to } = req.query;

            let purQuery = `
                SELECT id, date, supplier_name, total_boxes, total_amount
                FROM purchases WHERE 1=1
            `;
            const params = [];
            if (from) {
                params.push(from);
                purQuery += ` AND date >= $${params.length}`;
            }
            if (to) {
                params.push(to);
                purQuery += ` AND date <= $${params.length}`;
            }
            purQuery += ' ORDER BY id ASC';

            const { rows: purchases } = await pool.query(purQuery, params);

            const gstr2 = {
                gstin: "YOUR_GSTIN_HERE", 
                fp: "032026", 
                b2b: [],
                hsn: { data: [] }
            };

            const hsnMap = {};

            for (const p of purchases) {
                const { rows: items } = await pool.query(`
                    SELECT product_name, hsn_code, boxes, purchase_rate, amount 
                    FROM purchase_items 
                    WHERE purchase_id = $1
                `, [p.id]);

                const formattedDate = p.date.replace(/\//g, '-');

                const invItemsPayload = items.map((itm, index) => {
                    const totalAmt = parseFloat(itm.amount);
                    const taxableVal = totalAmt / 1.05;
                    const cgst = (totalAmt - taxableVal) / 2;
                    const sgst = (totalAmt - taxableVal) / 2;

                    // Auto-Aggregate HSN Codes
                    const hsn = itm.hsn_code || '21050000';
                    if (!hsnMap[hsn]) {
                        hsnMap[hsn] = { qty: 0, txval: 0, camt: 0, samt: 0, val: 0, desc: itm.product_name };
                    }
                    hsnMap[hsn].qty += parseFloat(itm.boxes);
                    hsnMap[hsn].txval += taxableVal;
                    hsnMap[hsn].camt += cgst;
                    hsnMap[hsn].samt += sgst;
                    hsnMap[hsn].val += totalAmt;

                    return {
                        num: index + 1,
                        itm_det: {
                            txval: parseFloat(taxableVal.toFixed(2)),
                            rt: 5.0,
                            camt: parseFloat(cgst.toFixed(2)),
                            samt: parseFloat(sgst.toFixed(2))
                        }
                    };
                });

                // Assume all distribution supplier purchases are B2B
                gstr2.b2b.push({
                    ctin: "SUPPLIER_GSTIN", // Placeholder
                    inv: [{
                        inum: `PUR-${p.id}`,
                        idt: formattedDate,
                        val: parseFloat(p.total_amount),
                        pos: "23", 
                        rchrg: "N",
                        inv_typ: "R",
                        itms: invItemsPayload
                    }]
                });
            }

            let hsnCounter = 1;
            for (const [code, data] of Object.entries(hsnMap)) {
                gstr2.hsn.data.push({
                    num: hsnCounter++,
                    hsn_sc: code,
                    desc: data.desc,
                    uqc: "BOX",
                    qty: parseFloat(data.qty.toFixed(2)),
                    val: parseFloat(data.val.toFixed(2)),
                    txval: parseFloat(data.txval.toFixed(2)),
                    camt: parseFloat(data.camt.toFixed(2)),
                    samt: parseFloat(data.samt.toFixed(2))
                });
            }

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="GSTR2_Export_${new Date().toISOString().split('T')[0]}.json"`);
            res.send(JSON.stringify(gstr2, null, 2));

        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
