var crypto = require('crypto')

var expect = require('chai').expect
var _ = require('lodash')

var config = require('./config.json')
var fixtures = require('./fixtures/electrum.json')[config.electrum.network]


/**
 * @param {string} data
 * @return {string}
 */
function md5(data) {
  return crypto.createHash('md5').update(new Buffer(data)).digest().toString('hex')
}

/**
 * @param {Object} transport
 */
function electrumTests(data) {
  var transport

  beforeEach(function() {
    transport = data.transport
  })

  function runTestsFromFixtures(fixtures, method) {
    Object.keys(fixtures).forEach(function(key) {
      method = (_.isUndefined(method) ? '' : method + '.') + key
      fixtures = fixtures[key]

      if (!_.isArray(fixtures))
        return runTestsFromFixtures(fixtures, method)

      fixtures.forEach(function(fixture) {
        it(method, function(done) {
          transport.request(method, fixture.params, function(response) {
            expect(md5(JSON.stringify(response))).to.equal(fixture.expect)
            done()
          })
        })
      })
    })
  }

  runTestsFromFixtures(fixtures)
}


module.exports = electrumTests
