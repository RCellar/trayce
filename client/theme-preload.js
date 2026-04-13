try {
  const saved = localStorage.getItem("trayce-theme");
  if (saved) {
    const t = JSON.parse(saved);
    const r = document.documentElement.style;
    if (t.vars) for (const [k, v] of Object.entries(t.vars)) r.setProperty(k, v);
  }
} catch {}
