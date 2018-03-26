var ZWave = require('openzwave-shared');

var zwave = new ZWave({
  ConsoleOutput: false
});

zwavedriverpath = '/dev/ttyACM0';

console.log("connecting to " + zwavedriverpath);
zwave.connect(zwavedriverpath);

process.on('SIGINT', function() {
  console.log('disconnecting...');
  zwave.disconnect(zwavedriverpath);
  process.exit();
});

zwave.on('value changed', function(nodeid, comclass, value) {
  if (nodeid==2 && value['label']=='Power') {
	//var date = Date();
	console.log('%s %sW', Date(), value['value']);
  }
  // zwave.setValue(2, 37,  1,  0,  false); turn off
  // zwave.setValue(2, 37,  1,  0,  true); turn on
});

zwave.on('node ready', function(nodeid, nodeinfo){
  console.log('node ready', nodeid, nodeinfo);
  //zwave.setNodeOff(nodeid);
  
  /*if (nodeid==1) {
	//zwave.enablePoll(1, 32, 1, 0,1);
	console.log('addnode?');
	//zwave.addNode(true);
	zwave.addNode(false);
	
	//zwave.setValue(1, 32,  1,  0,  false);  // node 3: turn on
  }*/
});

/*zwave.on('polling enabled/disabled', function(nodeid){
  console.log('polling enabled/disable', nodeid);	
})*/

zwave.on('node added', function(nodeid){
  console.log('node added', nodeid);
});

