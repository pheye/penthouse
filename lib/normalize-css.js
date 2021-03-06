'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

let normalizeCssLauncher = (() => {
  var _ref = _asyncToGenerator(function* ({ browser, css, debuglog }) {
    debuglog('normalizeCss: ' + css.length);

    // escape hex referenced unicode chars in content:'' declarations,
    // i.e. \f091'
    // so they stay in the same format
    const escapedCss = escapeHexRefences(css);
    debuglog('normalizeCss: escaped hex');

    const page = yield browser.newPage();
    debuglog('normalizeCss: new page opened in browser');

    page.on('console', function (msg) {
      // pass through log messages
      debuglog(msg.replace(/^debug: /, ''));
    });

    const html = '<html><head><style>' + escapedCss + '</style></head><body></body></html>';
    yield page.setContent(html);

    const normalized = yield page.evaluate(_normalizeCss2.default, { css });

    // cleanup
    yield page.close();

    return unEscapeCss(normalized);
  });

  return function normalizeCssLauncher(_x) {
    return _ref.apply(this, arguments);
  };
})();

var _jsesc = require('jsesc');

var _jsesc2 = _interopRequireDefault(_jsesc);

var _normalizeCss = require('./browser-sandbox/normalizeCss');

var _normalizeCss2 = _interopRequireDefault(_normalizeCss);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

function unEscapeCss(css) {
  return css.replace(/(['"])\\\\/g, `$1\\`);
}

function escapeHexRefences(css) {
  return css.replace(/(content\s*:\s*)(['"])([^'"]*)(['"])/g, function (match, pre, quote, innerContent, quote2) {
    if (quote !== quote2) {
      return;
    }
    return pre + quote + (0, _jsesc2.default)(innerContent) + quote;
  })
  // .. however it's not perfect for our needs,
  // as we need to be able to convert back to CSS acceptable format.
  // i.e. need to go from `\f` to `\\f` (and then back afterwards),
  // and need to use `\2022` rather than `u2022`...
  // this is not rigourously tested and not following any spec, needs to be improved.
  .replace(/(['"])(\\)([^\\])/g, function (match, quote, slash, firstInnerContentChar) {
    if (firstInnerContentChar === 'u') {
      return quote + slash + slash;
    }
    return quote + slash + slash + firstInnerContentChar;
  });
}

exports.default = normalizeCssLauncher;