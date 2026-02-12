const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { isAdmin } = require('../middleware/auth');
const prisma = new PrismaClient();

// Admin login page
router.get('/login', (req, res) => {
    res.render('admin/login', { title: 'Admin Login', layout: false });
});

router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && user.role === 'admin' && bcrypt.compareSync(password, user.passwordHash)) {
        req.session.userId = user.id;
        return res.redirect('/admin');
    }
    req.flash('error', 'Invalid credentials');
    res.redirect('/admin/login');
});

// ── Dashboard ────────────────────────────────────────
router.get(['/', '/dashboard'], isAdmin, async (req, res) => {
    const [productCount, orderCount, userCount, revenue] = await Promise.all([
        prisma.product.count(),
        prisma.order.count(),
        prisma.user.count(),
        prisma.order.aggregate({ _sum: { total: true } }),
    ]);
    const recentOrders = await prisma.order.findMany({
        take: 5, orderBy: { createdAt: 'desc' }, include: { user: true }
    });
    const unreadMessages = await prisma.message.count({ where: { isRead: false } });
    const openTickets = await prisma.ticket.count({ where: { status: 'open' } });

    // Calculate inventory value
    const stocks = await prisma.stock.findMany();
    const totalInventoryValue = stocks.reduce((sum, stock) => sum + (stock.price * stock.quantity), 0);

    res.render('admin/dashboard', {
        title: 'Dashboard',
        totalStock: productCount,
        totalOrders: orderCount,
        totalCustomers: userCount,
        totalSales: revenue._sum.total || 0,
        totalInventoryValue,
        recentOrders,
        unreadMessages,
        openTickets,
    });
});

// ── Inventory ────────────────────────────────────────
router.get('/inventory', isAdmin, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const search = req.query.q || '';
    const category = req.query.category || '';
    const perPage = 20;

    const where = {};
    if (search) where.name = { contains: search };
    if (category) {
        const cat = await prisma.category.findUnique({ where: { slug: category } });
        if (cat) where.categoryId = cat.id;
    }

    const total = await prisma.product.count({ where });
    const products = await prisma.product.findMany({
        where, include: { category: true, stocks: true },
        skip: (page - 1) * perPage, take: perPage,
        orderBy: { createdAt: 'desc' }
    });

    res.render('admin/inventory', {
        title: 'Inventory',
        products,
        total,
        page,
        pages: Math.ceil(total / perPage),
        search,
        category,
    });
});

// ── Add Product ──────────────────────────────────────
router.get('/add-product', isAdmin, async (req, res) => {
    const categories = await prisma.category.findMany();
    res.render('admin/add_product', { title: 'Add Product', categories });
});

router.post('/add-product', isAdmin, async (req, res) => {
    const { name, set_code, set_name, category_id, image_url, rarity, card_type, language, condition, quantity, price } = req.body;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    // Ensure unique slug
    let finalSlug = slug;
    let counter = 1;
    while (await prisma.product.findUnique({ where: { slug: finalSlug } })) {
        finalSlug = `${slug}-${counter++}`;
    }

    const product = await prisma.product.create({
        data: {
            name,
            slug: finalSlug,
            setCode: set_code || null,
            setName: set_name || null,
            categoryId: category_id ? parseInt(category_id) : null,
            imageUrl: image_url || null,
            rarity: rarity || null,
            cardType: card_type || null,
            language: language || 'EN',
        }
    });

    if (price) {
        await prisma.stock.create({
            data: {
                productId: product.id,
                condition: condition || 'NM',
                quantity: parseInt(quantity) || 0,
                price: parseFloat(price),
            }
        });
    }

    req.flash('success', 'Product added successfully');
    res.redirect('/admin/inventory');
});

// ── Edit Product ─────────────────────────────────────
router.get('/edit-product/:id', isAdmin, async (req, res) => {
    const product = await prisma.product.findUnique({
        where: { id: parseInt(req.params.id) },
        include: { stocks: true }
    });
    if (!product) return res.redirect('/admin/inventory');
    const categories = await prisma.category.findMany();
    res.render('admin/edit_product', { title: 'Edit Product', product, categories });
});

