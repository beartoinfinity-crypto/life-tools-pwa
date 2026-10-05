/**
 * Web Worker wrapper around the prediction engine. The main thread posts a
 * generate/backtest request here when the analysed history exceeds 500 draws
 * (or Monte Carlo runs more than 10,000 loops), so heavy maths never blocks
 * the UI. In a browser this loads the engine via importScripts; under Node
 * tests it falls back to require.
 */
var scope = typeof self !== 'undefined' ? self : globalThis;
var engineAPI = null;

if (typeof importScripts === 'function') {
  importScripts('./prediction-engine.js');
  engineAPI = scope.MarksixEngine;
} else if (typeof require === 'function') {
  engineAPI = require('./prediction-engine');
}

scope.onmessage = function (event) {
  var msg = event && event.data;
  if (!msg) return;
  try {
    var result = engineAPI.generatePick(msg.strategy, msg.draws, msg.config);
    var bt = msg.wantBacktest
      ? engineAPI.backtest(msg.strategy, msg.draws, msg.config, msg.backtestOpts)
      : null;
    scope.postMessage({ id: msg.id, ok: true, result: result, backtest: bt });
  } catch (err) {
    scope.postMessage({ id: msg.id, ok: false, error: String((err && err.message) || err) });
  }
};
