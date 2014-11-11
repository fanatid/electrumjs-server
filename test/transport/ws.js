var events = require('events')
var util = require('util')

var socket = require('socket.io-client')


function WSTransport(host, port) {
  events.EventEmitter.call(this)

  var self = this
  self.nextRequestId = 0

  var wsURL = ['http://', host, ':', port].join('')
  self.socket = socket(wsURL, {forceNew: true})
  self.socket.on('connect', function () { self.emit('ready') })
  self.socket.on('error', function () { self.emit('close', true) })
  self.socket.on('message', function (msg) {
    self.emit('response', JSON.parse(msg))
  })
}

util.inherits(WSTransport, events.EventEmitter)

WSTransport.prototype.end = function () {
  this.emit('close', false)
}

WSTransport.prototype.request = function (method, params, cb) {
  var requestId = this.nextRequestId++
  var data = {
    'id': requestId,
    'method': method,
    'params': params
  }
  this.socket.send(JSON.stringify(data))

  var responseEvent = function (response) {
    if (response.id === requestId) {
      this.removeListener('response', responseEvent)
      cb(response)
    }
  }

  this.on('response', responseEvent)
}


module.exports = {
  WSTransport: WSTransport
}
