(function (scope) {
  function fitTiles(width, height, count, gap = 12) {
    let best = { width: 0, height: 0, columns: 1 };
    for (let columns = 1; columns <= count; columns++) {
      const rows = Math.ceil(count / columns);
      const tileWidth = Math.max(0, Math.min((width - gap * (columns - 1)) / columns, ((height - gap * (rows - 1)) / rows) * 16 / 9));
      if (tileWidth > best.width) best = { width: tileWidth, height: tileWidth * 9 / 16, columns };
    }
    return best;
  }
  if (typeof module !== 'undefined') module.exports = { fitTiles };
  else scope.screenLayout = { fitTiles };
})(typeof window === 'undefined' ? globalThis : window);
