document.addEventListener("DOMContentLoaded", () => {
  const menu = document.getElementById("popup-menu");

  CONSTANTS.POPUP_LINKS.forEach(({ label, description, icon, hoverColor, url }) => {
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
