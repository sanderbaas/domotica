const bonjour = require('bonjour')();
const express = require('express');
const bodyParser = require('body-parser');
const Database = require('better-sqlite3');
const fs = require('fs');
const IniConfigParser = require('ini-config-parser');

var file = __dirname + '/config.ini';
var config = IniConfigParser.Parser().parse(fs.readFileSync(file).toString());

if (!config.global.debug) { config.global.debug = false; }
if (!config.global.quiet) { config.global.quiet = false; }
if (!config.global.api_endpoint) { config.global.api_endpoint = 'http://localhost'; }
if (!config.global.api_port) { config.global.api_port = 8124; }

const debug = config.global.debug;
const quiet = config.global.quiet;

const app = express();
var db = new Database('laundry.db');

// emit bonjour
bonjour.publish({
    name: 'laundryApi',
    type: 'http',
    port: config.global.api_port,
    txt: {
        endpoint: config.global.api_endpoint + ':' + config.global.api_port + '/'
    }
});

app.use(bodyParser.json());

app.get('/status', function(req, res){
    var lastOperation = db.prepare('SELECT * FROM operations ORDER BY timestamp_done DESC LIMIT 1;').get();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(lastOperation));
});

app.post('/handle/:timestamp_start', function(req, res){
    var operation = db.prepare('SELECT * FROM operations WHERE timestamp_start=?').get(req.params.timestamp_start);
    if (!operation) {
        res.status(404).end();
    }

    if (operation && (!req.body || !req.body.handler)) {
        res.writeHead(409, { 'Content-Type': 'text/plain' });
        res.end('missing handler');
    }

    if (operation && req.body && req.body && req.body.handler) {
        var timestamp_handled = new Date().getTime();
        var result = db.prepare('UPDATE operations SET timestamp_handled=:handled, handler=:handler WHERE timestamp_start=:start').run({
            handled: timestamp_handled,
            handler: req.body.handler,
            start: req.params.timestamp_start
        });

        if (result) {
            res.status(200).end();
        }

        if (!result) {
            res.status(500).end();
        }
    }
});

app.listen(8124, function () {
  console.log('Listening on port 8124');
});
