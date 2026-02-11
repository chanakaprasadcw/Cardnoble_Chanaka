import requests as http_requests
from flask import Blueprint, render_template, request, jsonify, redirect, url_for
from flask_login import login_required, current_user
from app import db
from app.models import Binder, BinderCard, Product

binder_bp = Blueprint('binder', __name__)


# ─── Pages ─────────────────────────────────────────────────────────
@binder_bp.route('/binders')
def binders_landing():
    """Binders landing - dashboard for logged in, marketing for guests."""
    if current_user.is_authenticated:
        user_binders = Binder.query.filter_by(user_id=current_user.id)\
            .order_by(Binder.updated_at.desc()).all()
        return render_template('storefront/binders_dashboard.html', binders=user_binders)
    return render_template('storefront/binders.html')


@binder_bp.route('/binders/<int:binder_id>')
@login_required
def binder_editor(binder_id):
    """Single binder editor page."""
    binder = Binder.query.get_or_404(binder_id)
    if binder.user_id != current_user.id:
        return redirect(url_for('binder.binders_landing'))
    return render_template('storefront/binder_editor.html', binder=binder)


# ─── CRUD API ──────────────────────────────────────────────────────
@binder_bp.route('/api/binders/create', methods=['POST'])
@login_required
def create_binder():
    data = request.get_json()
    binder = Binder(
        user_id=current_user.id,
        name=data.get('name', 'Untitled Binder'),
        description=data.get('description', ''),
        grid_size=data.get('grid_size', '3x3'),
        cover_color=data.get('cover_color', '#6366f1')
    )
    db.session.add(binder)
    db.session.commit()
    return jsonify({'id': binder.id, 'name': binder.name}), 201


@binder_bp.route('/api/binders/<int:binder_id>/delete', methods=['POST'])
@login_required
def delete_binder(binder_id):
    binder = Binder.query.get_or_404(binder_id)
    if binder.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    db.session.delete(binder)
    db.session.commit()
    return jsonify({'success': True})


@binder_bp.route('/api/binders/<int:binder_id>/settings', methods=['POST'])
@login_required
def update_settings(binder_id):
    binder = Binder.query.get_or_404(binder_id)
    if binder.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    data = request.get_json()
    if 'name' in data:
        binder.name = data['name']
    if 'description' in data:
        binder.description = data['description']
    if 'grid_size' in data:
        binder.grid_size = data['grid_size']
    if 'cover_color' in data:
        binder.cover_color = data['cover_color']
    db.session.commit()
    return jsonify({'success': True})


# ─── Card operations ──────────────────────────────────────────────
@binder_bp.route('/api/binders/<int:binder_id>/cards')
@login_required
def get_cards(binder_id):
    binder = Binder.query.get_or_404(binder_id)
    if binder.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    cards = []
    for bc in binder.cards:
        cards.append({
            'id': bc.id,
            'product_id': bc.product_id,
            'position': bc.position,
            'is_collected': bc.is_collected,
            'name': bc.product.name,
            'image_url': bc.product.image_url or '',
            'set_name': bc.product.set_name or '',
            'rarity': bc.product.rarity or '',
        })
    return jsonify({
        'cards': cards,
        'grid_size': binder.grid_size,
        'card_count': binder.card_count,
        'collected_count': binder.collected_count,
    })


@binder_bp.route('/api/binders/<int:binder_id>/cards/add', methods=['POST'])
@login_required
def add_cards(binder_id):
    binder = Binder.query.get_or_404(binder_id)
    if binder.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    data = request.get_json()
    product_ids = data.get('product_ids', [])

    # Find the next available position
    existing_positions = {bc.position for bc in binder.cards}
    next_pos = 0
    added = []
    for pid in product_ids:
        product = Product.query.get(pid)
        if not product:
            continue
        while next_pos in existing_positions:
            next_pos += 1
        bc = BinderCard(
            binder_id=binder.id,
            product_id=pid,
            position=next_pos,
            is_collected=False,
        )
        db.session.add(bc)
        existing_positions.add(next_pos)
        added.append({'id': None, 'product_id': pid, 'position': next_pos,
                       'name': product.name, 'image_url': product.image_url or ''})
        next_pos += 1
    db.session.commit()
    # Update ids after commit
    for a in added:
        bc = BinderCard.query.filter_by(binder_id=binder.id, position=a['position']).first()
        if bc:
            a['id'] = bc.id
    return jsonify({'added': added, 'card_count': binder.card_count})


@binder_bp.route('/api/binders/<int:binder_id>/cards/remove', methods=['POST'])
@login_required
def remove_card(binder_id):
    binder = Binder.query.get_or_404(binder_id)
    if binder.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    data = request.get_json()
    card_id = data.get('card_id')
    bc = BinderCard.query.get(card_id)
    if bc and bc.binder_id == binder.id:
        db.session.delete(bc)
        db.session.commit()
    return jsonify({'success': True, 'card_count': binder.card_count})


