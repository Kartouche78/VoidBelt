(function () {
  "use strict";

  var script = document.currentScript;
  var previous = script && script.getAttribute("data-previous");
  var next = script && script.getAttribute("data-next");
  var view = document.querySelector(".view");
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var total = 0;
  var lastWheel = 0;
  var leaving = false;
  var touchY = null;

  if (!view || (!previous && !next)) return;

  function atTop() {
    return view.scrollTop <= 1;
  }

  function atBottom() {
    return view.scrollTop + view.clientHeight >= view.scrollHeight - 1;
  }

  function gameIsBusy() {
    return !!document.pointerLockElement ||
      !!document.querySelector(".gmodal:not([hidden])");
  }

  function go(url, direction) {
    if (!url || leaving || gameIsBusy()) return;
    leaving = true;
    document.body.classList.add("page-leaving", direction > 0 ? "page-leaving-next" : "page-leaving-previous");
    window.setTimeout(function () {
      window.location.href = url;
    }, reduced ? 0 : 220);
  }

  window.addEventListener("wheel", function (event) {
    if (event.ctrlKey || gameIsBusy()) return;

    var now = performance.now();
    if (now - lastWheel > 180) total = 0;
    lastWheel = now;

    var direction = event.deltaY > 0 ? 1 : -1;
    var boundary = direction > 0 ? atBottom() : atTop();
    var url = direction > 0 ? next : previous;

    if (!boundary || !url) {
      total = 0;
      return;
    }

    total = total && Math.sign(total) !== direction ? 0 : total;
    total += Math.abs(event.deltaY) * direction;
    if (Math.abs(total) >= 90) go(url, direction);
  }, { passive: true });

  view.addEventListener("touchstart", function (event) {
    touchY = event.touches.length === 1 ? event.touches[0].clientY : null;
  }, { passive: true });

  view.addEventListener("touchend", function (event) {
    if (touchY === null || !event.changedTouches.length || gameIsBusy()) return;
    var distance = touchY - event.changedTouches[0].clientY;
    touchY = null;
    if (Math.abs(distance) < 70) return;
    if (distance > 0 && atBottom()) go(next, 1);
    if (distance < 0 && atTop()) go(previous, -1);
  }, { passive: true });
})();
