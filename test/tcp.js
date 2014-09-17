var dns = require('dns')
var events = require('events')
var net = require('net')
var util = require('util')

var expect = require('chai').expect

var config = require('./config.json')
var electrumTest = require('./electrum')


function TCPTransport(host, port) {
  var self = this
  self.nextRequestId = 0

  self.socket = new net.Socket()
  self.socket.connect(port, host, function() {
    self.emit('ready')
  })

  self.socket.on('close', function(had_error) {
    self.emit('close', had_error)
  })

  var data = ''
  var pos
  self.socket.on('data', function(buffer) {
    data += buffer.toString()

    while ((pos = data.indexOf('\n')) !== -1) {
      self.emit('response', JSON.parse(data.slice(0, pos)))
      data = data.slice(pos+1)
    }
  })
}

util.inherits(TCPTransport, events.EventEmitter)

TCPTransport.prototype.end = function() {
  this.socket.end('quit\n')
}

TCPTransport.prototype.rawRequest = function(rawRequest) {
  this.socket.write(rawRequest + '\n')
}

TCPTransport.prototype.request = function(method, params, cb) {
  var requestId = this.nextRequestId++
  var data = {
    'id': requestId,
    'method': method,
    'params': params
  }
  this.rawRequest(JSON.stringify(data))

  var responseEvent = function(response) {
    if (response.id === requestId) {
      this.removeListener('response', responseEvent)
      cb(response)
    }
  }

  this.on('response', responseEvent)
}


describe('tcp transport', function() {
  var params = {}

  beforeEach(function(done) {
    dns.resolve(config.electrum.tcp.host, function(error, addresses) {
      var isResolved = (error === null && addresses.length > 0)
      expect(isResolved).to.be.true

      params.transport = new TCPTransport(addresses[0], config.electrum.tcp.port)
      params.transport.once('ready', done)
    })
  })

  afterEach(function(done) {
    params.transport.on('close', function(had_error) {
      expect(had_error).to.be.false
      done()
    })
    params.transport.end()
  })

  electrumTest(params)
})
