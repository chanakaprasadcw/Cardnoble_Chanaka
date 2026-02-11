const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// GET / — Home page
router.get('/', async (req, res) => {
    const banners = await prisma.banner.findMany({
        where: { isActive: true },
        orderBy: { ordering: 'asc' }
    });
    const products = await prisma.product.findMany({
        take: 32,
        include: { category: true, stocks: true }
    });
    res.render('storefront/index', {
        title: 'CardNoble',
        banners,
        products,
    });
});

// GET /products — Product listing
router.get('/products', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const perPage = 24;
    const category = req.query.category;
    const search = req.query.q;

    const where = {};
    if (category) {
        const cat = await prisma.category.findUnique({ where: { slug: category } });
        if (cat) where.categoryId = cat.id;
    }
    if (search) {
        where.name = { contains: search };
    }

    const total = await prisma.product.count({ where });
    const products = await prisma.product.findMany({
        where,
        include: { category: true, stocks: true },
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { name: 'asc' }
    });

    const totalPages = Math.ceil(total / perPage);
    res.render('storefront/products', {
        title: 'Products',
        products: {
            items: products,
            total,
            pages: totalPages,
            page,
            hasPrev: page > 1,
            hasNext: page < totalPages,
        },
        query: search || ''
    });
});

// GET /products/:slug — Product detail
router.get('/products/:slug', async (req, res) => {
    const product = await prisma.product.findUnique({
        where: { slug: req.params.slug },
        include: { category: true, stocks: true }
    });
    if (!product) return res.status(404).render('404', { title: 'Not Found' });
    res.render('storefront/product_detail', { title: product.name, product });
});

// GET /sets — Browse by set
router.get('/sets', async (req, res) => {
    const sets = await prisma.product.groupBy({
        by: ['setCode', 'setName'],
        _count: { id: true },
        orderBy: { setName: 'asc' }
    });
    const setsData = sets.map(s => ({
        set_code: s.setCode,
        set_name: s.setName,
        product_count: s._count.id,
    }));
    res.render('storefront/sets', { title: 'Browse Sets', sets: setsData });
});

// GET /support — Support page
router.get('/support', (req, res) => {
    res.render('storefront/support', { title: 'Support' });
});

// GET /cart — Cart page
router.get('/cart', async (req, res) => {
    if (!res.locals.currentUser) {
        return res.render('storefront/cart', { title: 'Cart', items: [], total: 0 });
    }
    const items = await prisma.cartItem.findMany({
        where: { userId: res.locals.currentUser.id },
        include: { product: true, stock: true }
    });
    const total = items.reduce((sum, item) => sum + item.stock.price * item.quantity, 0);
    res.render('storefront/cart', { title: 'Cart', items, total });
});

// GET /checkout — Checkout page
router.get('/checkout', async (req, res) => {
    if (!res.locals.currentUser) {
        return res.render('auth/login', { title: 'Login' });
    }
    const items = await prisma.cartItem.findMany({
        where: { userId: res.locals.currentUser.id },
        include: { product: true, stock: true }
    });
    const total = items.reduce((sum, item) => sum + item.stock.price * item.quantity, 0);
    res.render('storefront/checkout', { title: 'Checkout', items, total });
});

module.exports = router;
