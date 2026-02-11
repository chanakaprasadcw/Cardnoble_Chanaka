const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { isAuthenticated } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const prisma = new PrismaClient();

// GET /api/products
router.get('/products', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const perPage = parseInt(req.query.per_page) || 24;
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
        include: { stocks: true },
        skip: (page - 1) * perPage,
        take: perPage,
    });

    res.json({
        products: products.map(p => ({
            id: p.id,
            name: p.name,
            slug: p.slug,
            set_name: p.setName,
            image_url: p.imageUrl,
            min_price: p.stocks.filter(s => s.quantity > 0).reduce((min, s) => Math.min(min, s.price), Infinity) || 0,
            total_quantity: p.stocks.reduce((sum, s) => sum + s.quantity, 0),
        })),
        total,
        pages: Math.ceil(total / perPage),
        current_page: page,
    });
});

// GET /api/products/:id
router.get('/products/:id', async (req, res) => {
    const product = await prisma.product.findUnique({
        where: { id: parseInt(req.params.id) },
        include: { stocks: true }
    });
    if (!product) return res.status(404).json({ error: 'Not found' });
    res.json({
        id: product.id,
        name: product.name,
        slug: product.slug,
        set_code: product.setCode,
        set_name: product.setName,
        image_url: product.imageUrl,
        rarity: product.rarity,
        card_type: product.cardType,
        stocks: product.stocks.map(s => ({
            id: s.id, condition: s.condition, quantity: s.quantity, price: s.price
        })),
    });
});

// GET /api/cart
router.get('/cart', isAuthenticated, async (req, res) => {
    const items = await prisma.cartItem.findMany({
        where: { userId: req.session.userId },
        include: { product: true, stock: true }
    });
    res.json({
        items: items.map(item => ({
            id: item.id,
            product_id: item.productId,
            product_name: item.product.name,
            product_image: item.product.imageUrl,
            condition: item.stock.condition,
            quantity: item.quantity,
            price: item.stock.price,
            subtotal: item.stock.price * item.quantity,
        })),
        total: items.reduce((s, i) => s + i.stock.price * i.quantity, 0),
        count: items.length,
    });
});

// POST /api/cart — add to cart
router.post('/cart', isAuthenticated, async (req, res) => {
    const { product_id, stock_id, quantity = 1 } = req.body;
    const stock = await prisma.stock.findUnique({ where: { id: stock_id } });
    if (!stock) return res.status(404).json({ error: 'Stock not found' });
    if (stock.quantity < quantity) return res.status(400).json({ error: 'Not enough stock' });

    const existing = await prisma.cartItem.findFirst({
        where: { userId: req.session.userId, productId: product_id, stockId: stock_id }
    });

    if (existing) {
        await prisma.cartItem.update({ where: { id: existing.id }, data: { quantity: existing.quantity + quantity } });
    } else {
        await prisma.cartItem.create({
            data: { userId: req.session.userId, productId: product_id, stockId: stock_id, quantity }
        });
    }

    const cartCount = await prisma.cartItem.count({ where: { userId: req.session.userId } });
    res.json({ success: true, message: 'Added to cart', cart_count: cartCount });
});

// POST /api/cart/add — alias
router.post('/cart/add', isAuthenticated, async (req, res) => {
    // Same as POST /api/cart, redirect
    const { product_id, stock_id, quantity = 1 } = req.body;
    const stock = await prisma.stock.findUnique({ where: { id: stock_id } });
    if (!stock) return res.status(404).json({ error: 'Stock not found' });
    if (stock.quantity < quantity) return res.status(400).json({ error: 'Not enough stock' });

    const existing = await prisma.cartItem.findFirst({
        where: { userId: req.session.userId, productId: product_id, stockId: stock_id }
    });
    if (existing) {
        await prisma.cartItem.update({ where: { id: existing.id }, data: { quantity: existing.quantity + quantity } });
    } else {
        await prisma.cartItem.create({
            data: { userId: req.session.userId, productId: product_id, stockId: stock_id, quantity }
        });
    }
    const cartCount = await prisma.cartItem.count({ where: { userId: req.session.userId } });
    res.json({ success: true, message: 'Added to cart', cart_count: cartCount });
});

// PUT /api/cart/:id
router.put('/cart/:id', isAuthenticated, async (req, res) => {
    const item = await prisma.cartItem.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!item || item.userId !== req.session.userId) return res.status(403).json({ error: 'Unauthorized' });

    const { quantity } = req.body;
    if (quantity <= 0) {
        await prisma.cartItem.delete({ where: { id: item.id } });
    } else {
        await prisma.cartItem.update({ where: { id: item.id }, data: { quantity } });
    }
    res.json({ success: true });
});

// DELETE /api/cart/:id
router.delete('/cart/:id', isAuthenticated, async (req, res) => {
    const item = await prisma.cartItem.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!item || item.userId !== req.session.userId) return res.status(403).json({ error: 'Unauthorized' });
    await prisma.cartItem.delete({ where: { id: item.id } });
    res.json({ success: true });
});

// POST /api/checkout
router.post('/checkout', isAuthenticated, async (req, res) => {
    const cartItems = await prisma.cartItem.findMany({
        where: { userId: req.session.userId },
        include: { stock: true }
    });
    if (cartItems.length === 0) return res.status(400).json({ error: 'Cart is empty' });

    const total = cartItems.reduce((s, i) => s + i.stock.price * i.quantity, 0);
    const code = 'ORD-' + uuidv4().replace(/-/g, '').substring(0, 8).toUpperCase();

    const order = await prisma.order.create({
        data: {
            code,
            userId: req.session.userId,
            total,
            shippingName: req.body.shipping_name,
            shippingAddress: req.body.shipping_address,
            paymentMethod: req.body.payment_method || 'cod',
            items: {
                create: cartItems.map(item => ({
                    productId: item.productId,
                    quantity: item.quantity,
                    price: item.stock.price,
                }))
            }
        }
    });

    // Update stock and clear cart
    for (const item of cartItems) {
        await prisma.stock.update({
            where: { id: item.stockId },
            data: { quantity: item.stock.quantity - item.quantity }
        });
        await prisma.cartItem.delete({ where: { id: item.id } });
    }

    res.json({ success: true, order_code: order.code, total });
});

module.exports = router;
