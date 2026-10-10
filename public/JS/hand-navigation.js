export function createHandNavigation(track, previous, next) {
  const win = track.ownerDocument.defaultView;
  function update() {
    const overflow = track.scrollWidth > track.clientWidth + 2;
    previous.hidden = next.hidden = !overflow;
    previous.disabled = !overflow || track.scrollLeft <= 2;
    next.disabled =
      !overflow ||
      track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
    track.classList.toggle("has-overflow", overflow);
  }
  function navigate(direction) {
    const amount = Math.max(100, track.clientWidth * 0.75) * direction;
    track.scrollBy({
      left: amount,
      behavior: win.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }
  previous.onclick = () => navigate(-1);
  next.onclick = () => navigate(1);
  track.addEventListener("scroll", update, { passive: true });
  win.addEventListener("resize", update);
  const observer = win.ResizeObserver ? new win.ResizeObserver(update) : null;
  observer?.observe(track);
  return {
    update,
    close() {
      observer?.disconnect();
      win.removeEventListener("resize", update);
      track.removeEventListener("scroll", update);
    },
  };
}
