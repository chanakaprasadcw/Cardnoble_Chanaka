const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio'); // Optional, but regex is used in python script. We can use regex too.

const prisma = new PrismaClient();

// Path to scraped HTML
const SCRAPED_HTML_PATH = path.join(__dirname, '..', 'kevinphp_clone', 'raw_index.html');

function extractJsonFromHtml(htmlPath) {
    try {
        if (!fs.existsSync(htmlPath)) {
            console.log(`File not found: ${htmlPath}`);
            return null;
        }

        const content = fs.readFileSync(htmlPath, 'utf-8');

        // Try double quotes
        let match = content.match(/data-page="([^"]+)"/);
        if (!match) {
            // Try single quotes
            match = content.match(/data-page='([^']+)'/);
        }

        if (!match) {
            console.log("Could not find data-page attribute");
            return null;
        }

        // Unescape HTML entities
        const jsonStr = match[1]
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&#39;/g, "'");

        return JSON.parse(jsonStr);
    } catch (error) {
        console.error(`Error extracting JSON: ${error.message}`);
        return null;
    }
}

async function main() {
    console.log("Start seeding...");

    // 1. Create Admin User
    const adminEmail = 'kevinphp@yopmail.com';
    const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });

    if (!existingAdmin) {
        const hashedPassword = await bcrypt.hash('QWERT1234', 10);
        await prisma.user.create({
            data: {
                email: adminEmail,
                name: 'Admin',
                password: hashedPassword,
                role: 'admin'
            }
        });
        console.log("Created admin user: kevinphp@yopmail.com");
    } else {
        console.log("Admin user already exists");
    }

    // 2. Create Categories
    const categoriesData = [
        { name: 'Magic: The Gathering', slug: 'mtg' },
        { name: 'Pokémon', slug: 'pokemon' },
        { name: 'Yu-Gi-Oh!', slug: 'yugioh' },
        { name: 'Flesh & Blood', slug: 'fab' },
        { name: 'One Piece', slug: 'onepiece' },
        { name: 'Disney Lorcana', slug: 'lorcana' }
    ];

    const categoryMap = {}; // name -> id

    for (const cat of categoriesData) {
        const existing = await prisma.category.findUnique({ where: { slug: cat.slug } });
        if (!existing) {
            const newCat = await prisma.category.create({ data: cat });
            categoryMap[cat.slug] = newCat.id;
            console.log(`Created category: ${cat.name}`);
        } else {
            categoryMap[cat.slug] = existing.id;
        }
    }

    // 3. Extract and Add Products
    const data = extractJsonFromHtml(SCRAPED_HTML_PATH);
    let productsAdded = 0;

    if (data && data.props) {
        const props = data.props;

        // Banners
        if (props.banners && props.banners.length > 0) {
            for (const bannerData of props.banners.slice(0, 3)) {
                // Check if banner exists (by image url for simplicity, or just skip check and duplicate risk)
                // For simplicity, we just create
                await prisma.banner.create({
                    data: {
                        title: bannerData.title || 'Banner',
                        imageUrl: bannerData.desktop_image || '',
                        url: bannerData.url || '',
                        isActive: true,
                        ordering: bannerData.ordering || 0
                    }
                });
            }
            console.log("Added banners");
        }

        // Products
        let productsList = props.products;
        if (productsList && productsList.data) {
            productsList = productsList.data;
        }

        if (Array.isArray(productsList)) {
            console.log(`Found ${productsList.length} products to map...`);

            for (let i = 0; i < productsList.length; i++) {
                const prodData = productsList[i];
                try {
                    const game = (prodData.game || 'mtg').toLowerCase();
                    const categoryId = categoryMap[game] || categoryMap['mtg'];

                    const name = prodData.name || `Product ${i}`;
                    let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + `-${i}`;

                    const price = parseFloat((prodData.price || prodData.min_price || '100').toString().replace(',', ''));
                    const quantity = parseInt(prodData.quantity || prodData.total_quantity || 10);

                    const imageUrl = prodData.image || prodData.card_image || prodData.image_path || '';

                    // Create Product
                    const product = await prisma.product.create({
                        data: {
                            name: name,
                            slug: slug,
                            setCode: prodData.set_code || '',
                            setName: prodData.set_name || prodData.expansion || '',
                            categoryId: categoryId,
                            imageUrl: imageUrl,
                            rarity: prodData.rarity || '',
                            cardType: prodData.type || '',
                            language: prodData.language || 'EN',
                            // Create Stock relation
                            stock: {
                                create: {
                                    condition: 'NM',
                                    quantity: quantity,
                                    price: price
                                }
                            }
                        }
                    });

                    productsAdded++;
                } catch (e) {
                    console.error(`Error adding product: ${e.message}`);
                }
            }
        }
    }

    // 4. Sample Products fallback
    if (productsAdded === 0) {
        console.log("No products from scrape, adding samples...");
        const sampleProducts = [
            { name: 'Black Lotus', set: 'Alpha', price: 50000, qty: 1, slug_base: 'black-lotus' },
            { name: 'Mox Pearl', set: 'Beta', price: 3000, qty: 2, slug_base: 'mox-pearl' },
            { name: 'Pikachu VMAX', set: 'Vivid Voltage', price: 50, qty: 10, game: 'pokemon', slug_base: 'pikachu-vmax' },
            { name: 'Blue-Eyes White Dragon', set: 'SDK', price: 45, qty: 6, game: 'yugioh', slug_base: 'blue-eyes' }
        ];

        for (let i = 0; i < sampleProducts.length; i++) {
            const p = sampleProducts[i];
            const catSlug = p.game || 'mtg';

            await prisma.product.create({
                data: {
                    name: p.name,
                    slug: `${p.slug_base}-${i}`,
                    setName: p.set,
                    categoryId: categoryMap[catSlug] || categoryMap['mtg'],
                    imageUrl: `https://via.placeholder.com/223x310?text=${p.name.replace(' ', '+')}`,
                    rarity: 'Rare',
                    stock: {
                        create: {
                            condition: 'NM',
                            quantity: p.qty,
                            price: p.price
                        }
                    }
                }
            });
            productsAdded++;
        }
    }

    console.log(`\n✅ Seeding finished. Added ${productsAdded} products.`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
