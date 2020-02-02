const Mijia = require('./XiaomiMijiaThermometer');

const ALIASES = {
   'a4:c1:38:9b:80:d6': 'bedroom-blue',
   'a4:c1:38:48:69:4c': 'bedroom-grey',
   'a4:c1:38:e3:71:3d': 'balcon'
};

// Discover thermometers
const stop = Mijia.discover(async function (device, devices) {
   const alias = device && device.specs && device && device.specs.address && ALIASES[device.specs.address];
   const rssi = device && device.specs && device && device.specs.rssi;
   const id = device && device.specs && device && device.specs.id;
   const address = device && device.specs && device && device.specs.address;

   let count = 0;
   for(let key in devices){
      const dev = devices[key];
      if(ALIASES[dev && dev.specs && dev.specs.id] || ALIASES[dev && dev.specs && dev.specs.address])count++;
   }
   const total = Object.keys(ALIASES).length;
   console.log('- Device discovered', alias, address, id, rssi, count + '/' + total);

   //stop when the 3 of them have been found
   if (count >= total) {
      console.log('-> Scanning DONE');
      stop();
      await collectData(devices);
      process.exit();
   }

   //or stop on timeout
}, async function (devices) {
   console.log('-> Sanning TIMEOUT', devices && Object.keys(devices));
   await collectData(devices);
   process.exit();
})

//collect data from found devices
function collectData(devices) {
   const keys = devices && Object.keys(devices);
   console.log('-> Collecting data...', keys);
   if (!keys || !keys.length) return console.log('- empty devices list');

   const out = {};
   return promiseEach(keys, async function (id) {
   //return Promise.each(keys, async function (id) {
      const alias = id && ALIASES[id];
      console.log('- getting data for', alias, id);
      const data = devices[id] && devices[id].getData && await devices[id].getData();
      console.log('- data received for', alias, id);
      data.alias = alias;
      data.id = id;
      out[alias||id] = data;
   }).then(function () {
      console.log('-> Collecting data DONE');
      console.log(out);
   })
}

// util: run promises in sequence without heavy bluerbird
async function promiseEach(queue, func) {
   for (const el of queue) {
      await func(el);
   }
};
