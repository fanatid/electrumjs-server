var events = require('events')
var net = require('net')
var util = require('util')


function TCPTransport(host, port) {
  events.EventEmitter.call(this)

  var self = this
  self.nextRequestId = 0

  self.socket = new net.Socket()
  self.socket.connect(port, host, function () { self.emit('ready') })

  self.socket.on('close', function (hadError) {
    self.emit('close', hadError)
  })

  var data = ''
  var pos
  self.socket.on('data', function (buffer) {
    data += buffer.toString()

    while ((pos = data.indexOf('\n')) !== -1) {
      self.emit('response', JSON.parse(data.slice(0, pos)))
      data = data.slice(pos + 1)
    }
  })
}

util.inherits(TCPTransport, events.EventEmitter)

TCPTransport.prototype.end = function () {
  this.socket.end('quit\n')
}

TCPTransport.prototype.request = function (method, params, cb) {
  var requestId = this.nextRequestId++
  var data = {
    'id': requestId,
    'method': method,
    'params': params
  }
  this.socket.write(JSON.stringify(data) + '\n')

  var responseEvent = function (response) {
    if (response.id === requestId) {
      this.removeListener('response', responseEvent)
      cb(response)
    }
  }

  this.on('response', responseEvent)
}


module.exports = {
  TCPTransport: TCPTransport
}
