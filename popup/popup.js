document.addEventListener("DOMContentLoaded", () => {
  const menu = document.getElementById("popup-menu");
  const autoScrollSwitch = document.getElementById("auto-scroll-comments");
  const settingError = document.getElementById("setting-error");

  chrome.storage.local.get(["auto_scroll_on_toggle"])
    .then((data) => {
      autoScrollSwitch.checked = data.auto_scroll_on_toggle !== false;
      autoScrollSwitch.disabled = false;
    })
    .catch(() => {
      settingError.textContent = "Couldn't load this setting. Reopen the popup to try again.";
      settingError.hidden = false;
    });

  autoScrollSwitch.addEventListener("change", async () => {
    const enabled = autoScrollSwitch.checked;
    autoScrollSwitch.disabled = true;
    settingError.hidden = true;
    try {
      await chrome.storage.local.set({ auto_scroll_on_toggle: enabled });
    } catch {
      autoScrollSwitch.checked = !enabled;
      settingError.textContent = "Couldn't save this setting. Please try again.";
      settingError.hidden = false;
    } finally {
      autoScrollSwitch.disabled = false;
    }
  });

  CONSTANTS.POPUP_LINKS.forEach(({ label, description, icon, hoverColor, url, sectionLabel }) => {
    if (sectionLabel) {
      const section = document.createElement("h2");
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
    fetch(chrome.runtime.getURL(icon))
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
    versionEl.textContent = "v" + chrome.runtime.getManifest().version;
  }
});
