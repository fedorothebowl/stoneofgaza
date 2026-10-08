export const isMobile = /Android|iPhone|iPad|iPod|Touch/i.test(navigator.userAgent)
  || ('ontouchstart' in window && navigator.maxTouchPoints > 1);
