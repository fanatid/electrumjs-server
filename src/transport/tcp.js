var net = require('net')
var inherits = require('util').inherits

var _ = require('lodash')
var Q = require('q')

var Client = require('./client')
var logger = require('../logger').logger
var Transport = require('./transport')


/**
 * @class TCPClient
 * @extends Client
 * @param {net.Socket} socket
 */
function TCPClient(socket) {
  Client.call(this)

  var self = this

  self.isActive = true
  self.clientId = ['a', socket.remoteAddress, 'p', socket.remotePort].join('')
  self.socket = socket

  var message = ''
  self.socket.on('data', function (data) {
    if (!self.isActive) { return }

    message += data.toString()
    if (message.indexOf('\n') === -1) { return }

    var items = message.split('\n')
    message = items.pop()

    items.forEach(function (rawRequest) {
      if (rawRequest === 'quit') {
        self.socket.end()
        self.isActive = false
      }

      self.handleRawRequest(rawRequest)
    })
  })

  self.socket.on('close', function () { self.emit('end') })
}

inherits(TCPClient, Client)

/**
 * @param {Object} response
 */
TCPClient.prototype.send = function (response) {
  if (this.isActive) { this.socket.write(JSON.stringify(response) + '\n') }
}

/**
 * @param {string} rawRequest
 * @fires TCPClient#request
 */
TCPClient.prototype.handleRawRequest = function (rawRequest) {
  if (!this.isActive) { return }

  var request
  try {
    request = JSON.parse(rawRequest)
  } catch (error) {
    this.send({error: 'bad JSON'})
  }

  if (!_.isUndefined(request)) { this.emit('request', request) }
}


/**
 * @class TCPTransport
 * @param {Interface} interface
 * @param {number} port
 * @param {string} [host]
 */
function TCPTransport(interface, port, host) {
  Transport.call(this)

  this._isInialized = false

  this.interface = interface
  this.port = port
  this.host = host

  this.server = net.createServer(function (socket) {
    this.interface.newClient(new TCPClient(socket))
  }.bind(this))
}

inherits(TCPTransport, Transport)

/**
 * @return {Q.Promise}
 */
TCPTransport.prototype.initialize = function () {
  var self = this
  if (self._isInialized) { return Q() }

  self._isInialized = true

  var deferred = Q.defer()

  self.server.on('listening', deferred.resolve)
  self.server.on('error', deferred.reject)
  self.server.listen(self.port, self.host)

  return deferred.promise.then(function () {
    logger.info('Created TCP transport for %s interface, listening on %s:%s',
      self.interface.constructor.name, self.host, self.port)
  })
}


module.exports = {
  TCPTransport: TCPTransport
}
