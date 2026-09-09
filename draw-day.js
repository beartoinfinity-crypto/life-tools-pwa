function isDrawDay(date) {
  const day = date.getDay();
  return day === 2 || day === 4 || day === 6;
}

function getNextDrawDate(from) {
  const d = new Date(from);
  while (!isDrawDay(d)) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

function shouldRefreshAtMidnight() {
  return isDrawDay(new Date());
}

module.exports = { isDrawDay, getNextDrawDate, shouldRefreshAtMidnight };
