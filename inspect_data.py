
import os
import re
import json
import html

SCRAPED_HTML_PATH = os.path.join(
    os.path.dirname(__file__), 
    '..', 'kevinphp_clone', 'raw_index.html'
)

def extract_json_from_html(html_path):
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
    except Exception as e:
        print(f"Error: {e}")
        return None

data = extract_json_from_html(SCRAPED_HTML_PATH)
if data:
    if 'props' in data:
        products = data['props'].get('products', {})
        if isinstance(products, dict):
            products = products.get('data', [])
        
        if products:
            print("Keys of first product:", list(products[0].keys()))
            print("First product data:", json.dumps(products[0], indent=2))
        else:
            print("No products found in props")
    else:
        print("No props found in data")
else:
    print("No data extracted")
