from flask import Blueprint, render_template, redirect, url_for, flash, request
from flask_login import login_required, current_user
from functools import wraps
from app import db
from app.models import Product, Category, Order, User, Stock, Banner

admin_bp = Blueprint('admin', __name__)


def admin_required(f):
    """Decorator to require admin role."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated or not current_user.is_admin:
            flash('Admin access required', 'error')
            return redirect(url_for('auth.login'))
        return f(*args, **kwargs)
    return decorated_function


@admin_bp.route('/login', methods=['GET', 'POST'])
def login():
    """Admin login page."""
    if current_user.is_authenticated and current_user.is_admin:
        return redirect(url_for('admin.dashboard'))
    
    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')
        
        user = User.query.filter_by(email=email).first()
        
        if user and user.check_password(password) and user.is_admin:
            from flask_login import login_user
            login_user(user)
            return redirect(url_for('admin.dashboard'))
        
        flash('Invalid credentials or not an admin', 'error')
    
    return render_template('admin/login.html')


@admin_bp.route('/dashboard')
@login_required
@admin_required
def dashboard():
    """Admin dashboard with metrics."""
    total_products = Product.query.count()
    total_orders = Order.query.count()
    total_customers = User.query.filter_by(role='customer').count()
    
    # Calculate totals
    total_sales = db.session.query(db.func.sum(Order.total)).filter(
        Order.status.in_(['paid', 'shipped', 'delivered'])
    ).scalar() or 0
    
    total_stock = db.session.query(db.func.sum(Stock.quantity)).scalar() or 0
    
    recent_orders = Order.query.order_by(Order.created_at.desc()).limit(10).all()
    
    return render_template('admin/dashboard.html',
                           total_products=total_products,
                           total_orders=total_orders,
                           total_customers=total_customers,
                           total_sales=total_sales,
                           total_stock=total_stock,
                           recent_orders=recent_orders)


@admin_bp.route('/inventory')
@login_required
@admin_required
def inventory():
    """Inventory management page."""
    page = request.args.get('page', 1, type=int)
    category = request.args.get('category')
    
    query = Product.query
    if category:
        query = query.join(Category).filter(Category.slug == category)
    
    products = query.paginate(page=page, per_page=50, error_out=False)
    categories = Category.query.all()
    
    return render_template('admin/inventory.html',
                           products=products,
                           categories=categories)


@admin_bp.route('/inventory/add', methods=['GET', 'POST'])
@login_required
@admin_required
def add_product():
    """Add new product."""
    if request.method == 'POST':
        product = Product(
            name=request.form.get('name'),
            slug=request.form.get('slug'),
            set_code=request.form.get('set_code'),
            set_name=request.form.get('set_name'),
            category_id=request.form.get('category_id'),
            image_url=request.form.get('image_url'),
            rarity=request.form.get('rarity'),
            card_type=request.form.get('card_type')
        )
        db.session.add(product)
        db.session.commit()
        
        # Add initial stock
        stock = Stock(
            product_id=product.id,
            condition='NM',
            quantity=request.form.get('quantity', 0, type=int),
            price=request.form.get('price', 0, type=float)
        )
        db.session.add(stock)
        db.session.commit()
        
        flash('Product added successfully', 'success')
        return redirect(url_for('admin.inventory'))
    
    categories = Category.query.all()
    return render_template('admin/add_product.html', categories=categories)


@admin_bp.route('/inventory/<int:id>/edit', methods=['GET', 'POST'])
@login_required
@admin_required
def edit_product(id):
    """Edit product."""
    product = Product.query.get_or_404(id)
    
    if request.method == 'POST':
        product.name = request.form.get('name')
        product.set_code = request.form.get('set_code')
        product.set_name = request.form.get('set_name')
        product.image_url = request.form.get('image_url')
        product.rarity = request.form.get('rarity')
        db.session.commit()
        
        flash('Product updated', 'success')
        return redirect(url_for('admin.inventory'))
    
    categories = Category.query.all()
    return render_template('admin/edit_product.html', product=product, categories=categories)


@admin_bp.route('/orders')
@login_required
@admin_required
def orders():
    """Order management page."""
    page = request.args.get('page', 1, type=int)
    status = request.args.get('status')
    
    query = Order.query
    if status:
        query = query.filter_by(status=status)
    
    orders = query.order_by(Order.created_at.desc()).paginate(page=page, per_page=20, error_out=False)
    
    return render_template('admin/orders.html', orders=orders)


@admin_bp.route('/orders/<int:id>')
@login_required
@admin_required
def order_detail(id):
    """Order detail page."""
    order = Order.query.get_or_404(id)
    return render_template('admin/order_detail.html', order=order)


@admin_bp.route('/orders/<int:id>/update-status', methods=['POST'])
@login_required
@admin_required
def update_order_status(id):
    """Update order status."""
    order = Order.query.get_or_404(id)
    order.status = request.form.get('status')
    db.session.commit()
    flash('Order status updated', 'success')
    return redirect(url_for('admin.order_detail', id=id))


@admin_bp.route('/settings')
@login_required
@admin_required
def settings():
    """Store settings page."""
    return render_template('admin/settings.html')


@admin_bp.route('/settings/domain')
@login_required
@admin_required
def settings_domain():
    """Store domain settings."""
    return render_template('admin/settings_domain.html')


@admin_bp.route('/settings/theme')
@login_required
@admin_required
def settings_theme():
    """Store theme settings."""
    return render_template('admin/settings_theme.html')


@admin_bp.route('/settings/order-status')
@login_required
@admin_required
def settings_order_status():
    """Order status settings."""
    return render_template('admin/settings_order_status.html')


@admin_bp.route('/manage-stocks/stock-in')
@login_required
@admin_required
def stock_in():
    """Stock-in orders."""
    from app.models import StockOrder
    orders = StockOrder.query.filter_by(order_type='stock_in').order_by(StockOrder.created_at.desc()).all()
    return render_template('admin/stock_in.html', orders=orders)


@admin_bp.route('/manage-stocks/stock-out')
@login_required
@admin_required
def stock_out():
    """Stock-out orders."""
    from app.models import StockOrder
    orders = StockOrder.query.filter_by(order_type='stock_out').order_by(StockOrder.created_at.desc()).all()
    return render_template('admin/stock_out.html', orders=orders)


@admin_bp.route('/messages')
@login_required
@admin_required
def messages():
    """Customer messages."""
    from app.models import Message
    messages = Message.query.order_by(Message.created_at.desc()).all()
    return render_template('admin/messages.html', messages=messages)


@admin_bp.route('/wallet')
@login_required
@admin_required
def wallet():
    """Wallet and transactions."""
    from app.models import WalletTransaction
    transactions = WalletTransaction.query.order_by(WalletTransaction.created_at.desc()).all()
    balance = sum(t.amount if t.transaction_type == 'credit' else -t.amount for t in transactions)
    return render_template('admin/wallet.html', transactions=transactions, balance=balance)


@admin_bp.route('/boxes')
@login_required
@admin_required
def boxes():
    """Product boxes management."""
    from app.models import Box
    boxes = Box.query.all()
    return render_template('admin/boxes.html', boxes=boxes)


@admin_bp.route('/promotions')
@login_required
@admin_required
def promotions():
    """Promotions management."""
    from app.models import Promotion
    promotions = Promotion.query.order_by(Promotion.created_at.desc()).all()
    categories = Category.query.all()
    return render_template('admin/promotions.html', promotions=promotions, categories=categories)


@admin_bp.route('/coupons')
@login_required
@admin_required
def coupons():
    """Coupon management."""
    from app.models import Coupon
    coupons = Coupon.query.order_by(Coupon.created_at.desc()).all()
    return render_template('admin/coupons.html', coupons=coupons)


@admin_bp.route('/cms/banners')
@login_required
@admin_required
def cms_banners():
    """Banner management."""
    banners = Banner.query.order_by(Banner.ordering).all()
    return render_template('admin/cms_banners.html', banners=banners)


@admin_bp.route('/cms/thumbnails')
@login_required
@admin_required
def cms_thumbnails():
    """Thumbnail management."""
    categories = Category.query.all()
    return render_template('admin/cms_thumbnails.html', categories=categories)


@admin_bp.route('/cms/binders')
@login_required
@admin_required
def cms_binders():
    """Binders management."""
    return render_template('admin/cms_binders.html')


@admin_bp.route('/cms/games')
@login_required
@admin_required
def cms_games():
    """Games management."""
    categories = Category.query.all()
    return render_template('admin/cms_games.html', categories=categories)


@admin_bp.route('/testimonials')
@login_required
@admin_required
def testimonials():
    """Testimonials management."""
    from app.models import Testimonial
    testimonials = Testimonial.query.order_by(Testimonial.created_at.desc()).all()
    return render_template('admin/testimonials.html', testimonials=testimonials)


@admin_bp.route('/tickets')
@login_required
@admin_required
def tickets():
    """Support tickets."""
    from app.models import Ticket
    tickets = Ticket.query.order_by(Ticket.created_at.desc()).all()
    return render_template('admin/tickets.html', tickets=tickets)


@admin_bp.route('/tutorials')
@login_required
@admin_required
def tutorials():
    """Tutorials page."""
    return render_template('admin/tutorials.html')


@admin_bp.route('/sales-report')
@login_required
@admin_required
def sales_report():
    """Sales report and analytics."""
    from sqlalchemy import func
    
    # Calculate metrics
    total_revenue = db.session.query(func.sum(Order.total)).filter(
        Order.status.in_(['paid', 'shipped', 'delivered'])
    ).scalar() or 0
    
    total_orders = Order.query.filter(
        Order.status.in_(['paid', 'shipped', 'delivered'])
    ).count()
    
    avg_order_value = total_revenue / total_orders if total_orders > 0 else 0
    items_sold = total_orders * 2  # Approximate
    
    # Recent orders
    recent_orders = Order.query.order_by(Order.created_at.desc()).limit(10).all()
    
    # Top products (placeholder)
    top_products = []
    
    # Categories sales (placeholder)
    categories_sales = [
        {'name': 'MTG', 'percentage': 40},
        {'name': 'Pokémon', 'percentage': 30},
        {'name': 'Yu-Gi-Oh', 'percentage': 20},
        {'name': 'Other', 'percentage': 10}
    ]
    
    return render_template('admin/sales_report.html',
                           total_revenue=total_revenue,
                           total_orders=total_orders,
                           avg_order_value=avg_order_value,
                           items_sold=items_sold,
                           recent_orders=recent_orders,
                           top_products=top_products,
                           categories_sales=categories_sales)


@admin_bp.route('/payment-shipping')
@login_required
@admin_required
def payment_shipping():
    """Payment and shipping settings."""
    return render_template('admin/payment_shipping.html')


# ===== COUPON CRUD =====
@admin_bp.route('/coupons/create', methods=['POST'])
@login_required
@admin_required
def create_coupon():
    """Create new coupon."""
    from app.models import Coupon
    from datetime import datetime
    
    expires_at = None
    if request.form.get('expires_at'):
        expires_at = datetime.strptime(request.form.get('expires_at'), '%Y-%m-%d')
    
    coupon = Coupon(
        code=request.form.get('code').upper(),
        discount_type=request.form.get('discount_type'),
        discount_value=float(request.form.get('discount_value')),
        min_order=float(request.form.get('min_order') or 0),
        max_uses=int(request.form.get('max_uses') or 0),
        expires_at=expires_at,
        is_active=True
    )
    db.session.add(coupon)
    db.session.commit()
    flash('Coupon created successfully!', 'success')
    return redirect(url_for('admin.coupons'))


@admin_bp.route('/coupons/<int:id>/toggle', methods=['POST'])
@login_required
@admin_required
def toggle_coupon(id):
    """Toggle coupon active status."""
    from app.models import Coupon
    coupon = Coupon.query.get_or_404(id)
    coupon.is_active = not coupon.is_active
    db.session.commit()
    return redirect(url_for('admin.coupons'))


@admin_bp.route('/coupons/<int:id>/edit', methods=['GET', 'POST'])
@login_required
@admin_required
def edit_coupon(id):
    """Edit coupon."""
    from app.models import Coupon
    coupon = Coupon.query.get_or_404(id)
    
    if request.method == 'POST':
        coupon.code = request.form.get('code').upper()
        coupon.discount_type = request.form.get('discount_type')
        coupon.discount_value = float(request.form.get('discount_value'))
        coupon.min_order = float(request.form.get('min_order') or 0)
        coupon.max_uses = int(request.form.get('max_uses') or 0)
        db.session.commit()
        flash('Coupon updated!', 'success')
        return redirect(url_for('admin.coupons'))
    
    return render_template('admin/edit_coupon.html', coupon=coupon)


@admin_bp.route('/coupons/<int:id>/delete', methods=['POST'])
@login_required
@admin_required
def delete_coupon(id):
    """Delete coupon."""
    from app.models import Coupon
    coupon = Coupon.query.get_or_404(id)
    db.session.delete(coupon)
    db.session.commit()
    flash('Coupon deleted!', 'success')
    return redirect(url_for('admin.coupons'))


# ===== PROMOTION CRUD =====
@admin_bp.route('/promotions/create', methods=['POST'])
@login_required
@admin_required
def create_promotion():
    """Create new promotion."""
    from app.models import Promotion
    from datetime import datetime
    
    starts_at = None
    ends_at = None
    if request.form.get('starts_at'):
        starts_at = datetime.strptime(request.form.get('starts_at'), '%Y-%m-%d')
    if request.form.get('ends_at'):
        ends_at = datetime.strptime(request.form.get('ends_at'), '%Y-%m-%d')
    
    promotion = Promotion(
        name=request.form.get('name'),
        description=request.form.get('description'),
        discount_percentage=float(request.form.get('discount_percentage')),
        category_id=int(request.form.get('category_id')) if request.form.get('category_id') else None,
        starts_at=starts_at,
        ends_at=ends_at,
        is_active=True
    )
    db.session.add(promotion)
    db.session.commit()
    flash('Promotion created!', 'success')
    return redirect(url_for('admin.promotions'))


@admin_bp.route('/promotions/<int:id>/toggle', methods=['POST'])
@login_required
@admin_required
def toggle_promotion(id):
    """Toggle promotion active status."""
    from app.models import Promotion
    promo = Promotion.query.get_or_404(id)
    promo.is_active = not promo.is_active
    db.session.commit()
    return redirect(url_for('admin.promotions'))


@admin_bp.route('/promotions/<int:id>/edit', methods=['GET', 'POST'])
@login_required
@admin_required
def edit_promotion(id):
    """Edit promotion."""
    from app.models import Promotion
    promo = Promotion.query.get_or_404(id)
    categories = Category.query.all()
    
    if request.method == 'POST':
        promo.name = request.form.get('name')
        promo.description = request.form.get('description')
        promo.discount_percentage = float(request.form.get('discount_percentage'))
        promo.category_id = int(request.form.get('category_id')) if request.form.get('category_id') else None
        db.session.commit()
        flash('Promotion updated!', 'success')
        return redirect(url_for('admin.promotions'))
    
    return render_template('admin/edit_promotion.html', promotion=promo, categories=categories)


@admin_bp.route('/promotions/<int:id>/delete', methods=['POST'])
@login_required
@admin_required
def delete_promotion(id):
    """Delete promotion."""
    from app.models import Promotion
    promo = Promotion.query.get_or_404(id)
    db.session.delete(promo)
    db.session.commit()
    flash('Promotion deleted!', 'success')
    return redirect(url_for('admin.promotions'))


# ===== TESTIMONIAL CRUD =====
@admin_bp.route('/testimonials/create', methods=['POST'])
@login_required
@admin_required
def create_testimonial():
    """Create new testimonial."""
    from app.models import Testimonial
    
    testimonial = Testimonial(
        customer_name=request.form.get('customer_name'),
        content=request.form.get('content'),
        rating=int(request.form.get('rating', 5)),
        is_approved=bool(request.form.get('is_approved'))
    )
    db.session.add(testimonial)
    db.session.commit()
    flash('Testimonial added!', 'success')
    return redirect(url_for('admin.testimonials'))


@admin_bp.route('/testimonials/<int:id>/approve', methods=['POST'])
@login_required
@admin_required
def approve_testimonial(id):
    """Approve testimonial."""
    from app.models import Testimonial
    t = Testimonial.query.get_or_404(id)
    t.is_approved = True
    db.session.commit()
    return redirect(url_for('admin.testimonials'))


@admin_bp.route('/testimonials/<int:id>/unapprove', methods=['POST'])
@login_required
@admin_required
def unapprove_testimonial(id):
    """Unapprove testimonial."""
    from app.models import Testimonial
    t = Testimonial.query.get_or_404(id)
    t.is_approved = False
    db.session.commit()
    return redirect(url_for('admin.testimonials'))


@admin_bp.route('/testimonials/<int:id>/delete', methods=['POST'])
@login_required
@admin_required
def delete_testimonial(id):
    """Delete testimonial."""
    from app.models import Testimonial
    t = Testimonial.query.get_or_404(id)
    db.session.delete(t)
    db.session.commit()
    flash('Testimonial deleted!', 'success')
    return redirect(url_for('admin.testimonials'))


# ===== MESSAGE CRUD =====
@admin_bp.route('/messages/<int:id>/read', methods=['POST'])
@login_required
@admin_required
def mark_message_read(id):
    """Mark message as read."""
    from app.models import Message
    msg = Message.query.get_or_404(id)
    msg.is_read = True
    db.session.commit()
    return redirect(url_for('admin.messages'))


@admin_bp.route('/messages/reply', methods=['POST'])
@login_required
@admin_required
def reply_message():
    """Reply to message (for now just mark as read)."""
    from app.models import Message
    message_id = request.form.get('message_id')
    msg = Message.query.get_or_404(message_id)
    msg.is_read = True
    db.session.commit()
    flash('Reply sent!', 'success')
    return redirect(url_for('admin.messages'))


@admin_bp.route('/messages/<int:id>/delete', methods=['POST'])
@login_required
@admin_required
def delete_message(id):
    """Delete message."""
    from app.models import Message
    msg = Message.query.get_or_404(id)
    db.session.delete(msg)
    db.session.commit()
    flash('Message deleted!', 'success')
    return redirect(url_for('admin.messages'))


# ===== WALLET CRUD =====
@admin_bp.route('/wallet/add', methods=['POST'])
@login_required
@admin_required
def add_wallet_funds():
    """Add funds to wallet."""
    from app.models import WalletTransaction
    import uuid
    
    tx = WalletTransaction(
        transaction_type='credit',
        amount=float(request.form.get('amount')),
        description=request.form.get('description') or 'Manual deposit',
        reference=f'MAN-{uuid.uuid4().hex[:8].upper()}'
    )
    db.session.add(tx)
    db.session.commit()
    flash('Funds added!', 'success')
    return redirect(url_for('admin.wallet'))


@admin_bp.route('/wallet/withdraw', methods=['POST'])
@login_required
@admin_required
def withdraw_wallet_funds():
    """Withdraw from wallet."""
    from app.models import WalletTransaction
    import uuid
    
    tx = WalletTransaction(
        transaction_type='debit',
        amount=float(request.form.get('amount')),
        description=request.form.get('description') or 'Withdrawal',
        reference=f'WDR-{uuid.uuid4().hex[:8].upper()}'
    )
    db.session.add(tx)
    db.session.commit()
    flash('Withdrawal processed!', 'success')
    return redirect(url_for('admin.wallet'))


# ===== BANNER CRUD =====
@admin_bp.route('/cms/banners/create', methods=['POST'])
@login_required
@admin_required
def create_banner():
    """Create new banner."""
    banner = Banner(
        title=request.form.get('title'),
        image_url=request.form.get('image_url'),
        url=request.form.get('url'),
        ordering=int(request.form.get('ordering') or 0),
        is_active=bool(request.form.get('is_active'))
    )
    db.session.add(banner)
    db.session.commit()
    flash('Banner created!', 'success')
    return redirect(url_for('admin.cms_banners'))


@admin_bp.route('/cms/banners/<int:id>/toggle', methods=['POST'])
@login_required
@admin_required
def toggle_banner(id):
    """Toggle banner active status."""
    banner = Banner.query.get_or_404(id)
    banner.is_active = not banner.is_active
    db.session.commit()
    return redirect(url_for('admin.cms_banners'))


@admin_bp.route('/cms/banners/<int:id>/edit', methods=['GET', 'POST'])
@login_required
@admin_required
def edit_banner(id):
    """Edit banner."""
    banner = Banner.query.get_or_404(id)
    
    if request.method == 'POST':
        banner.title = request.form.get('title')
        banner.image_url = request.form.get('image_url')
        banner.url = request.form.get('url')
        banner.ordering = int(request.form.get('ordering') or 0)
        db.session.commit()
        flash('Banner updated!', 'success')
        return redirect(url_for('admin.cms_banners'))
    
    return render_template('admin/edit_banner.html', banner=banner)


@admin_bp.route('/cms/banners/<int:id>/delete', methods=['POST'])
@login_required
@admin_required
def delete_banner(id):
    """Delete banner."""
    banner = Banner.query.get_or_404(id)
    db.session.delete(banner)
    db.session.commit()
    flash('Banner deleted!', 'success')
    return redirect(url_for('admin.cms_banners'))


# ===== BOX CRUD =====
@admin_bp.route('/boxes/create', methods=['POST'])
@login_required
@admin_required
def create_box():
    """Create new box."""
    from app.models import Box
    
    box = Box(
        name=request.form.get('name'),
        game=request.form.get('game'),
        price=float(request.form.get('price')),
        quantity=int(request.form.get('quantity') or 1),
        image_url=request.form.get('image_url'),
        description=request.form.get('description'),
        is_active=True
    )
    db.session.add(box)
    db.session.commit()
    flash('Box created!', 'success')
    return redirect(url_for('admin.boxes'))


@admin_bp.route('/boxes/<int:id>/edit', methods=['GET', 'POST'])
@login_required
@admin_required
def edit_box(id):
    """Edit box."""
    from app.models import Box
    box = Box.query.get_or_404(id)
    
    if request.method == 'POST':
        box.name = request.form.get('name')
        box.game = request.form.get('game')
        box.price = float(request.form.get('price'))
        box.quantity = int(request.form.get('quantity') or 1)
        box.image_url = request.form.get('image_url')
        box.description = request.form.get('description')
        db.session.commit()
        flash('Box updated!', 'success')
        return redirect(url_for('admin.boxes'))
    
    return render_template('admin/edit_box.html', box=box)


@admin_bp.route('/boxes/<int:id>/delete', methods=['POST'])
@login_required
@admin_required
def delete_box(id):
    """Delete box."""
    from app.models import Box
    box = Box.query.get_or_404(id)
    db.session.delete(box)
    db.session.commit()
    flash('Box deleted!', 'success')
    return redirect(url_for('admin.boxes'))


# ===== TICKET CRUD =====
@admin_bp.route('/tickets/<int:id>')
@login_required
@admin_required
def view_ticket(id):
    """View ticket details."""
    from app.models import Ticket
    ticket = Ticket.query.get_or_404(id)
    return render_template('admin/view_ticket.html', ticket=ticket)


@admin_bp.route('/tickets/<int:id>/status', methods=['POST'])
@login_required
@admin_required
def update_ticket_status(id):
    """Update ticket status."""
    from app.models import Ticket
    ticket = Ticket.query.get_or_404(id)
    ticket.status = request.form.get('status')
    db.session.commit()
    return redirect(url_for('admin.tickets'))


@admin_bp.route('/tickets/<int:id>/delete', methods=['POST'])
@login_required
@admin_required
def delete_ticket(id):
    """Delete ticket."""
    from app.models import Ticket
    ticket = Ticket.query.get_or_404(id)
    db.session.delete(ticket)
    db.session.commit()
    flash('Ticket deleted!', 'success')
    return redirect(url_for('admin.tickets'))


# ===== STOCK ORDER =====
@admin_bp.route('/manage-stocks/create/<type>')
@login_required
@admin_required
def create_stock_order(type):
    """Create stock in/out order form."""
    products = Product.query.all()
    # Serialize products for JavaScript
    products_data = [
        {
            'id': p.id,
            'name': p.name,
            'set_name': p.set_name,
            'set_code': p.set_code
        } for p in products
    ]
    return render_template('admin/create_stock_order.html', 
                           order_type=type, 
                           products=products_data)


@admin_bp.route('/manage-stocks/save', methods=['POST'])
@login_required
@admin_required
def save_stock_order():
    """Save stock order with items."""
    from app.models import StockOrder, StockOrderItem, Stock
    import uuid
    
    order_type = request.form.get('order_type')
    reference = request.form.get('reference') or f"{'STK' if order_type == 'stock_in' else 'OUT'}-{uuid.uuid4().hex[:8].upper()}"
    notes = request.form.get('notes')
    
    # Create stock order
    order = StockOrder(
        order_type=order_type,
        reference=reference,
        notes=notes,
        status='completed'
    )
    db.session.add(order)
    db.session.flush()  # Get order ID
    
    # Process items
    product_ids = request.form.getlist('product_ids[]')
    conditions = request.form.getlist('conditions[]')
    quantities = request.form.getlist('quantities[]')
    
    if order_type == 'stock_in':
        costs = request.form.getlist('costs[]')
        for i, product_id in enumerate(product_ids):
            quantity = int(quantities[i])
            condition = conditions[i]
            cost = float(costs[i]) if i < len(costs) else 0
            
            # Create order item
            item = StockOrderItem(
                stock_order_id=order.id,
                product_id=int(product_id),
                quantity=quantity,
                condition=condition,
                cost_per_item=cost
            )
            db.session.add(item)
            
            # Update stock
            stock = Stock.query.filter_by(
                product_id=int(product_id),
                condition=condition
            ).first()
            
            if stock:
                stock.quantity += quantity
            else:
                stock = Stock(
                    product_id=int(product_id),
                    condition=condition,
                    quantity=quantity,
                    price=0
                )
                db.session.add(stock)
    else:
        # Stock-out
        reasons = request.form.getlist('reasons[]')
        for i, product_id in enumerate(product_ids):
            quantity = int(quantities[i])
            condition = conditions[i]
            reason = reasons[i] if i < len(reasons) else 'other'
            
            # Create order item
            item = StockOrderItem(
                stock_order_id=order.id,
                product_id=int(product_id),
                quantity=quantity,
                condition=condition,
                notes=reason
            )
            db.session.add(item)
            
            # Reduce stock
            stock = Stock.query.filter_by(
                product_id=int(product_id),
                condition=condition
            ).first()
            
            if stock:
                stock.quantity = max(0, stock.quantity - quantity)
    
    db.session.commit()
    flash(f'Stock {"in" if order_type == "stock_in" else "out"} order created! Reference: {reference}', 'success')
    
    return redirect(url_for('admin.stock_in') if order_type == 'stock_in' else url_for('admin.stock_out'))


@admin_bp.route('/manage-stocks/orders/<int:id>')
@login_required
@admin_required
def view_stock_order(id):
    """View stock order details."""
    from app.models import StockOrder
    order = StockOrder.query.get_or_404(id)
    
    # Calculate total cost (cost_per_item * quantity for each item)
    total_cost = sum((item.cost_per_item or 0) * item.quantity for item in order.items)
    
    return render_template('admin/view_stock_order.html', order=order, total_cost=total_cost)
