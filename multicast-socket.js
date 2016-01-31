/**
 *
 * @param {Object} config
 * @param {String} config.address
 * @param {Number} config.port
 * @constructor
 */
function MulticastSocket(config) {
  this.config = config;
}

MulticastSocket.prototype.onError = function (message) {};
MulticastSocket.prototype.onConnected = function () {};
MulticastSocket.prototype.onDiagram = function (arrayBuffer, remote_address, remote_port) {};
MulticastSocket.prototype.onNewImage = function (bytes, time) {};
MulticastSocket.prototype.onDisconnected = function () {};

MulticastSocket.prototype.connect = function (callback) {
  var me = this;
  chrome.sockets.udp.create({bufferSize: 1024 * 1024}, function (createInfo) {
    var socketId = createInfo.socketId;
    var ttl = 12;
    chrome.sockets.udp.setMulticastTimeToLive(socketId, ttl, function (result) {
      if (result != 0) {
        me.handleError("Set TTL Error: ", "Unknown error");
      }
      chrome.sockets.udp.bind(socketId, "0.0.0.0", me.config.port, function (result) {
        if (result != 0) {
          chrome.sockets.udp.close(socketId, function () {
            me.handleError("Error on bind(): ", result);
          });
        } else {
          chrome.sockets.udp.joinGroup(socketId, me.config.address, function (result) {
            if (result != 0) {
              chrome.sockets.udp.close(socketId, function () {
                me.handleError("Error on joinGroup(): ", result);
              });
            } else {
              me.socketId = socketId;
              chrome.sockets.udp.onReceive.addListener(me.onReceive.bind(me));
              chrome.sockets.udp.onReceiveError.addListener(me.onReceiveError.bind(me));
              me.onConnected();
              if (callback) {
                callback.call(me);
              }
            }
          });
        }
      });
    });
  });
};

MulticastSocket.prototype.disconnect = function (callback) {
  var me = this;
  chrome.sockets.udp.onReceive.removeListener(me.onReceive.bind(me));
  chrome.sockets.udp.onReceiveError.removeListener(me.onReceiveError.bind(me));
  chrome.sockets.udp.close(me.socketId, function () {
    me.socketId = undefined;
    me.onDisconnected();
    if (callback) {
      callback.call(me);
    }
  });
};

MulticastSocket.prototype.handleError = function (additionalMessage, alternativeMessage) {
  var err = chrome.runtime.lastError;
  err = err && err.message || alternativeMessage;
  this.onError(additionalMessage + err);
};

var HEADER_SIZE = 8;
var SESSION_START = 128;
var SESSION_END = 64;
var currentSession = 0;
var slicesStored;
var imageData;
var slicesCol;
var sessionAvailable;


MulticastSocket.prototype.onReceive = function (info) {
  var startTime = performance.now();

  var data = new Int8Array(info.data);
  var session = data[1] & 0xff;
  var slices = data[2] & 0xff;
  var maxPacketSize = ((data[3] & 0xff) << 8 | (data[4] & 0xff));

  var slice = (data[5] & 0xff);
  var size = ((data[6] & 0xff) << 8 | (data[7] & 0xff));

  if ((data[0] & SESSION_START) == SESSION_START) {
    if (session != currentSession) {
      currentSession = session;
      slicesStored = 0;
      /* Consturct a appropreately sized byte array */
      imageData = new Array(slices * maxPacketSize);
      slicesCol = new Array(slices);
      sessionAvailable = true;
    }
  }

  /* If package belogs to current session */
  if (sessionAvailable && session == currentSession) {
    if (slicesCol != null && !slicesCol[slice]) {
      slicesCol[slice] = 1;
      this.arrayCopy(data, HEADER_SIZE, imageData, slice * maxPacketSize, size);
      slicesStored++;
      if(slicesStored == slices){
        var uInt8Array = new Uint8Array(imageData);
        var i = uInt8Array.length;
        var binaryString = [i];
        while (i--) {
          binaryString[i] = String.fromCharCode(uInt8Array[i]);
        }
        var data = binaryString.join('');

        var base64 = btoa(data);

        this.onNewImage(base64, "name");
      }
    }
  }




};

MulticastSocket.prototype.encode = function(data){
    var str = String.fromCharCode.apply(null,data);
    return btoa(str).replace(/.{76}(?=.)/g,'$&\n');
};

MulticastSocket.prototype.arrayCopy = function(){//){
  var src, srcPos = 0, dest, destPos = 0, length;

  if (arguments.length === 2) {
    // recall itself and copy src to dest from start index 0 to 0 of src.length
    src = arguments[0];
    dest = arguments[1];
    length = src.length;
  } else if (arguments.length === 3) {
    // recall itself and copy src to dest from start index 0 to 0 of length
    src = arguments[0];
    dest = arguments[1];
    length = arguments[2];
  } else if (arguments.length === 5) {
    src = arguments[0];
    srcPos = arguments[1];
    dest = arguments[2];
    destPos = arguments[3];
    length = arguments[4];
  }

  // copy src to dest from index srcPos to index destPos of length recursivly on objects
  for (var i = srcPos, j = destPos; i < length + srcPos; i++, j++) {
    dest[j] = src[i];

    /**
    if (dest[j] !== undef) {
      dest[j] = src[i];
    } else {
      throw "array index out of bounds exception";
    }
     **/
  }
};

MulticastSocket.prototype.onReceiveError = function (socketId, resultCode) {
  this.handleError("", resultCode);
  this.disconnect();
};

MulticastSocket.prototype.arrayBufferToString = function (arrayBuffer) {
  // UTF-16LE
  return String.fromCharCode.apply(String, new Uint16Array(arrayBuffer));
};

MulticastSocket.prototype.stringToArrayBuffer = function (string) {
  // UTF-16LE
  var buf = new ArrayBuffer(string.length * 2);
  var bufView = new Uint16Array(buf);
  for (var i = 0, strLen = string.length; i < strLen; i++) {
    bufView[i] = string.charCodeAt(i);
  }
  return buf;
};

MulticastSocket.prototype.sendDiagram = function (message, callback, errCallback) {
  if (typeof message === 'string') {
    message = this.stringToArrayBuffer(message);
  }
  if (!message || message.byteLength == 0 || !this.socketId) {
    if (callback) {
      callback.call(this);
    }
    return;
  }
  var me = this;
  chrome.sockets.udp.send(me.socketId, message, me.config.address, me.config.port,
      function (sendInfo) {
    if (sendInfo.resultCode >= 0 && sendInfo.bytesSent >= 0) {
      if (callback) {
        callback.call(me);
      }
    } else {
      if (errCallback) {
        errCallback();
      } else {
        me.handleError("");
        if (result.bytesSent == -15) {
          me.disconnect();
        }
      }
    }
  });
};
