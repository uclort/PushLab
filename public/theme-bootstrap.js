(() => {
  try {
    const stored = JSON.parse(localStorage.getItem("pushlab-appearance-preferences") || "{}");
    const colorMode = ["system", "light", "dark"].includes(stored.colorMode) ? stored.colorMode : "system";
    const theme =
      colorMode === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : colorMode;
    document.documentElement.dataset.theme = theme;
  } catch {
    document.documentElement.dataset.theme = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
})();
