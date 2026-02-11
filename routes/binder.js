const express = require('express');
const router = express.Router();
const axios = require('axios');
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

// ── Product search for card picker ───────────────────
router.get('/api/products/search', isAuthenticated, async (req, res) => {
    const q = (req.query.q || '').trim();
    const category = req.query.category || '';
    const page = parseInt(req.query.page) || 1;
    const perPage = 20;

    const where = {};
    if (q) where.name = { contains: q };
    if (category) {
        const cat = await prisma.category.findUnique({ where: { slug: category } });
        if (cat) where.categoryId = cat.id;
    }

    const total = await prisma.product.count({ where });
    const products = await prisma.product.findMany({
        where, include: { category: true },
        skip: (page - 1) * perPage, take: perPage,
        orderBy: { name: 'asc' }
    });

    res.json({
        products: products.map(p => ({
            id: p.id,
            name: p.name,
            image_url: p.imageUrl || '',
            set_name: p.setName || '',
            rarity: p.rarity || '',
            category: p.category ? p.category.name : '',
        })),
        total,
        pages: Math.ceil(total / perPage),
        page,
    });
});

// ── External Card API Search ─────────────────────────
const SCRYFALL_SEARCH = 'https://api.scryfall.com/cards/search';
const POKEMON_SEARCH = 'https://api.pokemontcg.io/v2/cards';
const YGOPRO_SEARCH = 'https://db.ygoprodeck.com/api/v7/cardinfo.php';

router.get('/api/external/search', isAuthenticated, async (req, res) => {
    const q = (req.query.q || '').trim();
    const source = req.query.source || 'scryfall';
    const page = parseInt(req.query.page) || 1;

    if (!q) return res.json({ cards: [], total: 0, has_more: false });

    try {
        if (source === 'scryfall') return res.json(await searchScryfall(q, page));
        if (source === 'pokemon') return res.json(await searchPokemon(q, page));
        if (source === 'yugioh') return res.json(await searchYugioh(q));
        return res.json({ cards: [], total: 0, has_more: false });
    } catch (err) {
        return res.json({ cards: [], total: 0, has_more: false, error: err.message });
    }
});

async function searchScryfall(q, page = 1) {
    const resp = await axios.get(SCRYFALL_SEARCH, { params: { q, page, unique: 'cards' }, timeout: 10000 });
    if (resp.status !== 200) return { cards: [], total: 0, has_more: false };
    const data = resp.data;
    const cards = (data.data || []).slice(0, 30).map(c => {
        let img = '';
        if (c.image_uris) img = c.image_uris.normal || c.image_uris.small || '';
        else if (c.card_faces && c.card_faces.length > 0 && c.card_faces[0].image_uris)
            img = c.card_faces[0].image_uris.normal || c.card_faces[0].image_uris.small || '';
        return {
            external_id: c.id || '',
            name: c.name || '',
            image_url: img,
            set_name: c.set_name || '',
            set_code: c.set || '',
            rarity: c.rarity || '',
            type_line: c.type_line || '',
            source: 'scryfall',
        };
    });
    return { cards, total: data.total_cards || cards.length, has_more: data.has_more || false };
}

async function searchPokemon(q, page = 1) {
    const resp = await axios.get(POKEMON_SEARCH, { params: { q: `name:${q}*`, page, pageSize: 30 }, timeout: 10000 });
    if (resp.status !== 200) return { cards: [], total: 0, has_more: false };
    const data = resp.data;
    const cards = (data.data || []).map(c => ({
        external_id: c.id || '',
        name: c.name || '',
        image_url: (c.images || {}).large || (c.images || {}).small || '',
        set_name: (c.set || {}).name || '',
        set_code: (c.set || {}).id || '',
        rarity: c.rarity || '',
        type_line: (c.types || []).join(', '),
        source: 'pokemon',
    }));
    const total = data.totalCount || cards.length;
    return { cards, total, has_more: page * 30 < total };
}

async function searchYugioh(q) {
    const resp = await axios.get(YGOPRO_SEARCH, { params: { fname: q, num: 30, offset: 0 }, timeout: 10000 });
    if (resp.status !== 200) return { cards: [], total: 0, has_more: false };
    const data = resp.data;
    const cards = (data.data || []).map(c => {
        const imgs = c.card_images || [];
        return {
            external_id: String(c.id || ''),
            name: c.name || '',
            image_url: imgs.length > 0 ? imgs[0].image_url : '',
            set_name: '',
            set_code: '',
            rarity: c.race || '',
            type_line: c.type || '',
            source: 'yugioh',
        };
    });
    return { cards, total: cards.length, has_more: false };
}

// ── Import external cards ────────────────────────────
router.post('/api/external/import', isAuthenticated, async (req, res) => {
    const cardsData = req.body.cards || [];
    const binderId = req.body.binder_id;

    let binder = null;
    if (binderId) {
        binder = await prisma.binder.findUnique({ where: { id: binderId } });
        if (!binder || binder.userId !== req.session.userId) return res.status(403).json({ error: 'Unauthorized' });
    }

    const importedIds = [];
    for (const card of cardsData) {
        const name = card.name || 'Unknown Card';
        const imageUrl = card.image_url || '';
        const setName = card.set_name || '';
        const setCode = card.set_code || '';
        const rarity = card.rarity || '';
        const source = card.source || 'unknown';

        // Check duplicates
        const existing = await prisma.product.findFirst({ where: { name, imageUrl } });
        if (existing) { importedIds.push(existing.id); continue; }

        // Find or create category
        const catMap = { scryfall: 'mtg', pokemon: 'pokemon', yugioh: 'yugioh' };
        const catSlug = catMap[source] || 'mtg';
        let cat = await prisma.category.findUnique({ where: { slug: catSlug } });
        if (!cat) {
            const catNameMap = { mtg: 'Magic: The Gathering', pokemon: 'Pokémon', yugioh: 'Yu-Gi-Oh!' };
            cat = await prisma.category.create({ data: { name: catNameMap[catSlug] || source, slug: catSlug } });
        }

        // Unique slug
        let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        let finalSlug = slug;
        let counter = 1;
        while (await prisma.product.findUnique({ where: { slug: finalSlug } })) {
            finalSlug = `${slug}-${counter++}`;
        }

        const product = await prisma.product.create({
            data: {
                name, slug: finalSlug, imageUrl, setName, setCode, rarity,
                cardType: card.type_line || '',
                categoryId: cat ? cat.id : null,
            }
        });
        importedIds.push(product.id);
    }

    // Add to binder
    const addedToBinder = [];
    if (binder && importedIds.length > 0) {
        const existingCards = await prisma.binderCard.findMany({ where: { binderId: binder.id } });
        const existingPositions = new Set(existingCards.map(c => c.position));
        let nextPos = 0;

        for (const pid of importedIds) {
            while (existingPositions.has(nextPos)) nextPos++;
            const bc = await prisma.binderCard.create({
                data: { binderId: binder.id, productId: pid, position: nextPos, isCollected: false }
            });
            const p = await prisma.product.findUnique({ where: { id: pid } });
            addedToBinder.push({ id: bc.id, product_id: pid, position: nextPos, name: p ? p.name : '', image_url: p ? p.imageUrl : '' });
            existingPositions.add(nextPos);
            nextPos++;
        }
    }

    res.json({ imported_ids: importedIds, count: importedIds.length, added_to_binder: addedToBinder });
});

module.exports = router;
