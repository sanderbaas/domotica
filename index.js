const ZWave = require('openzwave-shared');
const fs = require('fs');
const IniConfigParser = require('ini-config-parser');
const Database = require('better-sqlite3');
const express = require('express');
const bodyParser = require('body-parser');
const moment = require('moment');
const mustache = require('mustache');

var file = __dirname + '/config.ini';
var config = IniConfigParser.Parser().parse(fs.readFileSync(file).toString());
var db = new Database('laundry.db');

if (!config.global.debug) { config.global.debug = false; }
if (!config.global.quiet) { config.global.quiet = false; }
if (!config.global.driver) { config.global.driver = '/dev/ttyACM0'; }
if (!config.global.running_flag_path) { config.global.running_flag_path = 'laundry_running'; }
if (!config.global.controller_id) { config.global.controller_id = 1; }
if (!config.global.sensor_id) { config.global.sensor_id = 2; }
if (!config.global.api_endpoint) { config.global.api_endpoint = 'http://localhost'; }
if (!config.global.api_port) { config.global.api_port = 8124; }

const debug = config.global.debug;
const quiet = config.global.quiet;

const app = express();
const zwave = new ZWave({
    ConsoleOutput: false
});

var connected = false;
var connecting = false;

var countStart = 0;
var countStop = 0;

const zwavedriverpath = config.global.driver;
const runningFlagPath = config.global.running_flag_path;

process.on('SIGINT', function() {
    if (connected) {
        connected = false;
        if (debug) { console.log('disconnecting...'); }
        zwave.disconnect(zwavedriverpath);
    }
    process.exit();
});

var connectToDriver = function() {
    fs.access(zwavedriverpath, fs.constants.R_OK, function(err){
        if (err && connected) {
            if (!quiet) { console.error('Driver not available, disconnecting...'); }
            connected = false;
            zwave.disconnect(zwavedriverpath);
            process.exit();
        }

        if (!err && !connected && !connecting) {
            if (debug) { console.log('Driver available, connecting...'); }
            connecting = true;
            zwave.connect(zwavedriverpath);
        }
    });
}

// initially try to connect to driver
connectToDriver();

// watch availability of driver and connect when available
fs.watchFile(zwavedriverpath, connectToDriver);

zwave.on('value changed', function(nodeid, comclass, value) {
    if (connected && nodeid==config.global.sensor_id && value['label']=='Power') {
        var dt = new Date();
        var timestamp = dt.getTime();
        var timestampStr = dt.toString();

        var insert = db.prepare('INSERT INTO wattages VALUES (?,?)');
        insert.run(timestamp, value['value']);
        // only save records of the last 2 weeks
        var cleanup = db.prepare('DELETE FROM wattages WHERE timestamp<(strftime(\'%s\', \'now\')-1209600)*1000;').run();

        if (debug) {
            console.log('%s %sW', timestampStr, value['value']);
        }

        var laundryIsRunning = false;
	// if laundry was running and this file restarted, pick it up

	try {
            fs.accessSync(runningFlagPath, fs.constants.R_OK);
            laundryIsRunning = true;
            timestamp = parseInt(fs.readFileSync(runningFlagPath).toString());
        } catch (err) {
            if (debug) {
                console.error('%s no flag file to read', timestampStr);
            }
        }


	if (laundryIsRunning) {
            console.log('%s laundry is running', timestampStr);
	}

        if (laundryIsRunning) {
            // try to insert into database if not already done
            var operation = db.prepare('SELECT * FROM operations WHERE timestamp_start=?').get(timestamp);
            if (!operation) {
                var insert = db.prepare('INSERT INTO operations VALUES (?,?,?,?)');
                insert.run(timestamp, null, null, null);
            }
        }

        if (value['value'] > 0 && !laundryIsRunning) {
            countStart++;
        }

        if (countStart>1) {
            countStart=0;
            fs.writeFile(runningFlagPath, timestamp, function(err) {
                if (err && !quiet) { console.error(err); }
            });
        }

        if (value['value'] == 0 && laundryIsRunning) {
            countStop++;
        }

        if (countStop>1) {
            countStop=0;
            fs.unlink(runningFlagPath, function (err) {
                if (!quiet && err) { console.error(err.message); }
                var timestamp_done = new Date().getTime();
                // update database
                var update = db.prepare('UPDATE operations SET timestamp_done=@timestamp_done WHERE timestamp_start=@timestamp_start;');
                update.run({
                    timestamp_start: timestamp,
                    timestamp_done: timestamp_done
                });
            });
        }
    }
});

zwave.on('node ready', function(nodeid, nodeinfo){
    if (debug) { console.log(nodeinfo); }
    if (nodeid == config.global.controller_id) {
        connected = true;
        connecting = false;
    }
});

zwave.on('driver failed', function(){
    if (!quiet) { console.error('Failed to start driver, disconnecting...'); }
    zwave.disconnect(zwavedriverpath);
    connecting = false;
    process.exit();
});

// API
app.use(bodyParser.json());

app.get('/', function(req, res){
    if (debug) { console.log(new Date().toString(), req.route.path, req.ip); }
    var lastOperation = db.prepare('SELECT * FROM operations ORDER BY timestamp_start DESC LIMIT 1;').get();
    var running = lastOperation.timestamp_start && !lastOperation.timestamp_done && !lastOperation.timestamp_handled;
    var wattages = db.prepare('select strftime(\'%H:%M\',timestamp/1000,\'unixepoch\',\'localtime\') as time, wattage from wattages where datetime(timestamp/1000,\'unixepoch\')>datetime(\'now\',\'-12 hours\');').all();
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

    var chartLabels = [];
    var chartPoints = [];
    var i = 0;
    var batch = [];
    wattages.forEach(function(set) {
        if (i%20>0) {
            batch.push(parseInt(set.wattage));
        }
        if (i%20==0) {
            chartLabels.push(set.time);
            chartPoints.push(Math.max.apply(null,batch));
            batch = [];
        }
        i++;
    });
    var status = 'not running';
    var timeString = 'Handled ' + moment(handled).fromNow() + ' by ' + handler;

    if (running) {
        status = 'running';
        timeString = 'Started ' + moment(start).fromNow();
    }

    if (done && !handled) {
        timeString = 'Finished ' + moment(done).fromNow();
    }

    var rData = {
        status: status,
        timeString: timeString,
        chartLabels: chartLabels,
        chartPoints: chartPoints
    };
    var page = fs.readFileSync('templates/index.html', "utf8"); // bring in the HTML file
    var html = mustache.to_html(page, rData); // replace all of the data
    res.send(html); // send to client
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

app.listen(config.global.api_port, function () {
  console.log('Listening on port '+config.global.api_port);
});
