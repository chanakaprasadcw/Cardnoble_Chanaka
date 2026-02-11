from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required
from app import db
from app.models import Product, CartItem, Stock, Order, OrderItem
import uuid

api_bp = Blueprint('api', __name__)


@api_bp.route('/products')
def get_products():
    """Get products (paginated)."""
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 24, type=int)
    category = request.args.get('category')
    search = request.args.get('q')
    
    query = Product.query
    
    if category:
        query = query.filter(Product.category.has(slug=category))
    
    if search:
        query = query.filter(Product.name.ilike(f'%{search}%'))
    
    products = query.paginate(page=page, per_page=per_page, error_out=False)
    
    return jsonify({
        'products': [{
            'id': p.id,
            'name': p.name,
            'slug': p.slug,
            'set_name': p.set_name,
            'image_url': p.image_url,
            'min_price': p.min_price,
            'total_quantity': p.total_quantity
        } for p in products.items],
        'total': products.total,
        'pages': products.pages,
        'current_page': products.page
    })


@api_bp.route('/products/<int:id>')
def get_product(id):
    """Get single product details."""
    product = Product.query.get_or_404(id)
    
    return jsonify({
        'id': product.id,
        'name': product.name,
        'slug': product.slug,
        'set_code': product.set_code,
        'set_name': product.set_name,
        'image_url': product.image_url,
        'rarity': product.rarity,
        'card_type': product.card_type,
        'stocks': [{
            'id': s.id,
            'condition': s.condition,
            'quantity': s.quantity,
            'price': s.price
        } for s in product.stocks]
    })


@api_bp.route('/cart', methods=['GET'])
@login_required
def get_cart():
    """Get current user's cart."""
    items = CartItem.query.filter_by(user_id=current_user.id).all()
    
    return jsonify({
        'items': [{
            'id': item.id,
            'product_id': item.product_id,
            'product_name': item.product.name,
            'product_image': item.product.image_url,
            'condition': item.stock.condition,
            'quantity': item.quantity,
            'price': item.stock.price,
            'subtotal': item.stock.price * item.quantity
        } for item in items],
        'total': sum(item.stock.price * item.quantity for item in items),
        'count': len(items)
    })


@api_bp.route('/cart', methods=['POST'])
@api_bp.route('/cart/add', methods=['POST'])
@login_required
def add_to_cart():
    """Add item to cart."""
    data = request.get_json()
    product_id = data.get('product_id')
    stock_id = data.get('stock_id')
    quantity = data.get('quantity', 1)
    
    stock = Stock.query.get_or_404(stock_id)
    
    if stock.quantity < quantity:
        return jsonify({'error': 'Not enough stock'}), 400
    
    # Check if already in cart
    existing = CartItem.query.filter_by(
        user_id=current_user.id,
        product_id=product_id,
        stock_id=stock_id
    ).first()
    
    if existing:
        existing.quantity += quantity
    else:
        cart_item = CartItem(
            user_id=current_user.id,
            product_id=product_id,
            stock_id=stock_id,
            quantity=quantity
        )
        db.session.add(cart_item)
    
    db.session.commit()
    
    # Calculate cart count
    cart_count = CartItem.query.filter_by(user_id=current_user.id).count()
    
    return jsonify({'success': True, 'message': 'Added to cart', 'cart_count': cart_count})


@api_bp.route('/cart/<int:id>', methods=['PUT'])
@login_required
def update_cart_item(id):
    """Update cart item quantity."""
    item = CartItem.query.get_or_404(id)
    
    if item.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    
    data = request.get_json()
    quantity = data.get('quantity', 1)
    
    if quantity <= 0:
        db.session.delete(item)
    else:
        item.quantity = quantity
    
    db.session.commit()
    
    return jsonify({'success': True})


@api_bp.route('/cart/<int:id>', methods=['DELETE'])
@login_required
def remove_from_cart(id):
    """Remove item from cart."""
    item = CartItem.query.get_or_404(id)
    
    if item.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    
    db.session.delete(item)
    db.session.commit()
    
    return jsonify({'success': True})


@api_bp.route('/checkout', methods=['POST'])
@login_required
def checkout():
    """Process checkout and create order."""
    data = request.get_json()
    
    cart_items = CartItem.query.filter_by(user_id=current_user.id).all()
    
    if not cart_items:
        return jsonify({'error': 'Cart is empty'}), 400
    
    total = sum(item.stock.price * item.quantity for item in cart_items)
    
    # Create order
    order = Order(
        code=f'ORD-{uuid.uuid4().hex[:8].upper()}',
        user_id=current_user.id,
        total=total,
        shipping_name=data.get('shipping_name'),
        shipping_address=data.get('shipping_address'),
        payment_method=data.get('payment_method', 'cod')
    )
    db.session.add(order)
    db.session.flush()
    
    # Create order items and update stock
    for item in cart_items:
        order_item = OrderItem(
            order_id=order.id,
            product_id=item.product_id,
            quantity=item.quantity,
            price=item.stock.price
        )
        db.session.add(order_item)
        
        # Reduce stock
        item.stock.quantity -= item.quantity
        
        # Remove from cart
        db.session.delete(item)
    
    db.session.commit()
    
    return jsonify({
        'success': True,
        'order_code': order.code,
        'total': total
    })
