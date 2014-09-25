var http = require('http')
var inherits = require('util').inherits

var _ = require('lodash')
var Q = require('q')

var Client = require('./client')
var logger = require('../logger').logger
var Transport = require('./transport')


/**
 * @class HTTPClient
 * @extends Client
 */
function HTTPClient() {
  Client.call(this)

  this.isActive = true
  this.restartDestroyTimeout()
  this.responses = []
}

inherits(HTTPClient, Client)

/**
 * @param {Object} response
 */
HTTPClient.prototype.send = function(response) {
  this.responses.push(JSON.stringify(response))
}

/**
 * @param {Object} request
 */
HTTPClient.prototype.request = function(request) {
  if (!this.isActive)
    return

  this.restartDestroyTimeout()
  this.emit('request', request)
}

/**
 * @return {*[]}
 */
HTTPClient.prototype.getResponses = function() {
  var result = this.responses
  this.responses = []
  return result
}

/**
 */
HTTPClient.prototype.restartDestroyTimeout = function() {
  if (!_.isUndefined(this.destroyTimeout))
    clearTimeout(this.destroyTimeout)

  this.destroyTimeout = setTimeout(this.destroy.bind(this), 60*1000)
}

/**
 */
HTTPClient.prototype.destroy = function() {
  this.isActive = false
  this.emit('end')
}


/**
 * @class HTTPTransport
 * @param {Interface} interface
 * @param {number} port
 * @param {string} [host]
 */
function HTTPTransport(interface, port, host) {
  Transport.call(this)

  this._isInialized = false

  this.interface = interface
  this.port = port
  this.host = host

  var clients = {}
  setInterval(function() {
    Object.keys(clients).forEach(function(sessionId) {
      if (!clients[sessionId].isActive)
        delete clients[sessionId]
    })
  }, 6000)

  this.http = http.createServer(function(request, response) {
    function process(data) {
      var sessionId = (request.headers.cookie || '').split('=')[1]
      if (_.isUndefined(sessionId)) {
        var client = new HTTPClient()
        sessionId = client.getId()
        interface.newClient(client)
        clients[sessionId] = client
      }

      if (_.isUndefined(clients[sessionId])) {
        response.writeHead(418, { 'Content-Length': 17, 'Content-Type': 'text/plain' })
        response.end('Session not found')
        return
      }

      var reqEntries
      try {
        reqEntries = JSON.parse(data)
        if (!_.isArray(reqEntries))
          reqEntries = [reqEntries]

      } catch(error) {
        response.writeHead(400, { 'Content-Length': 8, 'Content-Type': 'text/plain' })
        response.end('Bad JSON')
        return

      }

      reqEntries.forEach(function(reqEntry) {
        clients[sessionId].request(reqEntry)
      })

      var body = ''
      var responses = clients[sessionId].getResponses()
      if (responses.length === 1)
        body = responses[0]
      if (responses.length > 1)
        body = '[' + responses.join(',') + ']'

      response.writeHead(200, {
        'Content-Length': body.length,
        'Content-Type': 'application/json',
        'Set-Cookie': 'SESSION=' + sessionId
      })
      response.end(body)
    }
    
    if (request.method === 'POST') {
      var body = ''

      request.on('data', function(data) {
        body += data

        if (body.length > 1048576)
          request.connection.destroy()
      })

      request.on('end', function() {
        process(body)
      })

    } else if (request.method === 'GET') {
      process('[]')

    }
  }.bind(this))
}

inherits(HTTPTransport, Transport)

/**
 * @return {Q.Promise}
 */
HTTPTransport.prototype.initialize = function() {
  var self = this
  if (self._isInialized)
    return Q()

  self._isInialized = true

  var deferred = Q.defer()

  self.http.on('listening', deferred.resolve)
  self.http.on('error', deferred.reject)
  self.http.listen(self.port, self.host)

  return deferred.promise.then(function() {
    logger.info('Created HTTP transport for %s interface, listening on %s:%s',
      self.interface.constructor.name, self.host, self.port)
  })
}


module.exports = {
  HTTPTransport: HTTPTransport
}
