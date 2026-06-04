// Switch to Last Used Desktop  --  KWin script for Plasma 6 (Wayland).
//
// Behaviour (bound to Meta+Tab by default):
//   * A single press jumps to the most recently used virtual desktop.
//   * Rapid, repeated presses cycle through every desktop in most-recently-used
//     order (like Alt+Tab does for windows), wrapping around.
//   * Pausing, or switching desktops by any other means (pager, other shortcut,
//     window activation), "settles" the order so the next press starts fresh.
//
// The KWin JavaScript engine has no timer/setTimeout, so a press is classified as
// part of an ongoing cycle ("burst") versus a fresh press purely from the elapsed
// time between activations, measured with Date.now().

// Presses closer together than this (milliseconds) are treated as one cycling burst.
var BURST_MS = 800;
var DEBUG = false;

function log(m) { if (DEBUG) console.info("lastuseddesktop: " + m); }

// MRU list of virtual-desktop ids (uuid strings), most-recently-used first.
var mru = [];
var lastPress = 0;        // timestamp of the previous activation
var cycleIndex = 0;       // position within mru during the current burst
var selfSwitching = false; // true while we change the desktop ourselves

function liveIds() {
    return workspace.desktops.map(function (d) { return d.id; });
}

function desktopById(id) {
    var ds = workspace.desktops;
    for (var i = 0; i < ds.length; i++) {
        if (ds[i].id === id) return ds[i];
    }
    return null;
}

// Keep mru in sync with the desktops that currently exist: drop removed ones,
// append newly created ones (at the back, i.e. least-recently-used).
function reconcile() {
    var live = liveIds();
    mru = mru.filter(function (id) { return live.indexOf(id) !== -1; });
    for (var i = 0; i < live.length; i++) {
        if (mru.indexOf(live[i]) === -1) mru.push(live[i]);
    }
}

function promote(id) {
    mru = mru.filter(function (x) { return x !== id; });
    mru.unshift(id);
}

function currentId() {
    return workspace.currentDesktop.id;
}

function switchTo(id) {
    var d = desktopById(id);
    if (!d) return;
    selfSwitching = true;
    workspace.currentDesktop = d;
    selfSwitching = false;
}

function onShortcut() {
    reconcile();
    if (mru.length < 2) return;

    var now = Date.now();
    var continuation = (now - lastPress) < BURST_MS;
    lastPress = now;

    if (continuation) {
        // Still cycling: advance to the next desktop in MRU order, wrapping around.
        cycleIndex = (cycleIndex + 1) % mru.length;
    } else {
        // Fresh press: settle wherever we are, then jump to the previously used desktop.
        promote(currentId());
        cycleIndex = 1;
    }
    log("activate " + (continuation ? "cycle" : "fresh") + " -> idx " + cycleIndex + " of [" + mru.join(",") + "]");
    switchTo(mru[cycleIndex]);
}

function onDesktopChanged() {
    if (selfSwitching) return; // our own burst switches are handled by onShortcut
    // The user moved away by other means: settle immediately.
    reconcile();
    promote(currentId());
    lastPress = 0;
    cycleIndex = 0;
    log("external switch, mru=[" + mru.join(",") + "]");
}

function init() {
    reconcile();
    promote(currentId());
    registerShortcut("Switch to Last Used Desktop",
                     "Switch to Last Used Desktop",
                     "Meta+Tab",
                     onShortcut);
    workspace.currentDesktopChanged.connect(onDesktopChanged);
    log("loaded, " + mru.length + " desktops");
}

init();
