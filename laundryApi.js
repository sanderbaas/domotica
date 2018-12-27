const bonjour = require('bonjour')();
const express = require('express');
const bodyParser = require('body-parser');
const Database = require('better-sqlite3');
const fs = require('fs');
const IniConfigParser = require('ini-config-parser');
const moment = require('moment');

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

app.get('/', function(req, res){
    if (debug) { console.log(new Date().toString(), req.route.path, req.ip); }
    var lastOperation = db.prepare('SELECT * FROM operations ORDER BY timestamp_start DESC LIMIT 1;').get();
    var running = lastOperation.timestamp_start && !lastOperation.timestamp_done && !lastOperation.timestamp_handled;
    var start = new Date(lastOperation.timestamp_start);
    var prettyStart = start.toDateString() + ' ' + start.toTimeString();
    var done = false;
    var prettyDone = false;
    var handled = false;
    var prettyHandled = false;
    var handler = false;

    if (lastOperation.timestamp_done) {
        done = new Date(lastOperation.timestamp_done);
        prettyDone = done.toDateString() + ' ' + done.toTimeString();
    }

    if (lastOperation.timestamp_handled) {
        handled = new Date(lastOperation.timestamp_handled);
        prettyHandled = handled.toDateString() + ' ' + handled.toTimeString();
    }

    if (lastOperation.handler) { handler = lastOperation.handler; }

    res.writeHead(200, {'Content-Type': 'text/html; charset=UTF-8'});
    res.write('<html><head><title>Laundry</title><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" /></head><body>');

    if (running) {
        res.write('<h1>Laundry is running</h1><p>Started ' + moment(start).fromNow() + '</p>\r\n');
    }

    if (done && !handled) {
        res.write('<h1>Laundry is not running</h1>Finished ' + moment(done).fromNow() + '</p>\r\n');
    }

    if (done && handled) {
        res.write('<h1>Laundry is not running</h1>Handled ' + moment(handled).fromNow() + ' by ' + handler + '<p>\r\n');
    }

    var lastMin = db.prepare('select wattage from wattages order by timestamp limit 1').get();
    var last5Min = db.prepare('select avg(wattage) as wattage from wattages where timestamp>(strftime(\'%s\', \'now\')-300)*1000').get();
    var last15Min = db.prepare('select avg(wattage) as wattage from wattages where timestamp>(strftime(\'%s\', \'now\')-900)*1000').get();

    var loadMin = (Number.parseFloat(lastMin.wattage).toFixed() || 0);
    var load5Min = (Number.parseFloat(last5Min.wattage).toFixed() || 0);
    var load15Min = (Number.parseFloat(last15Min.wattage).toFixed() || 0);

    res.write('<strong>load average</strong><br /> 1 min: ' + loadMin  + 'W<br /> 5 min: ' + load5Min + 'W<br /> 15 min: ' + load15Min + 'W');

    res.end('</body></html>');
});

app.get('/status', function(req, res){
    if (debug) { console.log(new Date().toString(), req.route.path, req.ip); }
    var lastOperation = db.prepare('SELECT * FROM operations ORDER BY timestamp_done DESC LIMIT 1;').get();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(lastOperation));
});

app.post('/handle/:timestamp_start', function(req, res){
    if (debug) {
        console.log(new Date().toString(),req.params.timestamp_start, req.ip);
        console.log(new Date().toString(), req.body);
    }

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
