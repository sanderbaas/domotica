const Database = require('better-sqlite3');
var db = new Database('laundry.db');

try {
    db.prepare('CREATE TABLE operations (timestamp_start INTEGER PRIMARY KEY NOT NULL, timestamp_done INTEGER, timestamp_handled INTEGER, handler CHAR(50));').run();
} catch (err) {
    console.log(err.message);
}

