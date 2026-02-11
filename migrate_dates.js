const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./instance/cardnoble.db');

const serialize = () => {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            resolve();
        });
    });
};

const run = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
};

const all = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

async function migrate() {
    console.log("Starting date migration...");

    // List of tables and their date columns
    const schema = {
        'users': ['created_at'],
        'products': ['created_at'],
        'orders': ['created_at'], // payment_method might be string, but created_at is date
        'messages': ['created_at'],
        'tickets': ['created_at', 'updated_at'],
        'testimonials': ['created_at'],
        'wallet_transactions': ['created_at'],
        'boxes': ['created_at'], // created_at
        'binders': ['created_at', 'updated_at'],
        'binder_cards': ['added_at'],
        'promotions': ['created_at', 'starts_at', 'ends_at'],
        'coupons': ['created_at', 'expires_at'],
        'stock_orders': ['created_at'],
        'banners': [] // no date columns in schema check (Step 1170: no createdAt in Banner model? Let me check)
        // Step 1170 Banner model: id, title, imageUrl, url, isActive, ordering. No createdAt.
    };

    // Check Banner model again in Step 1170:
    /*
    model Banner {
      id       Int     @id @default(autoincrement())
      ...
      ordering Int     @default(0)
      @@map("banners")
    }
    */
    // No createdAt in Banner.

    for (const [table, columns] of Object.entries(schema)) {
        console.log(`Processing table: ${table}`);
        for (const col of columns) {
            try {
                // Check if column exists (optional, but safe)
                // Just try update.
                // We want to replace ' ' with 'T' and append 'Z' if not present.
                // SQLite replace: replace(string, pattern, replacement)
                // Logic: 
                // UPDATE table SET col = replace(col, ' ', 'T') || 'Z' WHERE col LIKE '% %' AND col NOT LIKE '%T%';

                const sql = `UPDATE ${table} SET ${col} = replace(${col}, ' ', 'T') || 'Z' WHERE ${col} LIKE '% %' AND ${col} NOT LIKE '%T%'`;
                // Also handle nulls? The WHERE clause filters nulls implicitly (LIKE matches strings).

                const result = await run(sql);
                if (result.changes > 0) {
                    console.log(`  Updated ${result.changes} rows for column ${col}`);
                }
            } catch (e) {
                console.log(`  Error updating ${table}.${col}: ${e.message} (Column might not exist or other error)`);
            }
        }
    }

    console.log("Date migration complete.");
}

serialize().then(() => migrate()).then(() => {
    db.close();
}).catch(err => {
    console.error(err);
    db.close();
});
