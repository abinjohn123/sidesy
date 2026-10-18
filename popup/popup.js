document.addEventListener("DOMContentLoaded", () => {
  // Firefox port: `browser` with `chrome` fallback.
  const ext = globalThis.browser ?? globalThis.chrome;
  const COLLAPSE_DEFAULT_KEY = "sidesy_collapse_by_default";
  const menu = document.getElementById("popup-menu");

  CONSTANTS.POPUP_LINKS.forEach(({ label, description, icon, hoverColor, url, sectionLabel }) => {
    if (sectionLabel) {
      const section = document.createElement("span");
      section.className = "popup-section-label";
      section.textContent = sectionLabel;
      menu.appendChild(section);
    }

    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.style.setProperty("--icon-hover-color", hoverColor);

    const iconContainer = document.createElement("span");
    iconContainer.className = "link-icon";

    // Fetch SVG and inject inline so CSS can color the strokes
    fetch(ext.runtime.getURL(icon))
      .then((res) => res.text())
      .then((svgText) => {
        iconContainer.innerHTML = svgText;
        const svg = iconContainer.querySelector("svg");
        if (svg) {
          svg.removeAttribute("class");
          svg.setAttribute("width", "22");
          svg.setAttribute("height", "22");
        }
      });

    const textContainer = document.createElement("div");
    textContainer.className = "link-text";

    const labelSpan = document.createElement("span");
    labelSpan.className = "link-label";
    labelSpan.textContent = label;

    const descSpan = document.createElement("span");
    descSpan.className = "link-description";
    descSpan.textContent = description;

    textContainer.appendChild(labelSpan);
    textContainer.appendChild(descSpan);

    link.appendChild(iconContainer);
    link.appendChild(textContainer);
    menu.appendChild(link);
  });

  // Pull version dynamically from manifest
  const versionEl = document.getElementById("popup-version");
  if (versionEl) {
    versionEl.textContent = "v" + ext.runtime.getManifest().version;
  }

  // Animated settings page (menu ⇄ settings slide)
  const settingsBtn = document.getElementById("popup-settings-btn");
  const backBtn = document.getElementById("popup-back-btn");
  const collapseToggle = document.getElementById("collapse-default-toggle");

  function openSettings() {
    document.body.classList.add("settings-open");
    settingsBtn?.setAttribute("aria-expanded", "true");
  }

  function closeSettings() {
    document.body.classList.remove("settings-open");
    settingsBtn?.setAttribute("aria-expanded", "false");
  }

  settingsBtn?.addEventListener("click", () => {
    if (document.body.classList.contains("settings-open")) closeSettings();
    else openSettings();
  });
  backBtn?.addEventListener("click", closeSettings);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("settings-open")) {
      closeSettings();
    }
  });

  // "Fold comments by default" preference — read by the content script on
  // each new video to decide whether the sidebar starts folded.
  if (collapseToggle) {
    ext.storage.local.get([COLLAPSE_DEFAULT_KEY]).then((data) => {
      collapseToggle.checked = data[COLLAPSE_DEFAULT_KEY] === true;
    }).catch(() => {});

    collapseToggle.addEventListener("change", () => {
      // Only the default is stored here. The content script applies it to
      // each new video; the last explicit fold state is video-scoped, so it
      // can no longer override the default on a different video.
      ext.storage.local.set({
        [COLLAPSE_DEFAULT_KEY]: collapseToggle.checked,
      }).catch(() => {});
    });
  }
});