@binder_bp.route('/api/binders/<int:binder_id>/cards/reorder', methods=['POST'])
@login_required
def reorder_cards(binder_id):
    binder = Binder.query.get_or_404(binder_id)
    if binder.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    data = request.get_json()
    positions = data.get('positions', {})  # {card_id: new_position}
    for card_id_str, new_pos in positions.items():
        bc = BinderCard.query.get(int(card_id_str))
        if bc and bc.binder_id == binder.id:
            bc.position = new_pos
    db.session.commit()
    return jsonify({'success': True})


@binder_bp.route('/api/binders/<int:binder_id>/cards/toggle', methods=['POST'])
@login_required
def toggle_collected(binder_id):
    binder = Binder.query.get_or_404(binder_id)
    if binder.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    data = request.get_json()
    card_id = data.get('card_id')
    bc = BinderCard.query.get(card_id)
    if bc and bc.binder_id == binder.id:
        bc.is_collected = not bc.is_collected
        db.session.commit()
        return jsonify({'is_collected': bc.is_collected, 'collected_count': binder.collected_count})
    return jsonify({'error': 'Card not found'}), 404


# ─── Product search for card picker ───────────────────────────────
@binder_bp.route('/api/products/search')
@login_required
def search_products():
    q = request.args.get('q', '').strip()
    category = request.args.get('category', '')
    page = request.args.get('page', 1, type=int)
    per_page = 20

    query = Product.query
    if q:
        query = query.filter(Product.name.ilike(f'%{q}%'))
    if category:
        from app.models import Category
        cat = Category.query.filter_by(slug=category).first()
        if cat:
            query = query.filter_by(category_id=cat.id)
    query = query.order_by(Product.name)
    pagination = query.paginate(page=page, per_page=per_page, error_out=False)

    products = []
    for p in pagination.items:
        products.append({
            'id': p.id,
            'name': p.name,
            'image_url': p.image_url or '',
            'set_name': p.set_name or '',
            'rarity': p.rarity or '',
            'category': p.category.name if p.category else '',
        })

    return jsonify({
        'products': products,
        'total': pagination.total,
        'pages': pagination.pages,
        'page': page,
    })


# ─── External Card API Search ─────────────────────────────────────
SCRYFALL_SEARCH = 'https://api.scryfall.com/cards/search'
POKEMON_SEARCH = 'https://api.pokemontcg.io/v2/cards'
YGOPRO_SEARCH = 'https://db.ygoprodeck.com/api/v7/cardinfo.php'


@binder_bp.route('/api/external/search')
@login_required
def external_search():
    """Search cards from external APIs (Scryfall, Pokemon TCG, YGOPro)."""
    q = request.args.get('q', '').strip()
    source = request.args.get('source', 'scryfall')
    page = request.args.get('page', 1, type=int)

    if not q:
        return jsonify({'cards': [], 'total': 0, 'has_more': False})

    try:
        if source == 'scryfall':
            return _search_scryfall(q, page)
        elif source == 'pokemon':
            return _search_pokemon(q, page)
        elif source == 'yugioh':
            return _search_yugioh(q)
        else:
            return jsonify({'cards': [], 'total': 0, 'has_more': False})
    except Exception as e:
        return jsonify({'cards': [], 'total': 0, 'has_more': False, 'error': str(e)})


def _search_scryfall(q, page=1):
    resp = http_requests.get(SCRYFALL_SEARCH, params={
        'q': q, 'page': page, 'unique': 'cards'
    }, timeout=10)
    if resp.status_code != 200:
        return jsonify({'cards': [], 'total': 0, 'has_more': False})
    data = resp.json()
    cards = []
    for c in data.get('data', [])[:30]:
        img = ''
        if 'image_uris' in c:
            img = c['image_uris'].get('normal', c['image_uris'].get('small', ''))
        elif 'card_faces' in c and len(c['card_faces']) > 0:
            face = c['card_faces'][0]
            if 'image_uris' in face:
                img = face['image_uris'].get('normal', face['image_uris'].get('small', ''))
        cards.append({
            'external_id': c.get('id', ''),
            'name': c.get('name', ''),
            'image_url': img,
            'set_name': c.get('set_name', ''),
            'set_code': c.get('set', ''),
            'rarity': c.get('rarity', ''),
            'type_line': c.get('type_line', ''),
            'source': 'scryfall',
        })
    return jsonify({
        'cards': cards,
        'total': data.get('total_cards', len(cards)),
        'has_more': data.get('has_more', False),
    })


