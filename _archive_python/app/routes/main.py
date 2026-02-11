from flask import Blueprint, render_template, request, jsonify
from flask_login import current_user
from app import db
from app.models import Product, Category, Banner, CartItem

main_bp = Blueprint('main', __name__)


@main_bp.app_context_processor
def inject_global_vars():
    """Inject global variables into all templates."""
    categories = Category.query.all()
    cart_count = 0
    if current_user.is_authenticated:
        cart_count = CartItem.query.filter_by(user_id=current_user.id).count()
    return dict(categories=categories, cart_count=cart_count)


@main_bp.route('/')
def index():
    """Home page with banners and featured products."""
    banners = Banner.query.filter_by(is_active=True).order_by(Banner.ordering).all()
    products = Product.query.limit(32).all()
    categories = Category.query.all()
    
    cart_count = 0
    if current_user.is_authenticated:
        cart_count = CartItem.query.filter_by(user_id=current_user.id).count()
    
    return render_template('storefront/index.html',
                           banners=banners,
                           products=products,
                           categories=categories,
                           cart_count=cart_count)


@main_bp.route('/products')
def products():
    """Product listing page with filters."""
    page = request.args.get('page', 1, type=int)
    category = request.args.get('category')
    search = request.args.get('q')
    
    query = Product.query
    
    if category:
        query = query.join(Category).filter(Category.slug == category)
    
    if search:
        query = query.filter(Product.name.ilike(f'%{search}%'))
    
    products = query.paginate(page=page, per_page=24, error_out=False)
    categories = Category.query.all()
    
    return render_template('storefront/products.html',
                           products=products,
                           categories=categories)


@main_bp.route('/products/<slug>')
def product_detail(slug):
    """Single product detail page."""
    product = Product.query.filter_by(slug=slug).first_or_404()
    return render_template('storefront/product_detail.html', product=product)


@main_bp.route('/sets')
def sets():
    """Browse products by set."""
    from sqlalchemy import func
    sets_data = db.session.query(
        Product.set_code,
        Product.set_name,
        func.count(Product.id).label('product_count')
    ).group_by(Product.set_code, Product.set_name).order_by(Product.set_name).all()
    return render_template('storefront/sets.html', sets=sets_data)



@main_bp.route('/support')
def support():
    """Support page with FAQ and contact form."""
    return render_template('storefront/support.html')


@main_bp.route('/cart')
def cart():
    """Shopping cart page."""
    if not current_user.is_authenticated:
        return render_template('storefront/cart.html', items=[], total=0)
    
    items = CartItem.query.filter_by(user_id=current_user.id).all()
    total = sum(item.stock.price * item.quantity for item in items)
    
    return render_template('storefront/cart.html', items=items, total=total)


@main_bp.route('/checkout')
def checkout():
    """Checkout page."""
    if not current_user.is_authenticated:
        return render_template('auth/login.html')
    
    items = CartItem.query.filter_by(user_id=current_user.id).all()
    total = sum(item.stock.price * item.quantity for item in items)
    
    return render_template('storefront/checkout.html', items=items, total=total)

