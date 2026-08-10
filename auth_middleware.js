const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_local_dev';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password123';

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    try {
        const verified = jwt.verify(token, JWT_SECRET);
        req.user = verified;
        next();
    } catch (err) {
        res.status(403).json({ error: 'Invalid token.' });
    }
}

function loginRoute(req, res) {
    const { password } = req.body;
    
    // In a real app we'd hash this, but we're relying on HTTPS + a strong ENV var
    if (password === ADMIN_PASSWORD) {
        // Token valid for 30 days
        const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '30d' });
        res.json({ token });
    } else {
        res.status(401).json({ error: 'Incorrect password.' });
    }
}

module.exports = { authenticateToken, loginRoute };
