const serverless = require('serverless-http');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { initDB, pool } = require('../db/init_pg');
const { authenticateToken, loginRoute } = require('../auth_middleware');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize database
initDB().catch(console.error);

// Public Auth Route
app.post('/api/auth/login', loginRoute);

// API Routes (Mounted on serverless path for Netlify compatibility)
const apiRouter = express.Router();
apiRouter.use('/products', require('../routes/products')(pool));
apiRouter.use('/inventory', require('../routes/inventory')(pool));
apiRouter.use('/invoices', require('../routes/invoices')(pool));
apiRouter.use('/sales', require('../routes/sales')(pool));
apiRouter.use('/purchases', require('../routes/purchases')(pool));

// Netlify rewrite maps /api/* to /.netlify/functions/api/*
app.use('/.netlify/functions/api', authenticateToken, apiRouter);
// Fallback local support
app.use('/api', authenticateToken, apiRouter);

// The Netlify function handler with Binary support for Excel exports
module.exports.handler = serverless(app, {
    binary: [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/octet-stream'
    ]
});
