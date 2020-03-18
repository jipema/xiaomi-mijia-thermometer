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

   const stop = async function () {
      if (timeout) timeout = clearTimeout(timeout);
      done = new Date();
      await noble.stopScanning();
      console.log('[xiaomi-mijia-thermometer] stop scanning', Object.keys(devices));
      return devices;
   }
   if (onTimeout) {
      timeout = setTimeout(async function () {
         await stop();
         onTimeout(devices);
      }, timeoutSeconds * 1000);
   }
   noble.on('stateChange', function (state) {
      if (done) return;
      if (state === 'poweredOn') {
         noble.isOn = true;
         console.log('[xiaomi-mijia-thermometer] powerOn');
         noble.startScanning(!uuidFilter ? undefined : [uuidFilter], false);
      } else {
         noble.isOn = false;
         console.log('[xiaomi-mijia-thermometer] powerOff', { devices });
         noble.stopScanning();
      }
   });

   noble.once('scanStart', function () {
      console.log('[xiaomi-mijia-thermometer] start scanning...', { timeoutSeconds, uuidFilter, specs });
   });
   noble.once('scanStop', function () {
      console.log('[xiaomi-mijia-thermometer] stopped scanning.');
   });
   noble.on('discover', function (device) {
      if (done) return;

      const { advertisement, id, rssi, address: rawAddress } = device;
      const { localName, serviceData } = advertisement;
      const uuid = serviceData && serviceData[0] && serviceData[0].uuid;
      const address = rawAddress && String(rawAddress).split('-').join(':');
      if (uuidFilter && uuid !== uuidFilter) return;

      device.specs = { address, id, uuid, localName, rssi };
      device.getData = function (dataTimeoutSeconds) {
         return mijia.getData(device, specs, dataTimeoutSeconds);
      }
      devices[address || id] = device;
      if (onDiscover) onDiscover(device, devices);
   });

   //dont wait for powerOn state change if alrady on
   if (noble && noble.isOn) {
      console.log('[xiaomi-mijia-thermometer] alreadyOn');
      noble.startScanning(!uuidFilter ? undefined : [uuidFilter], false);
   }

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
         //console.log('[xiaomi-mijia-thermometer] device done', device && device.specs && (device.specs.address || device.specs.id), device && device.disconnect);
         const endId = function () {
            done = new Date();
            if (timeout) timeout = clearTimeout(timeout);
            const end = new Date();
            out.duration = end.getTime() - start.getTime();
            return ok(out);
         }
         if (device.connected && device.disconnect) {
            device.once('disconnect', endId);
            device.disconnect();
         } else {
            endId();
         }
      }

      //timeout
      if (timeoutSeconds) {
         timeout = setTimeout(async function () {
            out.timeout = true;
            await stop();
         }, timeoutSeconds * 1000);
      }

      device.on('disconnect', function () {
         console.log('[xiaomi-mijia-thermometer] device disconnected', device && device.specs && (device.specs.address || device.specs.id));
         device.connected = false;
      });
      device.once('connect', function () {
         device.connected = new Date();
         //console.log('[xiaomi-mijia-thermometer] device connected', device && device.specs && (device.specs.address || device.specs.id));
         if (done) return;

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
               //console.log('[xiaomi-mijia-thermometer] device waiting for spec data..', type, device && device.specs && (device.specs.address || device.specs.id));
               if (!type) continue;

               if (type === 'battery') {
                  spec.read(function (err, data) {
                     //console.log('[xiaomi-mijia-thermometer] device spec data received', type, device && device.specs && (device.specs.address || device.specs.id));
                     onData(data, type);
                  });
               } else {
                  /*spec.read(function (err, data) {
                     console.log('[xiaomi-mijia-thermometer] device spec received', type, data, device && device.specs && (device.specs.address||device.specs.id));
                     if(data) onData(data, type);
                  });*/
                  spec.subscribe();
                  spec.on('data', function (data) {
                     //console.log('[xiaomi-mijia-thermometer] device spec received', type || spec.uuid, device && device.specs && (device.specs.address || device.specs.id));
                     spec.unsubscribe();
                     onData(data, type);
                  });
               }
            }
         });
      });

      //console.log('[xiaomi-mijia-thermometer] connecting to device...', device && device.specs && (device.specs.address || device.specs.id));
      device.connect();
   }).catch(function (error) {
      console.log('[xiaomi-mijia-thermometer] getData error', error);
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
