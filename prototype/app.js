const MODEL = "gemini-2.5-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const STORAGE_KEY = "picture-to-palette.apiKey";
const MODE_KEY = "picture-to-palette.mode";
const BRAND_KEY = "picture-to-palette.brand";

const apiKeyInput = document.getElementById("api-key-input");
const rememberKey = document.getElementById("remember-key");
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("image-input");
const preview = document.getElementById("preview");
const modeInput = document.getElementById("mode-input");
const countInput = document.getElementById("count-input");
const brandInput = document.getElementById("brand-input");
const extractBtn = document.getElementById("extract-btn");
const statusEl = document.getElementById("status");
const paletteEl = document.getElementById("palette");

let currentImage = null;

restorePreferences();

apiKeyInput.addEventListener("change", persistApiKey);
rememberKey.addEventListener("change", persistApiKey);
modeInput.addEventListener("change", () =>
  localStorage.setItem(MODE_KEY, modeInput.value)
);
brandInput.addEventListener("change", () =>
  localStorage.setItem(BRAND_KEY, brandInput.value)
);

dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});

["dragenter", "dragover"].forEach((type) =>
  dropZone.addEventListener(type, (e) => {
    e.preventDefault();
    dropZone.classList.add("is-dragover");
  })
);
["dragleave", "drop"].forEach((type) =>
  dropZone.addEventListener(type, (e) => {
    e.preventDefault();
    dropZone.classList.remove("is-dragover");
  })
);

dropZone.addEventListener("drop", (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file) loadFile(file);
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) loadFile(file);
});

extractBtn.addEventListener("click", extractPalette);

function restorePreferences() {
  const savedKey = localStorage.getItem(STORAGE_KEY);
  if (savedKey) {
    apiKeyInput.value = savedKey;
    rememberKey.checked = true;
  }
  const savedMode = localStorage.getItem(MODE_KEY);
  if (savedMode) modeInput.value = savedMode;
  const savedBrand = localStorage.getItem(BRAND_KEY);
  if (savedBrand) brandInput.value = savedBrand;
}

function persistApiKey() {
  if (rememberKey.checked) {
    localStorage.setItem(STORAGE_KEY, apiKeyInput.value.trim());
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function loadFile(file) {
  if (!file.type.startsWith("image/")) {
    setStatus("Please choose an image file.", true);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    preview.src = dataUrl;
    preview.hidden = false;
    const [, mimeType, , base64] =
      /^data:([^;]+);(base64),(.*)$/.exec(dataUrl) || [];
    currentImage = { mimeType, base64 };
    extractBtn.disabled = false;
    setStatus("");
    paletteEl.innerHTML = "";
  };
  reader.readAsDataURL(file);
}

async function extractPalette() {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    setStatus("Enter your Gemini API key first.", true);
    return;
  }
  if (!currentImage) {
    setStatus("Choose an image first.", true);
    return;
  }

  const count = clamp(parseInt(countInput.value, 10) || 6, 2, 16);
  const mode = modeInput.value;
  const brand = brandInput.value;

  extractBtn.disabled = true;
  setStatus("Asking Gemini for a palette…");
  paletteEl.innerHTML = "";

  try {
    const colors = await requestPalette(apiKey, currentImage, { count, mode, brand });
    renderPalette(colors, brand);
    setStatus(
      `Extracted ${colors.length} color${colors.length === 1 ? "" : "s"}. ` +
        `Click any swatch to copy its hex; click the thread code to copy it.`
    );
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Something went wrong.", true);
  } finally {
    extractBtn.disabled = false;
  }
}

function buildPrompt({ count, mode, brand }) {
  const brandLabel =
    brand === "DMC"
      ? "DMC 6-strand embroidery floss"
      : brand === "Anchor"
      ? "Anchor 6-strand embroidery floss"
      : "commonly available yarn (any brand)";

  const scenario = {
    "wool-stash":
      "The photo shows a crafter's stash of wool/yarn balls. Identify each visually distinct ball as its own palette entry (merge only near-identical balls).",
    "traced-design":
      "The photo shows a traced design or line drawing with filled or shaded regions intended for stitching. Pick the colors the finished piece should use.",
    "reference-image":
      "The photo is a visual reference. Produce a constrained palette that a crafter could reproduce in physical thread or yarn.",
  }[mode];

  return (
    `${scenario} Return ${count} colors (or fewer if the image honestly has fewer distinct colors). ` +
    `For each color provide: a short evocative name (2-4 words); the sRGB hex code; ` +
    `a suggested ${brandLabel} color — use the real product code and product name if you are confident, ` +
    `otherwise set code to null and explain in notes; a rough "skeins_or_balls" quantity estimate ` +
    `(integer, 1 if unsure); optional short notes on where the color appears in the image. ` +
    `Return ONLY JSON matching the schema, no prose.`
  );
}

async function requestPalette(apiKey, image, options) {
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: buildPrompt(options) },
          {
            inline_data: {
              mime_type: image.mimeType,
              data: image.base64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          colors: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                hex: { type: "string" },
                thread_code: { type: "string", nullable: true },
                thread_name: { type: "string", nullable: true },
                skeins_or_balls: { type: "integer" },
                notes: { type: "string", nullable: true },
              },
              required: ["name", "hex", "skeins_or_balls"],
            },
          },
        },
        required: ["colors"],
      },
    },
  };

  const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    let message = `Gemini API error (${res.status})`;
    try {
      const parsed = JSON.parse(errText);
      if (parsed?.error?.message) message += `: ${parsed.error.message}`;
    } catch {
      if (errText) message += `: ${errText.slice(0, 200)}`;
    }
    throw new Error(message);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text)
    .filter(Boolean)
    .join("");

  if (!text) throw new Error("Empty response from Gemini.");

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Could not parse Gemini response as JSON.");
  }

  const colors = Array.isArray(parsed?.colors) ? parsed.colors : [];
  return colors
    .map((c) => ({
      name: String(c.name || "").trim(),
      hex: normalizeHex(c.hex),
      threadCode: c.thread_code ? String(c.thread_code).trim() : null,
      threadName: c.thread_name ? String(c.thread_name).trim() : null,
      quantity: Math.max(1, parseInt(c.skeins_or_balls, 10) || 1),
      notes: c.notes ? String(c.notes).trim() : null,
    }))
    .filter((c) => c.hex);
}

