// Tiny no-framework test harness for the pages in tests/. Each test page
// calls test(name, fn) and then report() once its tests are registered.
(function () {
  const tests = [];

  window.test = (name, fn) => tests.push({ name, fn });

  window.eq = (actual, expected, label = "") => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new Error(`${label ? label + ": " : ""}expected ${e}, got ${a}`);
  };

  window.ok = (value, label = "value") => {
    if (!value) throw new Error(`${label} should be truthy, got ${JSON.stringify(value)}`);
  };

  window.report = async () => {
    const list = document.getElementById("results");
    let failed = 0;
    for (const t of tests) {
      const li = document.createElement("li");
      try {
        await t.fn();
        li.className = "pass";
        li.textContent = `PASS  ${t.name}`;
      } catch (err) {
        failed++;
        li.className = "fail";
        li.textContent = `FAIL  ${t.name} — ${err.message}`;
      }
      list.appendChild(li);
    }
    const summary = document.getElementById("summary");
    summary.textContent = failed ? `${failed} of ${tests.length} failed` : `All ${tests.length} passed`;
    summary.className = `summary ${failed ? "fail" : "pass"}`;
    document.title = `${failed ? "FAIL" : "PASS"} ${tests.length - failed}/${tests.length}`;
  };
})();
