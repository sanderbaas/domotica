const ZWave = require('openzwave-shared');
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const IniConfigParser = require('ini-config-parser');

var file = __dirname + '/config.ini';
var config = IniConfigParser.Parser().parse(fs.readFileSync(file).toString());

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
        var timestamp = Date();
        if (debug) {
            console.log('%s %sW', timestamp, value['value']);
            console.log('%s strikes to start', i_start);
            console.log('%s strikes to stop', i_stop);
        }

        var laundryIsRunning = false;

        if (value['value'] == 0) {
            // only increase strikes when laundry has started
            fs.access(runningFlagPath, fs.constants.R_OK, function(err){
                if (!err) {
                    i_stop++;
                    laundryIsRunning = true;
                }
            });
        }

        // detect wether laundry is running and create flag file
        if (value['value'] > 0) {
          i_start++;
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
