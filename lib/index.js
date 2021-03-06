'use strict';

let browserIsRunning = (() => {
  var _ref2 = _asyncToGenerator(function* () {
    try {
      // will throw 'Not opened' error if browser is not running
      yield browser.version();
      return true;
    } catch (e) {
      return false;
    }
  });

  return function browserIsRunning() {
    return _ref2.apply(this, arguments);
  };
})();

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

var _cssForkPocketjoso = require('css-fork-pocketjoso');

var _cssForkPocketjoso2 = _interopRequireDefault(_cssForkPocketjoso);

var _puppeteer = require('puppeteer');

var _puppeteer2 = _interopRequireDefault(_puppeteer);

var _core = require('./core');

var _core2 = _interopRequireDefault(_core);

var _normalizeCss = require('./normalize-css');

var _normalizeCss2 = _interopRequireDefault(_normalizeCss);

var _nonMatchingMediaQueryRemover = require('./non-matching-media-query-remover');

var _nonMatchingMediaQueryRemover2 = _interopRequireDefault(_nonMatchingMediaQueryRemover);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

const DEFAULT_VIEWPORT_WIDTH = 1300; // px
const DEFAULT_VIEWPORT_HEIGHT = 900; // px
const DEFAULT_TIMEOUT = 30000; // ms
const DEFAULT_MAX_EMBEDDED_BASE64_LENGTH = 1000; // chars
const DEFAULT_USER_AGENT = 'Penthouse Critical Path CSS Generator';
const DEFAULT_RENDER_WAIT_TIMEOUT = 100;
const DEFAULT_BLOCK_JS_REQUESTS = true;
const DEFAULT_PROPERTIES_TO_REMOVE = ['(.*)transition(.*)', 'cursor', 'pointer-events', '(-webkit-)?tap-highlight-color', '(.*)user-select'];

function exitHandler() {
  if (browser && browser.close) {
    browser.close();
    browser = null;
  }
  process.exit(0);
}

// shared between penthouse calls
let browser = null;
let _browserLaunchPromise = null;
// browser.pages is not implemented, so need to count myself to not close browser
// until all pages used by penthouse are closed (i.e. individual calls are done)
let _browserPagesOpen = 0;
const launchBrowserIfNeeded = (() => {
  var _ref = _asyncToGenerator(function* (debuglog) {
    if (browser) {
      return;
    }
    if (!_browserLaunchPromise) {
      debuglog('no browser instance, launching new browser..');
      _browserLaunchPromise = _puppeteer2.default.launch({
        ignoreHTTPSErrors: true,
        args: ['--disable-setuid-sandbox', '--no-sandbox']
      }).then(function (browser) {
        debuglog('new browser launched');
        return browser;
      });
    }
    browser = yield _browserLaunchPromise;
    _browserLaunchPromise = null;
  });

  return function launchBrowserIfNeeded(_x) {
    return _ref.apply(this, arguments);
  };
})();

function readFilePromise(filepath, encoding) {
  return new Promise((resolve, reject) => {
    _fs2.default.readFile(filepath, encoding, (err, content) => {
      if (err) {
        return reject(err);
      }
      resolve(content);
    });
  });
}

function prepareForceIncludeForSerialization(forceInclude = []) {
  // need to annotate forceInclude values to allow RegExp to pass through JSON serialization
  return forceInclude.map(function (forceIncludeValue) {
    if (typeof forceIncludeValue === 'object' && forceIncludeValue.constructor.name === 'RegExp') {
      return {
        type: 'RegExp',
        source: forceIncludeValue.source,
        flags: forceIncludeValue.flags
      };
    }
    return { value: forceIncludeValue };
  });
}

