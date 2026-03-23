export function showToast(message: string, durationMs = 3000): void {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  container.appendChild(el);

  requestAnimationFrame(() => el.classList.add("show"));

  setTimeout(() => {
    el.classList.remove("show");
    el.addEventListener("transitionend", () => el.remove());
  }, durationMs);
}