def _search_pokemon(q, page=1):
    resp = http_requests.get(POKEMON_SEARCH, params={
        'q': f'name:{q}*', 'page': page, 'pageSize': 30,
    }, timeout=10)
    if resp.status_code != 200:
        return jsonify({'cards': [], 'total': 0, 'has_more': False})
    data = resp.json()
    cards = []
    for c in data.get('data', []):
        img = c.get('images', {}).get('large', c.get('images', {}).get('small', ''))
        cards.append({
            'external_id': c.get('id', ''),
            'name': c.get('name', ''),
            'image_url': img,
            'set_name': c.get('set', {}).get('name', ''),
            'set_code': c.get('set', {}).get('id', ''),
            'rarity': c.get('rarity', ''),
            'type_line': ', '.join(c.get('types', [])),
            'source': 'pokemon',
        })
    total = data.get('totalCount', len(cards))
    return jsonify({
        'cards': cards,
        'total': total,
        'has_more': page * 30 < total,
    })


def _search_yugioh(q):
    resp = http_requests.get(YGOPRO_SEARCH, params={
        'fname': q, 'num': 30, 'offset': 0,
    }, timeout=10)
    if resp.status_code != 200:
        return jsonify({'cards': [], 'total': 0, 'has_more': False})
    data = resp.json()
    cards = []
    for c in data.get('data', []):
        imgs = c.get('card_images', [])
        img = imgs[0].get('image_url', '') if imgs else ''
        cards.append({
            'external_id': str(c.get('id', '')),
            'name': c.get('name', ''),
            'image_url': img,
            'set_name': '',
            'set_code': '',
            'rarity': c.get('race', ''),
            'type_line': c.get('type', ''),
            'source': 'yugioh',
        })
    return jsonify({
        'cards': cards,
        'total': len(cards),
        'has_more': False,
    })


@binder_bp.route('/api/external/import', methods=['POST'])
@login_required
def import_external_cards():
    """Import cards from external API data into the Product table."""
    data = request.get_json()
    cards_data = data.get('cards', [])
    binder_id = data.get('binder_id')

    binder = Binder.query.get_or_404(binder_id) if binder_id else None
    if binder and binder.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    from app.models import Category
    imported_ids = []

    for card in cards_data:
        ext_id = card.get('external_id', '')
        source = card.get('source', 'unknown')
        name = card.get('name', 'Unknown Card')
        image_url = card.get('image_url', '')
        set_name = card.get('set_name', '')
        set_code = card.get('set_code', '')
        rarity = card.get('rarity', '')

        # Check if already imported (by name + image to avoid duplicates)
        existing = Product.query.filter_by(name=name, image_url=image_url).first()
        if existing:
            imported_ids.append(existing.id)
            continue

        # Find or create category based on source
        cat_map = {
            'scryfall': 'mtg',
            'pokemon': 'pokemon',
            'yugioh': 'yugioh',
        }
        cat_slug = cat_map.get(source, 'mtg')
        cat = Category.query.filter_by(slug=cat_slug).first()
        if not cat:
            cat_name_map = {'mtg': 'Magic: The Gathering', 'pokemon': 'Pokémon', 'yugioh': 'Yu-Gi-Oh!'}
            cat = Category(name=cat_name_map.get(cat_slug, source), slug=cat_slug)
            db.session.add(cat)
            db.session.flush()

        # Create a slug from the name
        import re
        slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
        # Ensure unique slug
        slug_base = slug
        counter = 1
        while Product.query.filter_by(slug=slug).first():
            slug = f'{slug_base}-{counter}'
            counter += 1

        product = Product(
            name=name,
            slug=slug,
            image_url=image_url,
            set_name=set_name,
            set_code=set_code,
            rarity=rarity,
            card_type=card.get('type_line', ''),
            category_id=cat.id if cat else None,
        )
        db.session.add(product)
        db.session.flush()
        imported_ids.append(product.id)

    db.session.commit()

    # If a binder_id was provided, also add these cards to the binder
    added_to_binder = []
    if binder and imported_ids:
        existing_positions = {bc.position for bc in binder.cards}
        next_pos = 0
        for pid in imported_ids:
            while next_pos in existing_positions:
                next_pos += 1
            bc = BinderCard(
                binder_id=binder.id,
                product_id=pid,
                position=next_pos,
                is_collected=False,
            )
            db.session.add(bc)
            existing_positions.add(next_pos)
            p = Product.query.get(pid)
            added_to_binder.append({
                'id': None,
                'product_id': pid,
                'position': next_pos,
                'name': p.name if p else '',
                'image_url': p.image_url if p else '',
            })
            next_pos += 1
        db.session.commit()

    return jsonify({
        'imported_ids': imported_ids,
        'count': len(imported_ids),
        'added_to_binder': added_to_binder,
    })
