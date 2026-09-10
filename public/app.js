(function () {
  'use strict';

  var APPS = [
    {
      id: 'mark-six',
      title: 'Mark Six',
      desc: 'Hong Kong Mark Six lottery results with special numbers, history and daily auto-refresh.',
      href: '/mark-six/'
    }
  ];

  var grid = document.getElementById('appGrid');

  function render() {
    var html = '';
    APPS.forEach(function (a) {
      html +=
        '<a class="app-card" href="' + a.href + '">' +
          '<div class="app-icon ' + a.id + '" aria-hidden="true">6</div>' +
          '<div class="app-title">' + a.title + '</div>' +
          '<div class="app-desc">' + a.desc + '</div>' +
          '<div class="app-link">Open &rarr;</div>' +
        '</a>';
    });
    grid.innerHTML = html;
  }

  render();
})();