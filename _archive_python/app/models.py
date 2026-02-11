from app import db, login_manager
from flask_login import UserMixin
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash


@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))


class User(UserMixin, db.Model):
    __tablename__ = 'users'
    
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    name = db.Column(db.String(100))
    role = db.Column(db.String(20), default='customer')  # customer, admin
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    orders = db.relationship('Order', backref='user', lazy=True)
    cart_items = db.relationship('CartItem', backref='user', lazy=True)
    
    def set_password(self, password):
        self.password_hash = generate_password_hash(password, method='pbkdf2:sha256')
    
    def check_password(self, password):
        return check_password_hash(self.password_hash, password)
    
    @property
    def is_admin(self):
        return self.role == 'admin'


class Category(db.Model):
    __tablename__ = 'categories'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False)  # MTG, Pokemon, etc.
    slug = db.Column(db.String(50), unique=True, nullable=False)
    
    products = db.relationship('Product', backref='category', lazy=True)


class Product(db.Model):
    __tablename__ = 'products'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    slug = db.Column(db.String(200), unique=True)
    set_code = db.Column(db.String(20))
    set_name = db.Column(db.String(100))
    category_id = db.Column(db.Integer, db.ForeignKey('categories.id'))
    image_url = db.Column(db.String(500))
    rarity = db.Column(db.String(20))
    card_type = db.Column(db.String(100))
    language = db.Column(db.String(10), default='EN')
    is_foil = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    stocks = db.relationship('Stock', backref='product', lazy=True)
    
    @property
    def total_quantity(self):
        return sum(s.quantity for s in self.stocks)
    
    @property
    def min_price(self):
        prices = [s.price for s in self.stocks if s.quantity > 0]
        return min(prices) if prices else 0


class Stock(db.Model):
    __tablename__ = 'stocks'
    
    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id'), nullable=False)
    condition = db.Column(db.String(20), default='NM')  # NM, LP, MP, HP
    quantity = db.Column(db.Integer, default=0)
    price = db.Column(db.Float, nullable=False)


class CartItem(db.Model):
    __tablename__ = 'cart_items'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id'), nullable=False)
    stock_id = db.Column(db.Integer, db.ForeignKey('stocks.id'), nullable=False)
    quantity = db.Column(db.Integer, default=1)
    
    product = db.relationship('Product')
    stock = db.relationship('Stock')


class Order(db.Model):
    __tablename__ = 'orders'
    
    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(20), unique=True, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    status = db.Column(db.String(20), default='pending')  # pending, paid, shipped, delivered, cancelled
    total = db.Column(db.Float, nullable=False)
    shipping_name = db.Column(db.String(100))
    shipping_address = db.Column(db.Text)
    payment_method = db.Column(db.String(50))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    items = db.relationship('OrderItem', backref='order', lazy=True)


class OrderItem(db.Model):
    __tablename__ = 'order_items'
    
    id = db.Column(db.Integer, primary_key=True)
    order_id = db.Column(db.Integer, db.ForeignKey('orders.id'), nullable=False)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id'), nullable=False)
    quantity = db.Column(db.Integer, nullable=False)
    price = db.Column(db.Float, nullable=False)
    
    product = db.relationship('Product')


class Banner(db.Model):
    __tablename__ = 'banners'
    
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(100))
    image_url = db.Column(db.String(500))
    url = db.Column(db.String(500))
    is_active = db.Column(db.Boolean, default=True)
    ordering = db.Column(db.Integer, default=0)


class Message(db.Model):
    __tablename__ = 'messages'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    subject = db.Column(db.String(200))
    content = db.Column(db.Text)
    is_read = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    user = db.relationship('User')


