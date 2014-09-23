var http = require('http')
var inherits = require('util').inherits

var socket = require('socket.io')
var _ = require('lodash')
var Q = require('q')

var Client = require('./client')
var Transport = require('./transport')


/**
 * @class WSClient
 * @extends Client
 * @param {Socket} socket
 */
function WSClient(socket) {
  Client.call(this)

  var self = this
  self.isActive = true
  self.clientId = socket.id
  self.socket = socket

  self.socket.on('message', function(msg) {
    if (!self.isActive)
      return

    var request
    try {
      request = JSON.parse(msg)
    } catch(error) {
      self.send({ error: 'Bad JSON' })
    }

    if (!_.isUndefined(request))
      self.emit('request', request)
  })

  self.socket.on('disconnect', function() {
    self.isActive = false
    self.emit('end')
  })
}

inherits(WSClient, Client)

/**
 * @param {Object} response
 */
WSClient.prototype.send = function(data) {
  if (this.isActive)
    this.socket.send(JSON.stringify(data))
}


/**
 * @class WSTransport
 * @param {Interface} interface
 * @param {number} port
 * @param {string} [host]
 */
function WSTransport(interface, port, host) {
  Transport.call(this)

  this._isInialized = false

  this.interface = interface
  this.port = port
  this.host = host

  this.http = http.createServer()
  this.io = socket(this.http, { serveClient: false })
}

inherits(WSTransport, Transport)

/**
 * @return {Q.Promise}
 */
WSTransport.prototype.initialize = function() {
  var self = this
  if (self._isInialized)
    return Q()

  self._isInialized = true

  var deferred = Q.defer()

  self.io.sockets.on('connection', function(socket) {
    self.interface.newClient(new WSClient(socket))
  })

  self.http.on('listening', deferred.resolve)
  self.http.on('error', deferred.reject)
  self.http.listen(self.port, self.host)

  return deferred.promise.then(function() {
    var msg = [
      'Created websocket transport for ',
      self.interface.constructor.name,
      ' interface, listening on ',
      self.host + ':' + self.port
    ].join('')
    console.log(msg)
  })
}


module.exports = WSTransport
