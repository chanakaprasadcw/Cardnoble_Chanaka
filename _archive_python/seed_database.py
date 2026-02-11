#!/usr/bin/env python3
"""
Seed the database with initial data from scraped JSON.
Run with: python seed_database.py
"""
import json
import html
import re
import os
from app import create_app, db
from app.models import User, Category, Product, Stock, Banner

# Path to the scraped HTML with JSON data
SCRAPED_HTML_PATH = os.path.join(
    os.path.dirname(__file__), 
    '..', 'kevinphp_clone', 'raw_index.html'
)

def extract_json_from_html(html_path):
    """Extract JSON data from the data-page attribute."""
    try:
        with open(html_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Try double quotes first
        match = re.search(r'data-page="([^"]+)"', content)
        if not match:
            # Try single quotes
            match = re.search(r"data-page='([^']+)'", content)
        
        if not match:
            print("Could not find data-page attribute")
            return None
        
        json_str = html.unescape(match.group(1))
        return json.loads(json_str)
    except FileNotFoundError:
        print(f"File not found: {html_path}")
        return None
    except json.JSONDecodeError as e:
        print(f"JSON decode error: {e}")
        return None


def seed_database():
    """Seed the database with initial data."""
    app = create_app()
    
    with app.app_context():
        # Drop and recreate all tables
        print("Recreating database tables...")
        db.drop_all()
        db.create_all()
        
        # Create admin user
        admin = User(
            email='kevinphp@yopmail.com',
            name='Admin',
            role='admin'
        )
        admin.set_password('QWERT1234')
        db.session.add(admin)
        print("Created admin user: kevinphp@yopmail.com / QWERT1234")
        
        # Create categories
        print("Creating categories...")
        categories = {
            'mtg': Category(name='Magic: The Gathering', slug='mtg'),
            'pokemon': Category(name='Pokémon', slug='pokemon'),
            'yugioh': Category(name='Yu-Gi-Oh!', slug='yugioh'),
            'fab': Category(name='Flesh & Blood', slug='fab'),
            'onepiece': Category(name='One Piece', slug='onepiece'),
            'lorcana': Category(name='Disney Lorcana', slug='lorcana'),
        }
        for cat in categories.values():
            db.session.add(cat)
        db.session.flush()
        
        # Try to extract data from scraped HTML
        print(f"Looking for scraped data at: {SCRAPED_HTML_PATH}")
        data = extract_json_from_html(SCRAPED_HTML_PATH)
        
        products_added = 0
        
        if data and 'props' in data:
            props = data['props']
            
            # Add banners
            if 'banners' in props and props['banners']:
                print("Adding banners...")
                for banner_data in props['banners'][:3]:  # Limit to 3 banners
                    banner = Banner(
                        title=banner_data.get('title', 'Banner'),
                        image_url=banner_data.get('desktop_image', ''),
                        url=banner_data.get('url', ''),
                        is_active=True,
                        ordering=banner_data.get('ordering', 0)
                    )
                    db.session.add(banner)
            
            # Add products
            products_data = props.get('products', [])
            if isinstance(products_data, dict):
                products_data = products_data.get('data', [])
            
            print(f"Adding {len(products_data)} products...")
            for i, prod_data in enumerate(products_data):
                try:
                    # Determine category
                    game = prod_data.get('game', 'mtg').lower()
                    category = categories.get(game, categories['mtg'])
                    
                    # Create slug
                    name = prod_data.get('name', f'Product {i}')
                    slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
                    slug = f"{slug}-{i}"  # Ensure uniqueness
                    
                    product = Product(
                        name=name,
                        slug=slug,
                        set_code=prod_data.get('set_code', ''),
                        set_name=prod_data.get('set_name', prod_data.get('expansion', '')),
                        category_id=category.id,
                        image_url=prod_data.get('image', prod_data.get('card_image', prod_data.get('image_path', ''))),
                        rarity=prod_data.get('rarity', ''),
                        card_type=prod_data.get('type', ''),
                        language=prod_data.get('language', 'EN')
                    )
                    db.session.add(product)
                    db.session.flush()
                    
                    # Add stock
                    price = prod_data.get('price', prod_data.get('min_price', 100))
                    if isinstance(price, str):
                        price = float(price.replace(',', ''))
                    
                    stock = Stock(
                        product_id=product.id,
                        condition='NM',
                        quantity=prod_data.get('quantity', prod_data.get('total_quantity', 10)),
                        price=price
                    )
                    db.session.add(stock)
                    products_added += 1
                    
                except Exception as e:
                    print(f"Error adding product: {e}")
                    continue
        
        if products_added == 0:
            # Add sample products if no scraped data
            print("Adding sample products...")
            sample_products = [
                {'name': 'Black Lotus', 'set': 'Alpha', 'price': 50000, 'qty': 1},
                {'name': 'Mox Pearl', 'set': 'Beta', 'price': 3000, 'qty': 2},
                {'name': 'Ancestral Recall', 'set': 'Unlimited', 'price': 5000, 'qty': 1},
                {'name': 'Time Walk', 'set': 'Alpha', 'price': 4500, 'qty': 1},
                {'name': 'Pikachu VMAX', 'set': 'Vivid Voltage', 'price': 50, 'qty': 10, 'game': 'pokemon'},
                {'name': 'Charizard GX', 'set': 'Hidden Fates', 'price': 200, 'qty': 5, 'game': 'pokemon'},
                {'name': 'Dark Magician', 'set': 'LOB', 'price': 30, 'qty': 8, 'game': 'yugioh'},
                {'name': 'Blue-Eyes White Dragon', 'set': 'SDK', 'price': 45, 'qty': 6, 'game': 'yugioh'},
            ]
            
            for i, prod in enumerate(sample_products):
                game = prod.get('game', 'mtg')
                category = categories.get(game, categories['mtg'])
                
                product = Product(
                    name=prod['name'],
                    slug=re.sub(r'[^a-z0-9]+', '-', prod['name'].lower()) + f'-{i}',
                    set_name=prod['set'],
                    category_id=category.id,
                    image_url=f'https://via.placeholder.com/223x310?text={prod["name"].replace(" ", "+")}',
                    rarity='Rare'
                )
                db.session.add(product)
                db.session.flush()
                
                stock = Stock(
                    product_id=product.id,
                    condition='NM',
                    quantity=prod['qty'],
                    price=prod['price']
                )
                db.session.add(stock)
                products_added += 1
        
        db.session.commit()
        print(f"\n✅ Database seeded successfully!")
        print(f"   - Categories: {len(categories)}")
        print(f"   - Products: {products_added}")
        print(f"   - Admin: kevinphp@yopmail.com / QWERT1234")


if __name__ == '__main__':
    seed_database()
