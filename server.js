require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const morgan = require('morgan');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 5001;

// ── View engine ──────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Middleware ────────────────────────────────────────
app.use(morgan('short'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, 'instance') }),
  secret: process.env.SECRET_KEY || 'dev-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));

// Flash messages helper
app.use((req, res, next) => {
  res.locals.flash = req.session.flash || {};
  req.session.flash = {};
  req.flash = (type, msg) => {
    if (!req.session.flash) req.session.flash = {};
    req.session.flash[type] = msg;
  };
  next();
});

// Global template variables
app.use(async (req, res, next) => {
  // Path for active link highlighting (always available)
  res.locals.path = req.path;

  try {
    // Current user
    if (req.session.userId) {
      res.locals.currentUser = await prisma.user.findUnique({ where: { id: req.session.userId } });
    } else {
      res.locals.currentUser = null;
    }

    // Categories (for nav)
    res.locals.categories = await prisma.category.findMany();

    // Cart count
    res.locals.cartCount = 0;
    if (res.locals.currentUser) {
      res.locals.cartCount = await prisma.cartItem.count({ where: { userId: res.locals.currentUser.id } });
    }
  } catch (err) {
    console.error('Global middleware error:', err);
  }
  next();
});

// ── Routes ───────────────────────────────────────────
const mainRoutes = require('./routes/main');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');
const binderRoutes = require('./routes/binder');

app.use('/', mainRoutes);
app.use('/auth', authRoutes);
app.use('/api', apiRoutes);
app.use('/admin', adminRoutes);
app.use('/', binderRoutes);

// ── 404 handler ──────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('404', { title: 'Not Found' });
});

// ── Start server ─────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🃏 CardNoble running at http://127.0.0.1:${PORT}`);
});

module.exports = app;
