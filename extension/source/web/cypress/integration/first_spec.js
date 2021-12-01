// first_spec.js created with Cypress
//
// Start writing your Cypress tests below!
// If you're unfamiliar with how Cypress works,
// check out the link below and learn how to write your first test:
// https://on.cypress.io/writing-first-test
import fixture from '../fixtures/example.json';

describe('wallet controller tests', () => {
  it('Does not do much', () => {
    cy.visit('https://github.com/');

    expect(fixture.name).to.equal('Using fixtures to represent data')
  })
})