const astFromCss = (() => {
  var _ref3 = _asyncToGenerator(function* (options, { debuglog, stdErr }) {
    const css = options.cssString.replace(/￿/g, '\f042');

    let ast = _cssForkPocketjoso2.default.parse(css, { silent: true });
    const parsingErrors = ast.stylesheet.parsingErrors.filter(function (err) {
      // the forked version of the astParser used fixes these errors itself
      return err.reason !== 'Extra closing brace';
    });
    if (parsingErrors.length === 0) {
      stdErr += debuglog('parsed ast (without errors)');
      return ast;
    }

    // had breaking parsing errors
    // NOTE: only informing about first error, even if there were more than one.
    const parsingErrorMessage = parsingErrors[0].message;
    if (options.strict === true) {
      // TODO: filename will be 'undefined', could enhance this error message
      throw new Error(parsingErrorMessage);
    }

    stdErr += debuglog("Failed ast formatting css '" + parsingErrorMessage + "': ");

    let normalizedCss;
    try {
      _browserPagesOpen++;
      debuglog('adding browser page for normalize, now: ' + _browserPagesOpen);
      normalizedCss = yield (0, _normalizeCss2.default)({
        css,
        browser,
        debuglog
      });
      _browserPagesOpen--;
      debuglog('removing browser page for normalize, now: ' + _browserPagesOpen);
    } catch (e) {
      _browserPagesOpen--;
      debuglog('removing browser page for normalize after error, now: ' + _browserPagesOpen);
      throw e;
    }

    stdErr += debuglog('normalized css: ' + (normalizedCss ? normalizedCss.length : typeof normalizedCss));
    if (!normalizedCss) {
      throw new Error("Failed to normalize CSS errors. Run Penthouse with 'strict: true' option to see these css errors.");
    }
    ast = _cssForkPocketjoso2.default.parse(normalizedCss, { silent: true });
    stdErr += debuglog('parsed normalised css into ast');
    const finalParsingErrors = ast.stylesheet.parsingErrors.filter(function (err) {
      // the forked version of the astParser used fixes these errors itself
      return err.reason !== 'Extra closing brace';
    });
    if (finalParsingErrors.length > 0) {
      stdErr += debuglog('..with parsingErrors: ' + finalParsingErrors[0].reason);
    }
    return ast;
  });

  function astFromCss(_x2, _x3) {
    return _ref3.apply(this, arguments);
  }

  return astFromCss;
})();

// const so not hoisted, so can get regeneratorRuntime inlined above, needed for Node 4
const generateCriticalCssWrapped = (() => {
  var _ref4 = _asyncToGenerator(function* (options, ast, { debuglog, stdErr, START_TIME, forceTryRestartBrowser }) {
    const width = parseInt(options.width || DEFAULT_VIEWPORT_WIDTH, 10);
    const height = parseInt(options.height || DEFAULT_VIEWPORT_HEIGHT, 10);
    const timeoutWait = options.timeout || DEFAULT_TIMEOUT;

    // Merge properties with default ones
    const propertiesToRemove = options.propertiesToRemove || DEFAULT_PROPERTIES_TO_REMOVE;
    // first strip out non matching media queries
    const astRules = (0, _nonMatchingMediaQueryRemover2.default)(ast.stylesheet.rules, width, height);
    stdErr += debuglog('stripped out non matching media queries');

    // always forceInclude '*', 'html', and 'body' selectors
    const forceInclude = prepareForceIncludeForSerialization([{ value: '*' }, { value: 'html' }, { value: 'body' }].concat(options.forceInclude || []));

    // promise so we can handle errors and reject,
    // instead of throwing what would otherwise be uncaught errors in node process
    return new Promise((() => {
      var _ref5 = _asyncToGenerator(function* (resolve, reject) {
        const cleanupAndExit = function cleanupAndExit({ returnValue, error }) {
          process.removeListener('exit', exitHandler);
          process.removeListener('SIGTERM', exitHandler);
          process.removeListener('SIGINT', exitHandler);

          if (error) {
            reject(error);
          } else {
            resolve(returnValue);
          }
        };

        stdErr += debuglog('call generateCriticalCssWrapped');
        let formattedCss, retval;
        try {
          _browserPagesOpen++;
          debuglog('adding browser page for generateCriticalCss, now: ' + _browserPagesOpen);
          retval = yield (0, _core2.default)({
            browser,
            url: options.url,
            astRules,
            width,
            height,
            forceInclude,
            userAgent: options.userAgent || DEFAULT_USER_AGENT,
            renderWaitTime: options.renderWaitTime || DEFAULT_RENDER_WAIT_TIMEOUT,
            timeout: timeoutWait,
            blockJSRequests: typeof options.blockJSRequests !== 'undefined' ? options.blockJSRequests : DEFAULT_BLOCK_JS_REQUESTS,
            customPageHeaders: options.customPageHeaders,
            screenshots: options.screenshots,
            // postformatting
            propertiesToRemove,
            maxEmbeddedBase64Length: typeof options.maxEmbeddedBase64Length === 'number' ? options.maxEmbeddedBase64Length : DEFAULT_MAX_EMBEDDED_BASE64_LENGTH,
            debuglog,
            htmltag: options.htmltag
          });
          _browserPagesOpen--;
          debuglog('remove browser page for generateCriticalCss, now: ' + _browserPagesOpen);
        } catch (e) {
          _browserPagesOpen--;
          debuglog('remove browser page for generateCriticalCss after ERROR, now: ' + _browserPagesOpen);
          if (!forceTryRestartBrowser && !(yield browserIsRunning())) {
            console.error('Chromium unexpecedly not opened - crashed? ' + '\n_browserPagesOpen: ' + (_browserPagesOpen + 1) + '\nurl: ' + options.url + '\nastRules: ' + astRules.length);
            // for some reason Chromium is no longer opened;
            // perhaps it crashed
            if (_browserLaunchPromise) {
              // in this case the browser is already restarting
              yield _browserLaunchPromise;
            } else {
              console.log('restarting chrome after crash');
              browser = null;
              yield launchBrowserIfNeeded(debuglog);
            }
            // retry
            resolve(generateCriticalCssWrapped(options, ast, {
              debuglog,
              stdErr,
              START_TIME,
              forceTryRestartBrowser
            }));
            return;
          }
          stdErr += e;
          const err = new Error(stdErr);
          err.stderr = stdErr;
          cleanupAndExit({ error: err });
          return;
        }
        formattedCss = retval.formattedCss;
        stdErr += debuglog('generateCriticalCss done');
        if (formattedCss.trim().length === 0) {
          // TODO: this error should surface to user
          stdErr += debuglog('Note: Generated critical css was empty for URL: ' + options.url);
          cleanupAndExit({ returnValue: '' });
          return;
        }

        cleanupAndExit({ returnValue: retval });
      });

      return function (_x7, _x8) {
        return _ref5.apply(this, arguments);
      };
    })());
  });

  function generateCriticalCssWrapped(_x4, _x5, _x6) {
    return _ref4.apply(this, arguments);
  }

  return generateCriticalCssWrapped;
})();

