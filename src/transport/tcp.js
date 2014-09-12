var net = require('net')
var inherits = require('util').inherits

var Q = require('q')

var Client = require('./client')


/**
 * @class TCPClient
 * @extends Client
 * @param {net.Socket} socket
 */
function TCPClient(socket) {
  Client.call(this)

  var self = this

  self.isActive = true
  self.socket = socket

  var message = ''
  self.socket.on('data', function(data) {
    if (!self.isActive)
      return

    message += data.toString()
    if (message.indexOf('\n') === -1)
      return

    var items = message.split('\n')
    message = items.pop()

    items.forEach(function(rawRequest) {
      if (rawRequest === 'quit') {
        self.socket.end()
        self.isActive = false
      }

      self.handleRawRequest(rawRequest)
    })
  })

  self.socket.on('close', function() { self.emit('end') })
}

inherits(TCPClient, Client)

/**
 * @param {Object} response
 */
TCPClient.prototype.send = function(response) {
  if (this.isActive)
    this.socket.write(JSON.stringify(response) + '\n')
}

/**
 * @param {string} rawRequest
 * @fires TCPClient#request
 */
TCPClient.prototype.handleRawRequest = function(rawRequest) {
  if (!this.isActive)
    return

  try {
    var request = JSON.parse(rawRequest)
  } catch (error) {
    this.send({ error: 'bad JSON' })
    return
  }

  this.emit('request', request)
}


/**
 * @class TCPTransport
 * @param {Interface} interface
 * @param {number} port
 * @param {string} [host]
 */
function TCPTransport(interface, port, host) {
  this.interface = interface
  this.port = port
  this.host = host
  this._isInialized = false
}

/**
 * @return {Q.Promise}
 */
TCPTransport.prototype.initialize = function() {
  var self = this
  if (self._isInialized)
    return Q()

  self._isInialized = true

  var deferred = Q.defer()
  var server = net.createServer()

  server.on('listening', deferred.resolve)
  server.on('error', deferred.reject)
  server.on('connection', function(socket) { self.interface.newClient(new TCPClient(socket)) })
  server.listen(self.port, self.host)

  return deferred.promise.then(function() {
    var msg = [
      'Created tcp transport for ',
      self.interface.constructor.name,
      ' interface, listening on ',
      self.host + ':' + self.port
    ].join('')
    console.log(msg)
  })
}


module.exports = TCPTransport
