const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function isAuthenticated(req, res, next) {
    if (req.session.userId) return next();
    req.session.flash = { message: 'Please log in to access this page.' };
    return res.redirect('/auth/login?next=' + encodeURIComponent(req.originalUrl));
}

function isAdmin(req, res, next) {
    if (!req.session.userId) {
        return res.redirect('/admin/login');
    }
    // currentUser is set by global middleware
    if (res.locals.currentUser && res.locals.currentUser.role === 'admin') {
        return next();
    }
    return res.status(403).send('Forbidden');
}

module.exports = { isAuthenticated, isAdmin };
