const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./instance/cardnoble.db');

db.all("SELECT * FROM users LIMIT 1", [], (err, rows) => {
    if (err) {
        throw err;
    }
    rows.forEach((row) => {
        console.log(row);
    });
});

db.close();
