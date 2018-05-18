const ZWave = require('openzwave-shared');
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const IniConfigParser = require('ini-config-parser');
const Database = require('better-sqlite3');

var file = __dirname + '/config.ini';
var config = IniConfigParser.Parser().parse(fs.readFileSync(file).toString());
var db = new Database('laundry.db');

if (!config.global.debug) { config.global.debug = false; }
if (!config.global.quiet) { config.global.quiet = false; }
if (!config.global.driver) { config.global.driver = '/dev/ttyACM0'; }
if (!config.global.running_flag_path) { config.global.running_flag_path = 'laundry_running'; }
if (!config.global.laundry_done_msg) { config.global.laundry_done_msg = 'Laundry is done!'; }
if (!config.global.laundry_started_msg) { config.global.laundry_started_msg = 'Laundry has started.'; }
if (!config.global.controller_id) { config.global.controller_id = 1; }
if (!config.global.sensor_id) { config.global.sensor_id = 2; }
if (!config.global.max_strikes) { config.global.max_strikes = 3; }
if (!config.global.min_strikes) { config.global.min_strikes = 3; }
if (!config.global.telegram_chat_id) { config.global.telegram_chat_id = false; }
if (!config.global.telegram_token) { config.global.telegram_token = false; }

const debug = config.global.debug;
const quiet = config.global.quiet;

const bot = new TelegramBot(config.global.telegram_token, {polling: true});

const zwave = new ZWave({
    ConsoleOutput: false
});

var connected = false;
var connecting = false;
var i_start = 0;
var i_stop = 0;

const maxStrikes = config.global.max_strikes;
const minStrikes = config.global.min_strikes;
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
        var timestamp = new Date().getTime();
        if (debug) {
            console.log('%s %sW', timestamp, value['value']);
            console.log('%s strikes to start', i_start);
            console.log('%s strikes to stop', i_stop);
        }

        var laundryIsRunning = false;
	// if laundry was running and this file restarted, pick it up

	try {
            fs.accessSync(runningFlagPath, fs.constants.R_OK);
            laundryIsRunning = true;
            timestamp = parseInt(fs.readFileSync(runningFlagPath).toString());
            if (debug) {
                console.log('read flag path');
            }
        } catch (err) {
            if (debug) {
                console.error('no flag path to read');
            }
        }


	if (laundryIsRunning) {
		console.log('laundry is running');
	}

        if (laundryIsRunning) {
            // try to insert into database if not already done
            var operation = db.prepare('SELECT * FROM operations WHERE timestamp_start=?').get(timestamp);
            if (!operation) {
                var insert = db.prepare('INSERT INTO operations VALUES (?,?,?,?)');
                insert.run(timestamp, null, null, null);
            }
        }

        if (value['value'] == 0 && laundryIsRunning) {
            // only increase strikes when laundry has started
            i_stop++;
        }

        if (value['value'] == 0 && !laundryIsRunning) {
            // reset start strikes on 0 when not started yet
            i_start=0;
        }

        // detect wether laundry is running and create flag file
        if (value['value'] > 0) {
          i_start++;
          i_stop = 0;
        }

        if (i_start >= minStrikes && !laundryIsRunning) {
            fs.writeFile(runningFlagPath, timestamp, function(err) {
                if (err && !quiet) { console.error(err); }
            });
        }

        if (i_stop >= maxStrikes) {
            // three (or more/less) strikes you're out and laundry is done
            fs.unlink(runningFlagPath, function (err) {
                if (!quiet && err) { console.error(err.message); }
                i_stop = 0;
                i_start = 0;
                var timestamp_done = new Date().getTime();
                // update database
                var update = db.prepare('UPDATE operations SET timestamp_done=@timestamp_done WHERE timestamp_start=@timestamp_start;');
                update.run({
                    timestamp_start: timestamp,
                    timestamp_done: timestamp_done
                });
            });

            var resp = config.global.laundry_done_msg;
            bot.sendMessage(config.global.telegram_chat_id, resp);
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
