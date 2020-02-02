const noble = require('@abandonware/noble');

const DEFAULT_SPECS = process.env.SPECS || {
   '2a19': 'battery',
   'ebe0ccc17a0a4b0c8a1a6ff2997da3a6': 'values'
};

const mijia = {};
mijia.discover = function discover(onDiscover, onTimeout, timeoutSeconds = 120, uuidFilter = 'fe95', specs = DEFAULT_SPECS) {
   let done;
   let timeout;
   const devices = {};

   const stop = function () {
      if (timeout) timeout = clearTimeout(timeout);
      done = new Date();
      noble.stopScanning();
      return devices;
   }
   if (onTimeout) {
      timeout = setTimeout(function () {
         stop();
         onTimeout(devices);
      }, timeoutSeconds * 1000);
   }
   noble.on('stateChange', function (state) {
      if (done) return;
      if (state === 'poweredOn') {
         noble.startScanning([uuidFilter], false);
      } else {
         noble.stopScanning();
      }
   });

   noble.on('discover', function (device) {
      if (done) return;

      const { advertisement, id, rssi, address: rawAddress } = device;
      const { localName, serviceData } = advertisement;
      const uuid = serviceData && serviceData[0] && serviceData[0].uuid;
      const address = rawAddress && String(rawAddress).split('-').join(':');
      device.specs = { address, id, uuid, localName, rssi };
      device.getData = function (dataTimeoutSeconds) {
         return mijia.getData(device, specs, dataTimeoutSeconds);
      }
      if (uuidFilter && uuid !== uuidFilter) return;

      devices[address || id] = device;
      if (onDiscover) onDiscover(device, devices);
   });

   return stop;
}
mijia.getData = function getData(device, deviceSpecs = DEFAULT_SPECS, timeoutSeconds = 60) {
   return new Promise(function (ok, ko) {
      if (!device || !device.on) return ko(new Error('invalid device'));

      const start = new Date();
      const id = device && device.specs && device.specs.id;
      const out = {};
      let timeout;
      let done;
      const stop = function () {
         if (device.disconnect) device.disconnect();
         done = new Date();
         if (timeout) timeout = clearTimeout(timeout);
         const end = new Date();
         out.duration = end.getTime() - start.getTime();
         return ok(out);
      }

      //timeout
      if (timeoutSeconds) {
         timeout = setTimeout(function () {
            out.timeout = true;
            stop();
         }, timeoutSeconds * 1000);
      }

      device.on('disconnect', function () {
         if (!done) device.connect();
      });
      device.on('connect', function () {
         if(done) return;

         const onData = function (data, type) {
            if (!type || data === undefined || done) return;
            out[type] = mijia.parseData(data, type);

            //all data collected, we are good to go
            if (Object.keys(out).length >= Object.keys(deviceSpecs).length) {
               return stop();
            }
         }

         device.discoverSomeServicesAndCharacteristics([], Object.keys(deviceSpecs), function (error, services, specs) {
            if (error || !specs || !specs.length) {
               return ko('invalidSpecs');
            }
            if (done) return;

            for (let spec of specs) {
               if (!spec || !spec.uuid || !spec.properties || !spec.read) continue;
               const type = deviceSpecs[spec.uuid] || deviceSpecs[String(spec.uuid)];
               if (!type) continue;

               if (type === 'battery') {
                  spec.read(function (err, data) {
                     onData(data, type);
                  });
               } else {
                  spec.on('data', function (data) {
                     onData(data, type);
                  });
               }
            }
         });
      });

      device.connect();
   })
}

mijia.parseData = function parseData(data, type) {
   if (data === undefined || !type) return;
   const prep = typeof data === typeof 's' ? data : JSON.stringify(data.toString('hex')).replace(/\"/gi, '');

   if (type === 'battery') {
      return parseInt(prep, 16);
   } else {
      const humidity = parseInt(prep.substr(4, 2), 16);

      const tempRawHex = prep.substr(2, 2) + prep.substr(0, 2);
      let tempRaw;
      let isNegative = tempRawHex.substr(0, 1) === 'f';
      if (isNegative) {
         tempRaw = String(parseInt('ffff', 16) - parseInt(tempRawHex, 16));
      } else {
         tempRaw = parseInt(tempRawHex, 16).toString();
      }
      const temperature = (isNegative ? -1 : 1) * parseFloat(tempRaw.substr(0, tempRaw.length - 2) + '.' + tempRaw.substr(tempRaw.length - 2, 2));
      return { temperature, humidity };
   }
}
module.exports = mijia;
