const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto'); // Built-in Node.js crypto module
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Helper to verify password (supports bcrypt and werkzeug pbkdf2)
function verifyPassword(inputPassword, storedHash) {
    if (!storedHash) return false;

    // 1. Check if it's a bcrypt hash (starts with $2a$ or $2b$)
    if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$')) {
        return bcrypt.compareSync(inputPassword, storedHash);
    }

    // 2. Check if it's a Werkzeug pbkdf2 hash (pbkdf2:method:itertions$salt$hash)
    if (storedHash.startsWith('pbkdf2:')) {
        try {
            // Format: pbkdf2:sha256:1000000$salt$hash
            const parts = storedHash.split('$');
            if (parts.length !== 3) return false;

            const header = parts[0]; // pbkdf2:sha256:1000000
            const salt = parts[1];
            const originalHash = parts[2];

            const headerParts = header.split(':');
            const method = headerParts[1]; // sha256
            const iterations = parseInt(headerParts[2], 10);

            if (method !== 'sha256') {
                console.warn(`Unsupported pbkdf2 method: ${method}`);
                return false;
            }

            // Node crypto pbkdf2
            // pbkdf2Sync(password, salt, iterations, keylen, digest)
            // Werkzeug uses 32 bytes for sha256? No, it produces hex. 
            // SHA256 produces 32 bytes (64 hex chars).

            const derivedKey = crypto.pbkdf2Sync(inputPassword, salt, iterations, 32, 'sha256');
            const derivedHex = derivedKey.toString('hex');

            return derivedHex === originalHash;
        } catch (e) {
            console.error('Error verifying pbkdf2 hash:', e);
            return false;
        }
    }

    return false;
}

// GET /auth/login
router.get('/login', (req, res) => {
    if (res.locals.currentUser) return res.redirect('/');
    res.render('auth/login', { title: 'Login' });
});

// POST /auth/login
router.post('/login', async (req, res) => {
    if (res.locals.currentUser) return res.redirect('/');
    const { email, password } = req.body;

    try {
        const user = await prisma.user.findUnique({ where: { email } });

        if (user && verifyPassword(password, user.passwordHash)) {
            // Re-hash to bcrypt if it was legacy (seamless migration)
            if (user.passwordHash.startsWith('pbkdf2:')) {
                const newHash = bcrypt.hashSync(password, 10);
                await prisma.user.update({
                    where: { id: user.id },
                    data: { passwordHash: newHash }
                });
                console.log(`Migrated password for user ${user.email} to bcrypt`);
            }

            req.session.userId = user.id;
            const next = req.query.next || (user.role === 'admin' ? '/admin' : '/');
            return res.redirect(next);
        }

        req.flash('error', 'Invalid email or password');
        res.render('auth/login', { title: 'Login' });
    } catch (e) {
        console.error('Login error:', e);
        req.flash('error', 'Login system error');
        res.render('auth/login', { title: 'Login' });
    }
});

// GET /auth/register
router.get('/register', (req, res) => {
    if (res.locals.currentUser) return res.redirect('/');
    res.render('auth/register', { title: 'Register' });
});

// POST /auth/register
router.post('/register', async (req, res) => {
    if (res.locals.currentUser) return res.redirect('/');
    const { email, password, name } = req.body;

    try {
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
            req.flash('error', 'Email already registered');
            return res.render('auth/register', { title: 'Register' });
        }

        const hash = bcrypt.hashSync(password, 10);
        const user = await prisma.user.create({
            data: { email, passwordHash: hash, name, role: 'customer' }
        });

        req.session.userId = user.id;
        req.flash('success', 'Registration successful!');
        res.redirect('/');
    } catch (e) {
        console.error('Register error:', e);
        req.flash('error', 'Registration failed');
        res.render('auth/register', { title: 'Register' });
    }
});

// GET /auth/logout
router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

module.exports = router;
