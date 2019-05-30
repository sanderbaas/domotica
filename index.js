const ZWave = require('openzwave-shared');
const fs = require('fs');
const IniConfigParser = require('ini-config-parser');
const Database = require('better-sqlite3');

var file = __dirname + '/config.ini';
var config = IniConfigParser.Parser().parse(fs.readFileSync(file).toString());
var db = new Database('laundry.db');

if (!config.global.debug) { config.global.debug = false; }
if (!config.global.quiet) { config.global.quiet = false; }
if (!config.global.driver) { config.global.driver = '/dev/ttyACM0'; }
if (!config.global.running_flag_path) { config.global.running_flag_path = 'laundry_running'; }
if (!config.global.controller_id) { config.global.controller_id = 1; }
if (!config.global.sensor_id) { config.global.sensor_id = 2; }

const debug = config.global.debug;
const quiet = config.global.quiet;

const zwave = new ZWave({
    ConsoleOutput: false
});

var connected = false;
var connecting = false;

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

        if (value['value'] > 2 && !laundryIsRunning) {
            fs.writeFile(runningFlagPath, timestamp, function(err) {
                if (err && !quiet) { console.error(err); }
            });
        }

        if (value['value'] == 0 && laundryIsRunning) {
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
