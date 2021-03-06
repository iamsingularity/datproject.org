const html = require('choo/html')
const panel = require('./auth/user-panel')
const button = require('../elements/button')
const importButton = require('../elements/import-button')
const message = require('../elements/message')

const header = (state, prev, send) => {
  return html`<div>
    ${panel(state, prev, send)}
    <header class="site-header">
      ${message(state.message)}
      <div class="container container--top-bar">
        <div class="site-header__wrapper">
          <a href="/" data-no-routing class="dat-logo dat-logo--on-dark">
            <img src="/public/img/dat-hexagon.svg" />
            <span class="dat-logo__word">Dat</span>
          </a>
          <div class="site-header__actions">
            ${importButton({
              handler: function (link) { window.location.href = '/' + link }
            })}
            ${button({
              icon: '/public/img/create-new-dat.svg',
              text: 'Create new Dat',
              klass: 'btn btn--white new-dat',
              click: function () { window.location.href = '/install' }
            })}
          </div>
        </div>
      </div>
    </header>
  </div>`
}

module.exports = header