router.post('/edit-product/:id', isAdmin, async (req, res) => {
    const { name, set_code, set_name, category_id, image_url, rarity, card_type, language } = req.body;
    await prisma.product.update({
        where: { id: parseInt(req.params.id) },
        data: {
            name,
            setCode: set_code || null,
            setName: set_name || null,
            categoryId: category_id ? parseInt(category_id) : null,
            imageUrl: image_url || null,
            rarity: rarity || null,
            cardType: card_type || null,
            language: language || 'EN',
        }
    });
    req.flash('success', 'Product updated');
    res.redirect('/admin/inventory');
});

// ── Orders ───────────────────────────────────────────
router.get('/orders', isAdmin, async (req, res) => {
    const status = req.query.status || '';
    const where = {};
    if (status) where.status = status;
    const orders = await prisma.order.findMany({
        where, orderBy: { createdAt: 'desc' },
        include: { user: true, items: { include: { product: true } } }
    });
    res.render('admin/orders', { title: 'Orders', orders, status });
});

router.get('/orders/:id', isAdmin, async (req, res) => {
    const order = await prisma.order.findUnique({
        where: { id: parseInt(req.params.id) },
        include: { user: true, items: { include: { product: true } } }
    });
    if (!order) return res.redirect('/admin/orders');
    res.render('admin/orders', { title: `Order ${order.code}`, orders: [order], status: '' });
});

router.post('/orders/:id/status', isAdmin, async (req, res) => {
    await prisma.order.update({
        where: { id: parseInt(req.params.id) },
        data: { status: req.body.status }
    });
    res.json({ success: true });
});

// ── Settings ─────────────────────────────────────────
router.get('/settings', isAdmin, (req, res) => res.render('admin/settings', { title: 'Settings' }));
router.get('/settings/domain', isAdmin, (req, res) => res.render('admin/settings_domain', { title: 'Domain Settings' }));
router.get('/settings/theme', isAdmin, (req, res) => res.render('admin/settings_theme', { title: 'Theme Settings' }));
router.get('/settings/order-status', isAdmin, (req, res) => res.render('admin/settings_order_status', { title: 'Order Status' }));

// ── Stock In/Out ─────────────────────────────────────
router.get('/stock-in', isAdmin, async (req, res) => {
    const orders = await prisma.stockOrder.findMany({
        where: { orderType: 'stock_in' },
        orderBy: { createdAt: 'desc' },
        include: { items: { include: { product: true } } }
    });
    res.render('admin/stock_in', { title: 'Stock In', orders });
});

router.get('/stock-out', isAdmin, async (req, res) => {
    const orders = await prisma.stockOrder.findMany({
        where: { orderType: 'stock_out' },
        orderBy: { createdAt: 'desc' },
        include: { items: { include: { product: true } } }
    });
    res.render('admin/stock_out', { title: 'Stock Out', orders });
});

router.get('/stock-orders/create', isAdmin, async (req, res) => {
    const products = await prisma.product.findMany({ orderBy: { name: 'asc' } });
    res.render('admin/create_stock_order', { title: 'Create Stock Order', products, type: req.query.type || 'stock_in' });
});

router.post('/stock-orders/create', isAdmin, async (req, res) => {
    const { type, reference, notes, items } = req.body;
    const parsedItems = typeof items === 'string' ? JSON.parse(items) : items;

    const order = await prisma.stockOrder.create({
        data: {
            orderType: type,
            reference: reference || null,
            notes: notes || null,
            status: 'completed',
            items: {
                create: (parsedItems || []).map(i => ({
                    productId: parseInt(i.product_id),
                    quantity: parseInt(i.quantity),
                    condition: i.condition || 'NM',
                    costPerItem: parseFloat(i.cost_per_item) || 0,
                    notes: i.notes || null,
                }))
            }
        }
    });

    // Update stock quantities
    for (const item of (parsedItems || [])) {
        const existing = await prisma.stock.findFirst({
            where: { productId: parseInt(item.product_id), condition: item.condition || 'NM' }
        });
        const qty = parseInt(item.quantity);
        if (existing) {
            await prisma.stock.update({
                where: { id: existing.id },
                data: { quantity: type === 'stock_in' ? existing.quantity + qty : Math.max(0, existing.quantity - qty) }
            });
        } else if (type === 'stock_in') {
            await prisma.stock.create({
                data: { productId: parseInt(item.product_id), condition: item.condition || 'NM', quantity: qty, price: parseFloat(item.cost_per_item) || 0 }
            });
        }
    }

    res.redirect(type === 'stock_in' ? '/admin/stock-in' : '/admin/stock-out');
});

