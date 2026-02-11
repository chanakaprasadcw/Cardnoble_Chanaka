from flask import Blueprint, render_template, redirect, url_for, flash, request
from flask_login import login_user, logout_user, login_required, current_user
from app import db
from app.models import User

auth_bp = Blueprint('auth', __name__)


@auth_bp.route('/login', methods=['GET', 'POST'])
def login():
    """User login page."""
    if current_user.is_authenticated:
        return redirect(url_for('main.index'))
    
    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')
        
        user = User.query.filter_by(email=email).first()
        
        if user and user.check_password(password):
            login_user(user)
            next_page = request.args.get('next')
            if user.is_admin:
                return redirect(next_page or url_for('admin.dashboard'))
            return redirect(next_page or url_for('main.index'))
        
        flash('Invalid email or password', 'error')
    
    return render_template('auth/login.html')


@auth_bp.route('/register', methods=['GET', 'POST'])
def register():
    """User registration page."""
    if current_user.is_authenticated:
        return redirect(url_for('main.index'))
    
    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')
        name = request.form.get('name')
        
        if User.query.filter_by(email=email).first():
            flash('Email already registered', 'error')
            return render_template('auth/register.html')
        
        user = User(email=email, name=name)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        
        login_user(user)
        flash('Registration successful!', 'success')
        return redirect(url_for('main.index'))
    
    return render_template('auth/register.html')


@auth_bp.route('/logout')
@login_required
def logout():
    """Logout user."""
    logout_user()
    flash('You have been logged out', 'info')
    return redirect(url_for('main.index'))
