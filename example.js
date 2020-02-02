const Mijia = require('./MijiaThermometer');

const ALIASES = {
   'a4:c1:38:9b:80:d6': 'bedroom-blue',
   'a4:c1:38:48:69:4c': 'bedroom-grey',
   'a4:c1:38:e3:71:3d': 'balcon'
};

// Discover thermometers
const stop = Mijia.discover(async function (device, devices) {
   const alias = device && device.specs && device && device.specs.address && ALIASES[device.specs.address];
   const count = (devices && Object.keys(devices).length) || 0;
   const total = Object.keys(ALIASES).length;
   console.log('---- DISCOVER ----', alias, count + '/' + total);
   console.log(device && device.specs);

   //stop when the 3 of them have been found
   if (count >= total) {
      console.log('---- DISCOVER DONE ----');
      stop();
      await collectData(devices);
      process.exit();
   }

   //or stop on timeout
}, async function (devices) {
   console.log('---- TIMEOUT ----', devices && Object.keys(devices));
   await collectData(devices);
   process.exit();
})

//collect data from found devices
function collectData(devices) {
   const keys = devices && Object.keys(devices);
   console.log('---- COLLECT DATA ----', keys);
   if (!keys || !keys.length) return console.log('- empty devices list');

   const out = {};
   return promiseEach(keys, async function (id) {
   //return Promise.each(keys, async function (id) {
      const alias = id && ALIASES[id];
      console.log('- get data for', alias, id);
      const data = devices[id] && devices[id].getData && await devices[id].getData();
      console.log('- data received for', alias, id);
      out[id] = data;
   }).then(function () {
      console.log('---- COLLECT DATA DONE ----');
      console.log(out);
   })
}

// util: run promises in sequence without heavy bluerbird
async function promiseEach(queue, func) {
   for (const el of queue) {
      await func(el);
   }
};