class Coupon(db.Model):
    __tablename__ = 'coupons'
    
    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(50), unique=True, nullable=False)
    discount_type = db.Column(db.String(20), default='percentage')  # percentage, fixed
    discount_value = db.Column(db.Float, nullable=False)
    min_order = db.Column(db.Float, default=0)
    max_uses = db.Column(db.Integer, default=0)
    uses = db.Column(db.Integer, default=0)
    is_active = db.Column(db.Boolean, default=True)
    expires_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Promotion(db.Model):
    __tablename__ = 'promotions'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text)
    discount_percentage = db.Column(db.Float)
    category_id = db.Column(db.Integer, db.ForeignKey('categories.id'))
    is_active = db.Column(db.Boolean, default=True)
    starts_at = db.Column(db.DateTime)
    ends_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Ticket(db.Model):
    __tablename__ = 'tickets'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    subject = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text)
    status = db.Column(db.String(20), default='open')  # open, in_progress, resolved, closed
    priority = db.Column(db.String(20), default='normal')  # low, normal, high, urgent
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)
    
    user = db.relationship('User')


class StockOrder(db.Model):
    __tablename__ = 'stock_orders'
    
    id = db.Column(db.Integer, primary_key=True)
    order_type = db.Column(db.String(20), nullable=False)  # stock_in, stock_out
    reference = db.Column(db.String(50))
    notes = db.Column(db.Text)
    status = db.Column(db.String(20), default='pending')  # pending, completed
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class StockOrderItem(db.Model):
    __tablename__ = 'stock_order_items'
    
    id = db.Column(db.Integer, primary_key=True)
    stock_order_id = db.Column(db.Integer, db.ForeignKey('stock_orders.id'), nullable=False)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id'), nullable=False)
    quantity = db.Column(db.Integer, nullable=False)
    condition = db.Column(db.String(10), default='NM')  # NM, EX, VG, G, PL
    cost_per_item = db.Column(db.Float, default=0)  # For stock-in
    notes = db.Column(db.String(100))  # For stock-out reasons
    
    stock_order = db.relationship('StockOrder', backref='items')
    product = db.relationship('Product')


class Testimonial(db.Model):
    __tablename__ = 'testimonials'
    
    id = db.Column(db.Integer, primary_key=True)
    customer_name = db.Column(db.String(100))
    content = db.Column(db.Text, nullable=False)
    rating = db.Column(db.Integer, default=5)
    is_approved = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class WalletTransaction(db.Model):
    __tablename__ = 'wallet_transactions'
    
    id = db.Column(db.Integer, primary_key=True)
    transaction_type = db.Column(db.String(20), nullable=False)  # credit, debit
    amount = db.Column(db.Float, nullable=False)
    description = db.Column(db.String(200))
    reference = db.Column(db.String(100))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Box(db.Model):
    __tablename__ = 'boxes'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text)
    price = db.Column(db.Float, nullable=False)
    quantity = db.Column(db.Integer, default=0)
    image_url = db.Column(db.String(500))
    category_id = db.Column(db.Integer, db.ForeignKey('categories.id'))
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Binder(db.Model):
    __tablename__ = 'binders'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, default='')
    grid_size = db.Column(db.String(10), default='3x3')  # e.g. 2x2, 3x3, 4x3
    cover_color = db.Column(db.String(20), default='#6366f1')  # hex color
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = db.relationship('User', backref=db.backref('binders', lazy=True))
    cards = db.relationship('BinderCard', backref='binder', lazy=True, cascade='all, delete-orphan',
                            order_by='BinderCard.position')

    @property
    def card_count(self):
        return len(self.cards)

    @property
    def collected_count(self):
        return sum(1 for c in self.cards if c.is_collected)

    @property
    def grid_cols(self):
        return int(self.grid_size.split('x')[0])

    @property
    def grid_rows(self):
        return int(self.grid_size.split('x')[1])

    @property
    def total_slots(self):
        return self.grid_cols * self.grid_rows


class BinderCard(db.Model):
    __tablename__ = 'binder_cards'

    id = db.Column(db.Integer, primary_key=True)
    binder_id = db.Column(db.Integer, db.ForeignKey('binders.id'), nullable=False)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id'), nullable=False)
    position = db.Column(db.Integer, nullable=False, default=0)  # slot index in grid
    is_collected = db.Column(db.Boolean, default=False)
    added_at = db.Column(db.DateTime, default=datetime.utcnow)

    product = db.relationship('Product')
