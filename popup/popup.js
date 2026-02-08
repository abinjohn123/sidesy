document.addEventListener("DOMContentLoaded", () => {
  const menu = document.getElementById("popup-menu");

  CONSTANTS.POPUP_LINKS.forEach(({ label, description, icon, url }) => {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    const iconImg = document.createElement("img");
    iconImg.className = "link-icon";
    iconImg.src = chrome.runtime.getURL(icon);
    iconImg.alt = "";

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

    link.appendChild(iconImg);
    link.appendChild(textContainer);
    menu.appendChild(link);
  });

  // Pull version dynamically from manifest
  const versionEl = document.getElementById("popup-version");
  if (versionEl) {
    versionEl.textContent = "v" + chrome.runtime.getManifest().version;
  }
});
