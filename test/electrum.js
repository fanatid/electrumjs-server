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
      var newMethod = (_.isUndefined(method) ? '' : method + '.') + key
      var newFixtures = fixtures[key]

      if (!_.isArray(newFixtures))
        return runTestsFromFixtures(newFixtures, newMethod)

      newFixtures.forEach(function(fixture) {
        it(newMethod, function(done) {
          transport.request(newMethod, fixture.params, function(response) {
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