router.get('/stock-orders/:id', isAdmin, async (req, res) => {
    const order = await prisma.stockOrder.findUnique({
        where: { id: parseInt(req.params.id) },
        include: { items: { include: { product: true } } }
    });
    if (!order) return res.redirect('/admin/stock-in');
    res.render('admin/view_stock_order', { title: `Stock Order #${order.id}`, order });
});

// ── Messages ─────────────────────────────────────────
router.get('/messages', isAdmin, async (req, res) => {
    const messages = await prisma.message.findMany({
        orderBy: { createdAt: 'desc' },
        include: { user: true }
    });
    res.render('admin/messages', { title: 'Messages', messages });
});

router.post('/messages/:id/read', isAdmin, async (req, res) => {
    await prisma.message.update({ where: { id: parseInt(req.params.id) }, data: { isRead: true } });
    res.json({ success: true });
});

router.post('/messages/reply', isAdmin, async (req, res) => {
    const { message_id } = req.body;
    await prisma.message.update({ where: { id: parseInt(message_id) }, data: { isRead: true } });
    req.flash('success', 'Reply sent');
    res.redirect('/admin/messages');
});

// ── Wallet ───────────────────────────────────────────
router.get('/wallet', isAdmin, async (req, res) => {
    const transactions = await prisma.walletTransaction.findMany({ orderBy: { createdAt: 'desc' } });
    const balance = transactions.reduce((sum, t) => sum + (t.transactionType === 'credit' ? t.amount : -t.amount), 0);
    res.render('admin/wallet', { title: 'Wallet', transactions, balance });
});

router.post('/wallet/transaction', isAdmin, async (req, res) => {
    const { type, amount, description, reference } = req.body;
    await prisma.walletTransaction.create({
        data: {
            transactionType: type,
            amount: parseFloat(amount),
            description: description || null,
            reference: reference || null,
        }
    });
    res.redirect('/admin/wallet');
});

// ── Boxes ────────────────────────────────────────────
router.get('/boxes', isAdmin, async (req, res) => {
    const boxes = await prisma.box.findMany({ orderBy: { createdAt: 'desc' } });
    res.render('admin/boxes', { title: 'Boxes', boxes });
});

router.post('/boxes/create', isAdmin, async (req, res) => {
    const { name, description, price, quantity, image_url, category_id } = req.body;
    await prisma.box.create({
        data: {
            name, description: description || null,
            price: parseFloat(price), quantity: parseInt(quantity) || 0,
            imageUrl: image_url || null,
            categoryId: category_id ? parseInt(category_id) : null,
        }
    });
    res.redirect('/admin/boxes');
});

// ── Promotions ───────────────────────────────────────
router.get('/promotions', isAdmin, async (req, res) => {
    const promotions = await prisma.promotion.findMany({
        orderBy: { createdAt: 'desc' },
        include: { category: true }
    });
    res.render('admin/promotions', { title: 'Promotions', promotions });
});

router.post('/promotions/create', isAdmin, async (req, res) => {
    const { name, description, discount_percentage, category_id, starts_at, ends_at } = req.body;
    await prisma.promotion.create({
        data: {
            name,
            description: description || null,
            discountPercentage: parseFloat(discount_percentage) || 0,
            categoryId: category_id ? parseInt(category_id) : null,
            startsAt: starts_at ? new Date(starts_at) : null,
            endsAt: ends_at ? new Date(ends_at) : null,
        }
    });
    res.redirect('/admin/promotions');
});

router.post('/promotions/:id/toggle', isAdmin, async (req, res) => {
    const p = await prisma.promotion.findUnique({ where: { id: parseInt(req.params.id) } });
    if (p) await prisma.promotion.update({ where: { id: p.id }, data: { isActive: !p.isActive } });
    res.json({ success: true });
});