const m = module.exports = function (options, callback) {
  // init logging and debug output
  _normalizeCss2.default.DEBUG = m.DEBUG;
  const START_TIME = Date.now();
  const debuglog = function debuglog(msg, isError) {
    if (m.DEBUG) {
      const errMsg = 'time: ' + (Date.now() - START_TIME) + ' | ' + (isError ? 'ERR: ' : '') + msg;
      console.error(errMsg);
      return errMsg;
    }
    return '';
  };
  const logging = {
    debuglog,
    stdErr: '',
    START_TIME
  };

  process.on('exit', exitHandler);
  process.on('SIGTERM', exitHandler);
  process.on('SIGINT', exitHandler);

  return new Promise((() => {
    var _ref6 = _asyncToGenerator(function* (resolve, reject) {
      // still supporting legacy callback way of calling Penthouse
      const cleanupAndExit = function cleanupAndExit({ returnValue, error = null }) {
        if (browser && !options.unstableKeepBrowserAlive) {
          if (_browserPagesOpen > 0) {
            debuglog('keeping browser open as _browserPagesOpen: ' + _browserPagesOpen);
          } else {
            browser.close();
            browser = null;
            _browserLaunchPromise = null;
            debuglog('closed browser');
          }
        }

        if (callback) {
          callback(error, returnValue);
          return;
        }
        if (error) {
          reject(error);
        } else {
          resolve(returnValue);
        }
      };

      // support legacy mode of passing in css file path instead of string
      if (!options.cssString && options.css) {
        try {
          let cssString = '';
          if (typeof options.css === 'string') {
            cssString = yield readFilePromise(options.css, 'utf8');
          } else {
            console.log('options:', options.css);
            var _iteratorNormalCompletion = true;
            var _didIteratorError = false;
            var _iteratorError = undefined;

            try {
              for (var _iterator = options.css[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
                let file = _step.value;

                cssString += yield readFilePromise(file, 'utf8');
              }
            } catch (err) {
              _didIteratorError = true;
              _iteratorError = err;
            } finally {
              try {
                if (!_iteratorNormalCompletion && _iterator.return) {
                  _iterator.return();
                }
              } finally {
                if (_didIteratorError) {
                  throw _iteratorError;
                }
              }
            }
          }
          options = Object.assign({}, options, { cssString });
        } catch (err) {
          debuglog('error reading css file: ' + options.css + ', error: ' + err);
          cleanupAndExit({ error: err });
          return;
        }
      }
      if (!options.cssString) {
        debuglog('Passed in css is empty');
        cleanupAndExit({ error: new Error('css should not be empty') });
        return;
      }

      yield launchBrowserIfNeeded(debuglog);
      try {
        const ast = yield astFromCss(options, logging);
        const criticalCss = yield generateCriticalCssWrapped(options, ast, logging);
        cleanupAndExit({ returnValue: criticalCss });
      } catch (err) {
        cleanupAndExit({ error: err });
      }
    });

    return function (_x9, _x10) {
      return _ref6.apply(this, arguments);
    };
  })());
};