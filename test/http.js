var expect = require('chai').expect

var config = require('./config.json')
var electrumTest = require('./electrum')


function HTTPTransport(host, port) {
  
}

describe.skip('http transport', function() {
  var params = {}

  beforeEach(function() {
    params.transport = new HTTPTransport(config.electrum.http.host, config.electrum.http.port)
  })

  afterEach(function(done) {
    done()
  })

  electrumTest(params)
})