router.post('/promotions/:id/edit', isAdmin, async (req, res) => {
    const { name, description, discount_percentage, category_id, starts_at, ends_at } = req.body;
    await prisma.promotion.update({
        where: { id: parseInt(req.params.id) },
        data: {
            name, description: description || null,
            discountPercentage: parseFloat(discount_percentage) || 0,
            categoryId: category_id ? parseInt(category_id) : null,
            startsAt: starts_at ? new Date(starts_at) : null,
            endsAt: ends_at ? new Date(ends_at) : null,
        }
    });
    res.redirect('/admin/promotions');
});

router.post('/promotions/:id/delete', isAdmin, async (req, res) => {
    await prisma.promotion.delete({ where: { id: parseInt(req.params.id) } });
    res.redirect('/admin/promotions');
});

// ── Coupons ──────────────────────────────────────────
router.get('/coupons', isAdmin, async (req, res) => {
    const coupons = await prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
    res.render('admin/coupons', { title: 'Coupons', coupons });
});

router.post('/coupons/create', isAdmin, async (req, res) => {
    const { code, discount_type, discount_value, min_order, max_uses, expires_at } = req.body;
    await prisma.coupon.create({
        data: {
            code, discountType: discount_type || 'percentage',
            discountValue: parseFloat(discount_value),
            minOrder: parseFloat(min_order) || 0,
            maxUses: parseInt(max_uses) || 0,
            expiresAt: expires_at ? new Date(expires_at) : null,
        }
    });
    res.redirect('/admin/coupons');
});

router.post('/coupons/:id/toggle', isAdmin, async (req, res) => {
    const c = await prisma.coupon.findUnique({ where: { id: parseInt(req.params.id) } });
    if (c) await prisma.coupon.update({ where: { id: c.id }, data: { isActive: !c.isActive } });
    res.json({ success: true });
});

router.post('/coupons/:id/edit', isAdmin, async (req, res) => {
    const { code, discount_type, discount_value, min_order, max_uses, expires_at } = req.body;
    await prisma.coupon.update({
        where: { id: parseInt(req.params.id) },
        data: {
            code, discountType: discount_type || 'percentage',
            discountValue: parseFloat(discount_value),
            minOrder: parseFloat(min_order) || 0,
            maxUses: parseInt(max_uses) || 0,
            expiresAt: expires_at ? new Date(expires_at) : null,
        }
    });
    res.redirect('/admin/coupons');
});

router.post('/coupons/:id/delete', isAdmin, async (req, res) => {
    await prisma.coupon.delete({ where: { id: parseInt(req.params.id) } });
    res.redirect('/admin/coupons');
});

// ── Banners ──────────────────────────────────────────
router.get('/cms/banners', isAdmin, async (req, res) => {
    const banners = await prisma.banner.findMany({ orderBy: { ordering: 'asc' } });
    res.render('admin/cms_banners', { title: 'Banners', banners });
});

router.post('/cms/banners/create', isAdmin, async (req, res) => {
    const { title, image_url, url } = req.body;
    await prisma.banner.create({ data: { title, imageUrl: image_url || null, url: url || null } });
    res.redirect('/admin/cms/banners');
});

router.post('/cms/banners/:id/toggle', isAdmin, async (req, res) => {
    const b = await prisma.banner.findUnique({ where: { id: parseInt(req.params.id) } });
    if (b) await prisma.banner.update({ where: { id: b.id }, data: { isActive: !b.isActive } });
    res.json({ success: true });
});

router.post('/cms/banners/:id/delete', isAdmin, async (req, res) => {
    await prisma.banner.delete({ where: { id: parseInt(req.params.id) } });
    res.redirect('/admin/cms/banners');
});

// ── CMS placeholders ─────────────────────────────────
router.get('/cms/thumbnails', isAdmin, (req, res) => res.render('admin/cms_thumbnails', { title: 'Thumbnails' }));
router.get('/cms/binders', isAdmin, (req, res) => res.render('admin/cms_binders', { title: 'Binders' }));
router.get('/cms/games', isAdmin, (req, res) => res.render('admin/cms_games', { title: 'Games' }));

// ── Testimonials ─────────────────────────────────────
router.get('/testimonials', isAdmin, async (req, res) => {
    const testimonials = await prisma.testimonial.findMany({ orderBy: { createdAt: 'desc' } });
    res.render('admin/testimonials', { title: 'Testimonials', testimonials });
});

