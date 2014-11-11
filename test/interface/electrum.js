var expect = require('chai').expect

var fixtures = require('../fixtures/electrum.json')


/**
 * @param {Object} data
 */
function runElectrumTests(data) {
  var transport

  beforeEach(function () {
    transport = data.transport
  })

  var exceptMethods = [
    'blockchain.headers.subscribe',
    'blockchain.numblocks.subscribe',
    'blockchain.estimatefee',
    'server.banner',
    'server.donation_address',
    'server.peers.subscribe'
  ]

  Object.keys(fixtures[data.network]).forEach(function (method) {
    fixtures[data.network][method].forEach(function (fixture) {
      it(method, function (done) {
        transport.request(method, fixture.params, function (response) {
          if (exceptMethods.indexOf(method) !== -1) {
            expect(response.result).to.be.not.undefined
          } else {
            expect(response.result).to.deep.equal(fixture.expect)
          }

          done()
        })
      })
    })
  })
}


module.exports = {
  runElectrumTests: runElectrumTests
}
