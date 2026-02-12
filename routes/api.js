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

// GET /api/products/search
router.get('/products/search', isAuthenticated, async (req, res) => {
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

// GET /api/external/search
router.get('/external/search', isAuthenticated, async (req, res) => {
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

// GET /api/products/:id
router.get('/products/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const product = await prisma.product.findUnique({
        where: { id },
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

// ── Product search for card picker ───────────────────
router.get('/products/search', isAuthenticated, async (req, res) => {
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

router.get('/external/search', isAuthenticated, async (req, res) => {
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

router.post('/external/import', isAuthenticated, async (req, res) => {
    const cardsData = req.body.cards || [];
    const binderId = req.body.binder_id;

    let binder = null;
    if (binderId) {
        binder = await prisma.binder.findUnique({ where: { id: parseInt(binderId) } });
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

async function searchScryfall(query, page) {
    const url = `${SCRYFALL_SEARCH}?q=${encodeURIComponent(query)}&page=${page}`;
    const resp = await fetch(url);
    if (!resp.ok) {
        if (resp.status === 404) return { cards: [], total: 0, has_more: false };
        throw new Error(`Scryfall API error: ${resp.status}`);
    }
    const data = await resp.json();
    const cards = data.data.map(c => ({
        external_id: c.id,
        name: c.name,
        image_url: c.image_uris ? c.image_uris.normal : (c.card_faces ? c.card_faces[0].image_uris.normal : ''),
        set_name: c.set_name,
        rarity: c.rarity,
        source: 'scryfall'
    }));
    return { cards, total: data.total_cards, has_more: data.has_more };
}

async function searchPokemon(query, page) {
    const url = `${POKEMON_SEARCH}?q=name:"${encodeURIComponent(query)}*"&page=${page}&pageSize=20`;
    const resp = await fetch(url, { headers: { 'X-Api-Key': process.env.POKEMON_API_KEY || '' } });
    if (!resp.ok) throw new Error(`Pokemon API error: ${resp.status}`);
    const data = await resp.json();
    const cards = data.data.map(c => ({
        external_id: c.id,
        name: c.name,
        image_url: c.images.small,
        set_name: c.set.name,
        rarity: c.rarity || '',
        source: 'pokemon'
    }));
    return { cards, total: data.totalCount, has_more: (page * 20) < data.totalCount };
}

async function searchYugioh(query) {
    // YGOPro API doesn't support pagination well for name search, returns all
    const url = `${YGOPRO_SEARCH}?fname=${encodeURIComponent(query)}`;
    const resp = await fetch(url);
    if (!resp.ok) {
        if (resp.status === 400) return { cards: [], total: 0, has_more: false };
        throw new Error(`YGOPro API error: ${resp.status}`);
    }
    const data = await resp.json();
    const cards = data.data.slice(0, 50).map(c => ({
        external_id: String(c.id),
        name: c.name,
        image_url: c.card_images[0].image_url,
        set_name: c.archetype || '',
        rarity: '',
        source: 'yugioh'
    }));
    return { cards, total: data.data.length, has_more: false };
}

module.exports = router;