router.post('/testimonials/create', isAdmin, async (req, res) => {
    const { customer_name, content, rating } = req.body;
    await prisma.testimonial.create({
        data: { customerName: customer_name || null, content, rating: parseInt(rating) || 5 }
    });
    res.redirect('/admin/testimonials');
});

router.post('/testimonials/:id/approve', isAdmin, async (req, res) => {
    await prisma.testimonial.update({ where: { id: parseInt(req.params.id) }, data: { isApproved: true } });
    res.json({ success: true });
});

router.post('/testimonials/:id/unapprove', isAdmin, async (req, res) => {
    await prisma.testimonial.update({ where: { id: parseInt(req.params.id) }, data: { isApproved: false } });
    res.json({ success: true });
});

router.post('/testimonials/:id/delete', isAdmin, async (req, res) => {
    await prisma.testimonial.delete({ where: { id: parseInt(req.params.id) } });
    res.redirect('/admin/testimonials');
});

// ── Tickets ──────────────────────────────────────────
router.get('/tickets', isAdmin, async (req, res) => {
    const tickets = await prisma.ticket.findMany({ orderBy: { createdAt: 'desc' }, include: { user: true } });
    res.render('admin/tickets', { title: 'Tickets', tickets });
});

router.post('/tickets/:id/status', isAdmin, async (req, res) => {
    await prisma.ticket.update({
        where: { id: parseInt(req.params.id) },
        data: { status: req.body.status }
    });
    res.json({ success: true });
});

// ── Tutorials / Payment ──────────────────────────────
router.get('/tutorials', isAdmin, (req, res) => res.render('admin/tutorials', { title: 'Tutorials' }));
router.get('/payment-shipping', isAdmin, (req, res) => res.render('admin/payment_shipping', { title: 'Payment & Shipping' }));

// ── Sales Report ─────────────────────────────────────
router.get('/sales-report', isAdmin, async (req, res) => {
    const orders = await prisma.order.findMany({
        orderBy: { createdAt: 'desc' },
        include: { user: true, items: { include: { product: true } } }
    });

    const totalRevenue = orders.reduce((s, o) => s + o.total, 0);
    const totalOrders = orders.length;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    // Monthly data
    const monthlyData = {};
    orders.forEach(o => {
        const key = o.createdAt.toISOString().substring(0, 7); // YYYY-MM
        if (!monthlyData[key]) monthlyData[key] = { revenue: 0, orders: 0 };
        monthlyData[key].revenue += o.total;
        monthlyData[key].orders += 1;
    });

    const itemsSold = orders.reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0), 0);

    // Calculate Top Products
    const productStats = {};
    orders.forEach(order => {
        order.items.forEach(item => {
            if (!productStats[item.productId]) {
                productStats[item.productId] = {
                    name: item.product.name,
                    sold: 0,
                    revenue: 0
                };
            }
            productStats[item.productId].sold += item.quantity;
            productStats[item.productId].revenue += (item.price * item.quantity);
        });
    });
    const topProducts = Object.values(productStats)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);

    // Calculate Sales by Category
    const categoryStats = {};
    let totalCatRevenue = 0;
    orders.forEach(order => {
        order.items.forEach(item => {
            const catName = item.product.category ? item.product.category.name : 'Uncategorized';
            if (!categoryStats[catName]) categoryStats[catName] = 0;
            const rev = item.price * item.quantity;
            categoryStats[catName] += rev;
            totalCatRevenue += rev;
        });
    });
    const categoriesSales = Object.entries(categoryStats)
        .map(([name, revenue]) => ({
            name,
            percentage: totalCatRevenue > 0 ? Math.round((revenue / totalCatRevenue) * 100) : 0
        }))
        .sort((a, b) => b.percentage - a.percentage);

    res.render('admin/sales_report', {
        title: 'Sales Report',
        totalRevenue,
        totalOrders,
        avgOrderValue,
        itemsSold,
        monthlyData,
        orders,
        topProducts,
        categoriesSales,
        recentOrders: orders.slice(0, 10), // Pass recentOrders explicitly if template needs it distinct from 'orders'
    });
});

// ── Users (API endpoint for admin) ───────────────────
router.get('/users', isAdmin, async (req, res) => {
    const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ users });
});

module.exports = router;
