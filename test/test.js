var dns = require('dns')

var expect = require('chai').expect
var _ = require('lodash')

var runElectrumTests = require('./interface/electrum').runElectrumTests
var TCPTransport = require('./transport/tcp').TCPTransport
var HTTPTransport = require('./transport/http').HTTPTransport

var config = {
  network: 'bitcoin',
  electrum: {
    tcp: {
      host: 'ecdsa.net',
      port: 50001
    },
    http: {
      host: 'electrum.thwg.org',
      port: 8081
    }
  }
}


describe('Electrum interface', function() {
  var params = { network: config.network }

  if (!_.isUndefined(config.electrum.tcp))
  describe('TCP transport', function() {
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

    runElectrumTests(params)
  })

  if (!_.isUndefined(config.electrum.http))
  describe('HTTP transport', function() {
    beforeEach(function(done) {
      params.transport = new HTTPTransport(config.electrum.http.host, config.electrum.http.port)
      params.transport.once('ready', done)
    })

    afterEach(function(done) {
      params.transport.on('close', function(had_error) {
        expect(had_error).to.be.false
        done()
      })
      params.transport.end()
    })

    runElectrumTests(params)
  })
})
