const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { isAuthenticated } = require('../middleware/auth');
const prisma = new PrismaClient();

// ── Pages ────────────────────────────────────────────
router.get('/binders', async (req, res) => {
    if (res.locals.currentUser) {
        const binders = await prisma.binder.findMany({
            where: { userId: res.locals.currentUser.id },
            orderBy: { updatedAt: 'desc' },
            include: { cards: { include: { product: true } } }
        });
        return res.render('storefront/binders_dashboard', { title: 'My Binders', binders });
    }
    res.render('storefront/binders', { title: 'Binders' });
});

router.get('/binders/:id', isAuthenticated, async (req, res) => {
    const binder = await prisma.binder.findUnique({
        where: { id: parseInt(req.params.id) },
        include: { cards: { include: { product: true }, orderBy: { position: 'asc' } } }
    });
    if (!binder || binder.userId !== req.session.userId) return res.redirect('/binders');
    res.render('storefront/binder_editor', { title: binder.name, binder });
});

// ── CRUD API ─────────────────────────────────────────
router.post('/api/binders/create', isAuthenticated, async (req, res) => {
    const { name, description, grid_size, cover_color } = req.body;
    const binder = await prisma.binder.create({
        data: {
            userId: req.session.userId,
            name: name || 'Untitled Binder',
            description: description || '',
            gridSize: grid_size || '3x3',
            coverColor: cover_color || '#6366f1',
        }
    });
    res.status(201).json({ id: binder.id, name: binder.name });
});

router.post('/api/binders/:id/delete', isAuthenticated, async (req, res) => {
    const binder = await prisma.binder.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!binder || binder.userId !== req.session.userId) return res.status(403).json({ error: 'Unauthorized' });
    await prisma.binder.delete({ where: { id: binder.id } });
    res.json({ success: true });
});

router.post('/api/binders/:id/settings', isAuthenticated, async (req, res) => {
    const binder = await prisma.binder.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!binder || binder.userId !== req.session.userId) return res.status(403).json({ error: 'Unauthorized' });
    const data = {};
    if (req.body.name) data.name = req.body.name;
    if (req.body.description !== undefined) data.description = req.body.description;
    if (req.body.grid_size) data.gridSize = req.body.grid_size;
    if (req.body.cover_color) data.coverColor = req.body.cover_color;
    await prisma.binder.update({ where: { id: binder.id }, data });
    res.json({ success: true });
});

// ── Card operations ──────────────────────────────────
router.get('/api/binders/:id/cards', isAuthenticated, async (req, res) => {
    const binder = await prisma.binder.findUnique({
        where: { id: parseInt(req.params.id) },
        include: { cards: { include: { product: true }, orderBy: { position: 'asc' } } }
    });
    if (!binder || binder.userId !== req.session.userId) return res.status(403).json({ error: 'Unauthorized' });

    const cards = binder.cards.map(bc => ({
        id: bc.id,
        product_id: bc.productId,
        position: bc.position,
        is_collected: bc.isCollected,
        name: bc.product.name,
        image_url: bc.product.imageUrl || '',
        set_name: bc.product.setName || '',
        rarity: bc.product.rarity || '',
    }));

    const collectedCount = binder.cards.filter(c => c.isCollected).length;
    res.json({
        cards,
        grid_size: binder.gridSize,
        card_count: binder.cards.length,
        collected_count: collectedCount,
    });
});

router.post('/api/binders/:id/cards/add', isAuthenticated, async (req, res) => {
    const binder = await prisma.binder.findUnique({
        where: { id: parseInt(req.params.id) },
        include: { cards: true }
    });
    if (!binder || binder.userId !== req.session.userId) return res.status(403).json({ error: 'Unauthorized' });

    const productIds = req.body.product_ids || [];
    const existingPositions = new Set(binder.cards.map(c => c.position));
    let nextPos = 0;
    const added = [];

    for (const pid of productIds) {
        const product = await prisma.product.findUnique({ where: { id: pid } });
        if (!product) continue;
        while (existingPositions.has(nextPos)) nextPos++;

        const bc = await prisma.binderCard.create({
            data: { binderId: binder.id, productId: pid, position: nextPos, isCollected: false }
        });
        existingPositions.add(nextPos);
        added.push({ id: bc.id, product_id: pid, position: nextPos, name: product.name, image_url: product.imageUrl || '' });
        nextPos++;
    }

    const count = await prisma.binderCard.count({ where: { binderId: binder.id } });
    res.json({ added, card_count: count });
});

router.post('/api/binders/:id/cards/remove', isAuthenticated, async (req, res) => {
    const binder = await prisma.binder.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!binder || binder.userId !== req.session.userId) return res.status(403).json({ error: 'Unauthorized' });

    const bc = await prisma.binderCard.findUnique({ where: { id: req.body.card_id } });
    if (bc && bc.binderId === binder.id) {
        await prisma.binderCard.delete({ where: { id: bc.id } });
    }

    const count = await prisma.binderCard.count({ where: { binderId: binder.id } });
    res.json({ success: true, card_count: count });
});

router.post('/api/binders/:id/cards/reorder', isAuthenticated, async (req, res) => {
    const binder = await prisma.binder.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!binder || binder.userId !== req.session.userId) return res.status(403).json({ error: 'Unauthorized' });

    const positions = req.body.positions || {};
    for (const [cardId, newPos] of Object.entries(positions)) {
        const bc = await prisma.binderCard.findUnique({ where: { id: parseInt(cardId) } });
        if (bc && bc.binderId === binder.id) {
            await prisma.binderCard.update({ where: { id: bc.id }, data: { position: newPos } });
        }
    }
    res.json({ success: true });
});

router.post('/api/binders/:id/cards/toggle', isAuthenticated, async (req, res) => {
    const binder = await prisma.binder.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!binder || binder.userId !== req.session.userId) return res.status(403).json({ error: 'Unauthorized' });

    const bc = await prisma.binderCard.findUnique({ where: { id: req.body.card_id } });
    if (bc && bc.binderId === binder.id) {
        const updated = await prisma.binderCard.update({
            where: { id: bc.id },
            data: { isCollected: !bc.isCollected }
        });
        const collectedCount = await prisma.binderCard.count({ where: { binderId: binder.id, isCollected: true } });
        return res.json({ is_collected: updated.isCollected, collected_count: collectedCount });
    }
    res.status(404).json({ error: 'Card not found' });
});

module.exports = router;
