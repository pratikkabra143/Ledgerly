const express = require('express');

module.exports = function(pool) {
    const router = express.Router();

    // GET /api/sales/report — Sales report with date filters
    router.get('/report', async (req, res) => {
        try {
            const { from, to, group_by } = req.query;

            // Overall summary
            let summaryQuery = `
                SELECT
                    COUNT(*) as total_invoices,
                    COALESCE(SUM(total), 0) as total_revenue,
                    COALESCE(SUM(subtotal), 0) as total_subtotal,
                    COALESCE(SUM(cgst + sgst), 0) as total_gst,
                    COALESCE(AVG(total), 0) as avg_invoice_value
                FROM invoices WHERE 1=1
            `;
            const summaryParams = [];

            if (from) {
                summaryParams.push(from);
                summaryQuery += ` AND date >= $${summaryParams.length}`;
            }
            if (to) {
                summaryParams.push(to);
                summaryQuery += ` AND date <= $${summaryParams.length}`;
            }

            const { rows: summaryRows } = await pool.query(summaryQuery, summaryParams);
            const summary = summaryRows[0];
            
            // Format numbers
            summary.total_invoices = parseInt(summary.total_invoices);
            summary.total_revenue = parseFloat(summary.total_revenue);
            summary.total_subtotal = parseFloat(summary.total_subtotal);
            summary.total_gst = parseFloat(summary.total_gst);
            summary.avg_invoice_value = parseFloat(summary.avg_invoice_value);

            // Top selling products
            let topProductsQuery = `
                SELECT
                    ii.product_name,
                    SUM(ii.boxes) as total_boxes_sold,
                    SUM(ii.amount) as total_amount,
                    COUNT(DISTINCT ii.invoice_id) as invoice_count
                FROM invoice_items ii
                JOIN invoices inv ON ii.invoice_id = inv.id
                WHERE 1=1
            `;
            const topParams = [];
            if (from) {
                topParams.push(from);
                topProductsQuery += ` AND inv.date >= $${topParams.length}`;
            }
            if (to) {
                topParams.push(to);
                topProductsQuery += ` AND inv.date <= $${topParams.length}`;
            }
            topProductsQuery += ' GROUP BY ii.product_name ORDER BY total_boxes_sold DESC LIMIT 20';

            const { rows: topProducts } = await pool.query(topProductsQuery, topParams);
            topProducts.forEach(p => {
                p.total_boxes_sold = parseFloat(p.total_boxes_sold);
                p.total_amount = parseFloat(p.total_amount);
                p.invoice_count = parseInt(p.invoice_count);
            });

            // Daily sales breakdown
            let dailyQuery = `
                SELECT
                    date,
                    COUNT(*) as invoices,
                    SUM(total) as revenue
                FROM invoices WHERE 1=1
            `;
            const dailyParams = [];
            if (from) {
                dailyParams.push(from);
                dailyQuery += ` AND date >= $${dailyParams.length}`;
            }
            if (to) {
                dailyParams.push(to);
                dailyQuery += ` AND date <= $${dailyParams.length}`;
            }
            dailyQuery += ' GROUP BY date ORDER BY date DESC LIMIT 30';

            const { rows: dailySales } = await pool.query(dailyQuery, dailyParams);
            dailySales.forEach(d => {
                d.invoices = parseInt(d.invoices);
                d.revenue = parseFloat(d.revenue);
            });

            res.json({ summary, topProducts, dailySales });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    });

    // GET /api/sales/export — Export sales as Excel (.xlsx)
    router.get('/export', async (req, res) => {
        try {
            const { from, to } = req.query;

            // Query invoices and items joined for Itemized GSTR-1 format
            let invQuery = `
                SELECT 
                    inv.invoice_no, 
                    inv.date, 
                    inv.customer_name, 
                    inv.customer_gstin,
                    ii.product_name, 
                    ii.hsn_code,
                    ii.boxes, 
                    ii.rate, 
                    ii.amount
                FROM invoices inv
                JOIN invoice_items ii ON inv.id = ii.invoice_id
                WHERE 1=1
            `;
            const params = [];
            if (from) {
                params.push(from);
                invQuery += ` AND inv.date >= $${params.length}`;
            }
            if (to) {
                params.push(to);
                invQuery += ` AND inv.date <= $${params.length}`;
            }
            invQuery += ' ORDER BY inv.id DESC, ii.id ASC';

            const { rows: items } = await pool.query(invQuery, params);

            // Create Excel workbook
            const ExcelJS = require('exceljs');
            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'Ledgerly Engine';
            workbook.created = new Date();
            
            const sheet = workbook.addWorksheet('Sales Register', {
                views: [{ state: 'frozen', ySplit: 1 }]
            });

            sheet.columns = [
                { header: 'Date', key: 'date', width: 12 },
                { header: 'Particulars', key: 'customer_name', width: 35 },
                { header: 'Vch Type', key: 'vch_type', width: 12 },
                { header: 'Vch No.', key: 'invoice_no', width: 15 },
                { header: 'GSTIN/UIN', key: 'customer_gstin', width: 20 },
                { header: 'HSN/SAC', key: 'hsn_code', width: 12 },
                { header: 'Name of Item', key: 'item_name', width: 40 },
                { header: 'Quantity', key: 'boxes', width: 12 },
                { header: 'Rate', key: 'rate', width: 12 },
                { header: 'Taxable Value', key: 'taxable', width: 16, style: { numFmt: '#,##0.00' } },
                { header: 'CGST', key: 'cgst', width: 16, style: { numFmt: '#,##0.00' } },
                { header: 'SGST', key: 'sgst', width: 16, style: { numFmt: '#,##0.00' } },
                { header: 'Gross Total', key: 'total', width: 18, style: { numFmt: '#,##0.00' } }
            ];

            sheet.getRow(1).font = { bold: true };
            sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

            for (const row of items) {
                const taxable = parseFloat(row.amount);
                const cgst = taxable * 0.025;
                const sgst = taxable * 0.025;
                const total = taxable + cgst + sgst;

                sheet.addRow({
                    date: row.date,
                    customer_name: row.customer_name,
                    vch_type: 'Sales',
                    invoice_no: row.invoice_no,
                    customer_gstin: row.customer_gstin || '',
                    hsn_code: row.hsn_code || '21050000',
                    item_name: row.product_name,
                    boxes: parseFloat(row.boxes),
                    rate: parseFloat(row.rate),
                    taxable: taxable,
                    cgst: cgst,
                    sgst: sgst,
                    total: total
                });
            }

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="Sales_Report_${new Date().toISOString().split('T')[0]}.xlsx"`);
            
            await workbook.xlsx.write(res);
            res.end();
            
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    });

    // GET /api/sales/export/gstr1 — Official GST Portal JSON
    router.get('/export/gstr1', async (req, res) => {
        try {
            const { from, to } = req.query;

            let invQuery = `
                SELECT 
                    inv.id, inv.invoice_no, inv.date, inv.customer_name, inv.customer_gstin,
                    inv.subtotal, inv.cgst, inv.sgst, inv.total
                FROM invoices inv
                WHERE 1=1
            `;
            const params = [];
            if (from) {
                params.push(from);
                invQuery += ` AND inv.date >= $${params.length}`;
            }
            if (to) {
                params.push(to);
                invQuery += ` AND inv.date <= $${params.length}`;
            }
            invQuery += ' ORDER BY inv.id ASC';

            const { rows: invoices } = await pool.query(invQuery, params);

            // GSTR-1 Master Payload Structure
            const gstr1 = {
                gstin: "YOUR_GSTIN_HERE", 
                fp: "032026", 
                gt: 0,
                cur_gt: 0,
                b2b: [],
                b2cs: [],
                hsn: { data: [] }
            };

            const hsnMap = {};

            for (const inv of invoices) {
                const { rows: items } = await pool.query(`
                    SELECT product_name, hsn_code, boxes, rate, amount 
                    FROM invoice_items 
                    WHERE invoice_id = $1
                `, [inv.id]);

                const formattedDate = inv.date.replace(/\//g, '-');

                const invItemsPayload = items.map((itm, index) => {
                    const taxable = parseFloat(itm.amount);
                    const cgst = taxable * 0.025;
                    const sgst = taxable * 0.025;

                    // Auto-Aggregate HSN Codes
                    const hsn = itm.hsn_code || '21050000';
                    if (!hsnMap[hsn]) {
                        hsnMap[hsn] = { qty: 0, txval: 0, camt: 0, samt: 0, val: 0, desc: itm.product_name };
                    }
                    hsnMap[hsn].qty += parseFloat(itm.boxes);
                    hsnMap[hsn].txval += taxable;
                    hsnMap[hsn].camt += cgst;
                    hsnMap[hsn].samt += sgst;
                    hsnMap[hsn].val += (taxable + cgst + sgst);

                    return {
                        num: index + 1,
                        itm_det: {
                            txval: parseFloat(taxable.toFixed(2)),
                            rt: 5.0,
                            camt: parseFloat(cgst.toFixed(2)),
                            samt: parseFloat(sgst.toFixed(2))
                        }
                    };
                });

                // B2B Validation (GSTIN exists and is roughly 15 chars)
                const isB2B = inv.customer_gstin && inv.customer_gstin.trim().length >= 10;

                if (isB2B) {
                    gstr1.b2b.push({
                        ctin: inv.customer_gstin.trim(),
                        inv: [{
                            inum: inv.invoice_no,
                            idt: formattedDate,
                            val: parseFloat(inv.total),
                            pos: "23", // Default to Madhya Pradesh state code
                            rchrg: "N",
                            inv_typ: "R",
                            itms: invItemsPayload
                        }]
                    });
                } else {
                    // B2C Small Inter-state consolidation
                    gstr1.b2cs.push({
                        sply_ty: "INTRA",
                        txval: parseFloat(inv.subtotal),
                        typ: "OE",
                        rt: 5.0,
                        pos: "23",
                        camt: parseFloat(inv.cgst),
                        samt: parseFloat(inv.sgst)
                    });
                }
            }

            // Collapse HSN Dictionary into Array
            let hsnCounter = 1;
            for (const [code, data] of Object.entries(hsnMap)) {
                gstr1.hsn.data.push({
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
            res.setHeader('Content-Disposition', `attachment; filename="GSTR1_Export_${new Date().toISOString().split('T')[0]}.json"`);
            res.send(JSON.stringify(gstr1, null, 2));

        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
