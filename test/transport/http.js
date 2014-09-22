var events = require('events')
var util = require('util')

var expect = require('chai').expect

var _ = require('lodash')
var request = require('request')


function HTTPTransport(host, port) {
  var self = this

  events.EventEmitter.call(self)

  self.uri = 'http://' + host + ':' + port
  self.nextRequestId = 0
  self.wasError = false

  request({ method: 'GET', uri: self.uri, json: true }, function(error, response) {
    if (error) throw error

    self.sessionId = (response.headers['set-cookie'] || ['='])[0].split('=')[1]
    self.emit('ready')

    self.updateRequest = setInterval(function() {
      var requestOpts = {
        method: 'GET',
        uri: self.uri,
        json: true,
        headers: { 'Cookie': 'SESSION=' + self.sessionId }
      }
      request(requestOpts, function(error, response, body) {
        if (error) throw error
        self.processBody(body)
      })
    }, 1000)
  })
}

util.inherits(HTTPTransport, events.EventEmitter)

HTTPTransport.prototype.processBody = function(body) {
  if (_.isUndefined(body))
    return

  if (!_.isArray(body))
    body = [body]

  body.forEach(function(response) {
    this.emit('response', response)
  }.bind(this))
}

HTTPTransport.prototype.end = function() {
  clearInterval(this.updateRequest)
  this.emit('close', this.wasError)
}

HTTPTransport.prototype.request = function(method, params, cb) {
  var self = this

  var requestId = this.nextRequestId++
  var requestOpts = {
    method: 'POST',
    uri: self.uri,
    json: true,
    headers: { 'Cookie': 'SESSION=' + self.sessionId },
    body: JSON.stringify({ id: requestId, method: method, params: params })
  }

  request(requestOpts, function(error, response, body) {
    if (error) throw error
    self.processBody(body)
  })

  var responseEvent = function(response) {
    if (response.id === requestId) {
      self.removeListener('response', responseEvent)
      cb(response)
    }
  }

  self.on('response', responseEvent)
}


module.exports = {
  HTTPTransport: HTTPTransport
}
