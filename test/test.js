var dns = require('dns')

var expect = require('chai').expect
var _ = require('lodash')

var runElectrumTests = require('./interface/electrum').runElectrumTests
var TCPTransport = require('./transport/tcp').TCPTransport
var HTTPTransport = require('./transport/http').HTTPTransport
var WSTransport = require('./transport/ws').WSTransport

var config = require('./config.yml')


/**
 * @callback resolveHost~callback
 * @param {address}
 */

/**
 * @param {string} host
 * @param {resolveHost~callback}
 */
function resolveHost(host, cb) {
  dns.resolve(host, function(error, addresses) {
    var isResolved = (error === null && addresses.length > 0)
    expect(isResolved).to.be.true

    cb(addresses[0])
  })
}


describe('Electrum interface', function() {
  var params = { network: config.network }

  afterEach(function(done) {
    params.transport.once('close', function(had_error) {
      expect(had_error).to.be.false
      done()
    })
    params.transport.end()
  })

  if (!_.isUndefined(config.electrum.tcp))
  describe('TCP transport', function() {
    beforeEach(function(done) {
      resolveHost(config.electrum.tcp.host, function(address) {
        params.transport = new TCPTransport(address, config.electrum.tcp.port)
        params.transport.once('ready', done)
      })
    })

    runElectrumTests(params)
  })

  if (!_.isUndefined(config.electrum.http))
  describe('HTTP transport', function() {
    beforeEach(function(done) {
      params.transport = new HTTPTransport(config.electrum.http.host, config.electrum.http.port)
      params.transport.once('ready', done)
    })

    runElectrumTests(params)
  })

  if (!_.isUndefined(config.electrum.ws))
  describe('WebSocket transport', function() {
    beforeEach(function(done) {
      params.transport = new WSTransport(config.electrum.ws.host, config.electrum.ws.port)
      params.transport.once('ready', done)
    })

    runElectrumTests(params)
  })
})
