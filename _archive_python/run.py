#!/usr/bin/env python3
"""
CardNoble Clone - Application Entry Point
Run with: python run.py
"""
from app import create_app

app = create_app()

if __name__ == '__main__':
    app.run(debug=True, port=5001)