function normalizeHex(value) {
  if (!value) return null;
  const m = /#?([0-9a-f]{3}|[0-9a-f]{6})/i.exec(value);
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return `#${hex.toUpperCase()}`;
}

function renderPalette(colors, brand) {
  paletteEl.innerHTML = "";
  const unit = brand === "generic-yarn" ? "ball" : "skein";

  for (const color of colors) {
    const swatch = document.createElement("article");
    swatch.className = "swatch";

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "swatch__chip";
    chip.style.background = color.hex;
    chip.title = `Copy ${color.hex}`;
    chip.addEventListener("click", () => copyToButton(chip, color.hex));

    const body = document.createElement("div");
    body.className = "swatch__body";

    const name = document.createElement("p");
    name.className = "swatch__name";
    name.textContent = color.name || "Untitled";

    const hex = document.createElement("p");
    hex.className = "swatch__hex";
    hex.textContent = color.hex;

    body.append(name, hex);

    if (color.threadCode || color.threadName) {
      const thread = document.createElement("button");
      thread.type = "button";
      thread.className = "swatch__thread";
      const label = [color.threadCode, color.threadName].filter(Boolean).join(" — ");
      thread.textContent = label;
      thread.title = color.threadCode
        ? `Copy thread code ${color.threadCode}`
        : "Copy thread name";
      thread.addEventListener("click", () =>
        copyToButton(thread, color.threadCode || color.threadName)
      );
      body.append(thread);
    }

    const qty = document.createElement("p");
    qty.className = "swatch__qty";
    const countLabel = color.quantity === 1 ? unit : `${unit}s`;
    qty.textContent = `${color.quantity} ${countLabel}`;
    body.append(qty);

    if (color.notes) {
      const notes = document.createElement("p");
      notes.className = "swatch__notes";
      notes.textContent = color.notes;
      body.append(notes);
    }

    swatch.append(chip, body);
    paletteEl.append(swatch);
  }
}

async function copyToButton(btn, text) {
  if (!text) return;
  const prev = btn.dataset.prev || btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.dataset.prev = prev;
    btn.textContent = "Copied!";
  } catch {
    btn.dataset.prev = prev;
    btn.textContent = "Copy failed";
  }
  setTimeout(() => {
    btn.textContent = btn.dataset.prev || prev;
    delete btn.dataset.prev;
  }, 1200);
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", !!isError);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
