// quality.js - graphics quality manager for Police vs Protestors
var QUALITY = (function () {
  var LEVELS = {
    high: {
      pixelScale: 1.0, dprCap: 2, fpsCap: 0, placards: true, ghosts: true,
      smoke: 7, nightLights: "full", agentBob: true
    },
    medium: {
      pixelScale: 0.85, dprCap: 1.25, fpsCap: 0, placards: true, ghosts: false,
      smoke: 4, nightLights: "full", agentBob: true
    },
    low: {
      pixelScale: 0.8, dprCap: 1, fpsCap: 30, placards: false, ghosts: false,
      smoke: 2, nightLights: "simple", agentBob: false
    }
  };
  var ORDER = ["high", "medium", "low"];
  var CYCLE_ORDER = ["auto", "high", "medium", "low"];

  var _setting = "auto";
  var _level = "medium";
  var _callback = null;

  // ---- auto adaptation state ----
  var _avgInterval = 0;        // EMA of drawn frame interval (ms)
  var _hasAvg = false;
  var _slowTime = 0;           // accumulated ms below threshold
  var _fastTime = 0;           // accumulated ms above threshold
  var _cooldownUntil = 0;      // no judging until this time
  var _lastFrameTime = 0;
  var _startTime = 0;
  var _avgWork = 0;            // EMA of update+draw ms
  var _hasWork = false;
  var _steppedDownAt = { high: -Infinity, medium: -Infinity };
  var _justSteppedDownFrom = null;
  var _justSteppedDownAt = 0;

  // ---- fps cap accumulator ----
  var _acc = 0;
  var _lastDrawn = 0;
  var _lastNow = 0;
  var _measuredFps = 0;
  var _fpsCount = 0;
  var _fpsTime = 0;

  function nowMs() {
    return (typeof window !== "undefined" && window.performance &&
      window.performance.now) ? window.performance.now() : Date.now();
  }

  // ---- localStorage helpers ----
  function loadSetting() {
    try {
      if (typeof localStorage !== "undefined") {
        var v = localStorage.getItem("ppg_quality");
        if (v === "auto" || v === "high" || v === "medium" || v === "low") {
          return v;
        }
      }
    } catch (e) {}
    return "auto";
  }
  function saveSetting(v) {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("ppg_quality", v);
      }
    } catch (e) {}
  }

  function levelFor(setting) {
    if (setting === "auto") return _level;
    return setting;
  }

  function applyLevel(newLevel) {
    if (newLevel === _level) return false;
    _level = newLevel;
    // reset auto timers on change
    _slowTime = 0;
    _fastTime = 0;
    _cooldownUntil = nowMs() + 4000;
    _acc = 0;
    _lastDrawn = 0;
    if (_callback) {
      try { _callback(_level); } catch (e) {}
    }
    return true;
  }

  function setSetting(v) {
    _setting = v;
    saveSetting(v);
    if (v === "auto") {
      // auto starts at high and steps down only if needed
      applyLevel("high");
    } else {
      applyLevel(v);
    }
    if (_callback) {
      try { _callback(_level); } catch (e) {}
    }
  }

  // init
  _setting = loadSetting();
  _level = (_setting === "auto") ? "high" : _setting;

  // ---- public API ----
  function setting() { return _setting; }
  function level() { return _level; }

  function cycle() {
    var idx = CYCLE_ORDER.indexOf(_setting);
    if (idx < 0) idx = 0;
    var next = CYCLE_ORDER[(idx + 1) % CYCLE_ORDER.length];
    setSetting(next);
    return next;
  }

  function flag(name) {
    var lv = LEVELS[_level];
    return lv[name];
  }

  function pixelRatio() {
    var dpr = 1;
    if (typeof window !== "undefined") {
      dpr = window.devicePixelRatio || 1;
    }
    var lv = LEVELS[_level];
    var capped = Math.min(dpr, lv.dprCap);
    return capped * lv.pixelScale;
  }

  function fps() { return Math.round(_measuredFps * 10) / 10; }

  function label() {
    var name = _level.charAt(0).toUpperCase() + _level.slice(1);
    var s = _setting;
    if (s === "auto") {
      return "Graphics: Auto (" + name + ") " + Math.round(_measuredFps) + " fps";
    }
    return "Graphics: " + name + " " + Math.round(_measuredFps) + " fps";
  }

  function onChange(fn) { _callback = fn; }

  function workTime(ms) {
    if (typeof ms !== "number" || ms < 0) ms = 0;
    if (!_hasWork) {
      _avgWork = ms;
      _hasWork = true;
    } else {
      _avgWork = _avgWork * 0.85 + ms * 0.15;
    }
  }

  function frame(now) {
    if (typeof now !== "number") now = nowMs();
    if (!_startTime) _startTime = now;
    var lv = LEVELS[_level];
    var cap = lv.fpsCap;

    var dt = _lastNow ? (now - _lastNow) : 0;
    _lastNow = now;
    if (dt < 0) dt = 0;
    if (dt > 250) dt = 0; // tab switch: ignore

    // ---- auto measurement (based on drawn frames only) ----
    var drawn = true;

    if (cap > 0) {
      // fps cap accumulator
      _acc += dt;
      var minInterval = 1000 / cap;
      // safety: if too long since drawn, force draw
      var sinceDrawn = _lastDrawn ? (now - _lastDrawn) : 9999;
      if (sinceDrawn > 50) {
        drawn = true;
        _acc = 0;
      } else if (_acc < minInterval) {
        drawn = false;
      } else {
        drawn = true;
        // keep remainder
        _acc = _acc - minInterval;
        if (_acc < 0) _acc = 0;
        if (_acc > minInterval) _acc = minInterval;
      }
    }

    if (drawn) {
      // measure drawn interval
      if (_lastDrawn) {
        var ival = now - _lastDrawn;
        if (ival > 0 && ival <= 250) {
          if (!_hasAvg) {
            _avgInterval = ival;
            _hasAvg = true;
          } else {
            _avgInterval = _avgInterval * 0.9 + ival * 0.1;
          }
          _fpsTime += ival;
          _fpsCount++;
        }
      }
      _lastDrawn = now;

      // update measured fps (window of ~500ms)
      if (_fpsTime >= 500 && _fpsCount > 0) {
        _measuredFps = (_fpsCount * 1000) / _fpsTime;
        _fpsTime = 0;
        _fpsCount = 0;
      }

      // ---- auto adapt ----
      if (_setting === "auto" && _hasAvg && now >= _cooldownUntil &&
          now - _startTime > 2000) {
        var estFps = 1000 / _avgInterval;
        var lowThresh, highThresh, workOk;
        if (cap > 0) {
          lowThresh = 26;
          highThresh = 29.5;
          workOk = _hasWork && _avgWork < 12;
        } else {
          /* medium -> low only when really struggling (low is blurrier) */
          lowThresh = _level === "medium" ? 24 : 34;
          highThresh = 57;
          workOk = true;
        }
        var workDt = Math.min(dt, 100);

        if (estFps < lowThresh) {
          _slowTime += workDt;
          _fastTime = 0;
        } else if (estFps > highThresh) {
          _fastTime += workDt;
          _slowTime = 0;
        } else {
          _slowTime = Math.max(0, _slowTime - workDt * 0.5);
          _fastTime = Math.max(0, _fastTime - workDt * 0.5);
        }

        if (_slowTime >= 3000) {
          _slowTime = 0;
          _fastTime = 0;
          var idx = ORDER.indexOf(_level);
          if (idx >= 0 && idx < ORDER.length - 1) {
            var newLv = ORDER[idx + 1];
            _justSteppedDownFrom = _level;
            _justSteppedDownAt = now;
            applyLevel(newLv);
          }
          _cooldownUntil = now + 4000;
        } else if (_fastTime >= 12000 && workOk) {
          _fastTime = 0;
          _slowTime = 0;
          var idx2 = ORDER.indexOf(_level);
          if (idx2 > 0) {
            var cand = ORDER[idx2 - 1];
            var blocked = false;
            if (_justSteppedDownFrom === cand &&
                (now - _justSteppedDownAt) < 60000) {
              blocked = true;
            }
            // also check history map for that level
            if (!blocked && _steppedDownAt[cand] !== undefined &&
                (now - _steppedDownAt[cand]) < 60000) {
              blocked = true;
            }
            if (!blocked) {
              applyLevel(cand);
            }
          }
          _cooldownUntil = now + 4000;
        }
      }
    }

    return drawn;
  }

  return {
    setting: setting,
    level: level,
    cycle: cycle,
    flag: flag,
    pixelRatio: pixelRatio,
    frame: frame,
    workTime: workTime,
    fps: fps,
    label: label,
    onChange: onChange
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = QUALITY;
