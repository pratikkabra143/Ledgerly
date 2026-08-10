const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const { initDB, pool } = require('./db/init_pg');
const { authenticateToken, loginRoute } = require('./auth_middleware');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize database asynchronously
initDB().then(() => {
    const dbType = process.env.DATABASE_URL && process.env.DATABASE_URL.trim() ? 'PostgreSQL' : 'SQLite (./data/ledgerly.db)';
    console.log(`  Database connected (${dbType}).`);
}).catch(err => {
    console.error('Failed to initialize Database:', err);
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Public Auth Route
app.post('/api/auth/login', loginRoute);

// API Routes (Protected)
app.use('/api/products', authenticateToken, require('./routes/products')(pool));
app.use('/api/inventory', authenticateToken, require('./routes/inventory')(pool));
app.use('/api/invoices', authenticateToken, require('./routes/invoices')(pool));
app.use('/api/sales', authenticateToken, require('./routes/sales')(pool));
app.use('/api/purchases', authenticateToken, require('./routes/purchases')(pool));

// SPA fallback — serve index.html for root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    const dbInfo = process.env.DATABASE_URL && process.env.DATABASE_URL.trim() ? 'Cloud PostgreSQL' : './data/ledgerly.db';
    console.log(`\n  ⚡ Ledgerly — GST Invoicing, Inventory & Compliance`);
    console.log(`  📄 Invoice:    http://localhost:${PORT}`);
    console.log(`  📦 Inventory:  http://localhost:${PORT}/inventory.html`);
    console.log(`  📊 Sales:      http://localhost:${PORT}/sales.html`);
    console.log(`  📖 Purchases:  http://localhost:${PORT}/purchases-registry.html`);
    console.log(`\n  Database: ${dbInfo}\n`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Closing Database pool...');
    await pool.end();
    process.exit(0);
});
