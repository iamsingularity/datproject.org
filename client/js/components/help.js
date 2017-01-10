const html = require('choo/html')
const button = require('../elements/button')

module.exports = (state, prev, send) => {
  if (module.parent || window.location.pathname === '/') return ''
  const intro = () => send('help:show')
  return html`
    ${button({
      icon: '/public/img/question.svg',
      text: 'Help',
      klass: 'btn btn--green btn__reveal-text dat-button--help',
      click: intro
    })}
    `
}
