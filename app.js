const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

canvas.width = 1500;
canvas.height = 1100;

let flags = [];
let selectedFlag = null;
let loadedImageCount = 0;
let hoveredFlag = null;
let mouse = { x: 0, y: 0 };

const relationFilters = {
  colors: false,
  commonColors: false,
  layout: false,
  symbols: false,
};

const tagFilters = {
  layout: [],
  symbols: [],
};

const NODE_RADIUS = 25;
const SELECTED_RADIUS = 28;
const LINK_MIN_DISTANCE = 20;
const GLOBAL_MIN_NODE_DISTANCE = NODE_RADIUS * 2 + 20;
const LABEL_PADDING = 6;

fetch("flags.json")
  .then(res => res.json())
  .then(data => {
    flags = data;

    flags.forEach(f => {
      f.img = new Image();
      f.img.onload = () => {
        loadedImageCount++;
        draw();
      };
      f.img.onerror = () => {
        loadedImageCount++;
        draw();
      };
      f.img.src = f.image;
    });

    arrangeBySimilarity();
    draw();
  });

function sharedCount(a, b, key) {
  if (!a[key] || !b[key]) return 0;
  return a[key].filter(item => b[key].includes(item)).length;
}

function colorsFullyMatch(a, b) {
  if (!a.colors || !b.colors) return false;

  const aColors = [...new Set(a.colors)];
  const bColors = [...new Set(b.colors)];

  if (aColors.length === 0 || bColors.length === 0) return false;
  if (aColors.length !== bColors.length) return false;

  return aColors.every(color => bColors.includes(color));
}

function colorsSubsetMatch(a, b) {
  if (!a.colors || !b.colors) return false;

  // No highlighted flag: fall back to exact same colors.
  if (!selectedFlag) {
    return colorsFullyMatch(a, b);
  }

  const selectedColors = [...new Set(selectedFlag.colors || [])];
  const other = a.id === selectedFlag.id ? b : a;
  const otherColors = [...new Set(other.colors || [])];

  if (selectedColors.length === 0 || otherColors.length === 0) return false;

  // Match if exact same OR missing exactly one color.
  if (otherColors.length === selectedColors.length) {
    return otherColors.every(c => selectedColors.includes(c));
  }

  if (otherColors.length === selectedColors.length - 1) {
    return otherColors.every(c => selectedColors.includes(c));
  }

  return false;
}

function relationMatches(a, b) {
  return {
    colors: colorsFullyMatch(a, b),
    commonColors: colorsSubsetMatch(a, b),
    layout: sharedCount(a, b, "layout") > 0,
    symbols: sharedCount(a, b, "symbols") > 0,
  };
}

function activeFilterKeys() {
  return Object.keys(relationFilters).filter(key => relationFilters[key]);
}

function passesRelationFilters(a, b) {
  if (!a || !b) return false;

  const active = activeFilterKeys();
  const matches = relationMatches(a, b);

  // Default mode: show any relation.
  if (active.length === 0) {
    return matches.colors || matches.layout || matches.symbols;
  }

  // Color filters are mutually exclusive in the UI, but this still handles both safely.
  const colorFiltersActive = relationFilters.colors || relationFilters.commonColors;

  let colorMatch = true;
  if (colorFiltersActive) {
    colorMatch = (
      (relationFilters.colors && matches.colors) ||
      (relationFilters.commonColors && matches.commonColors)
    );
  }

  let layoutMatch = true;
  if (relationFilters.layout) {
    layoutMatch = matches.layout && tagGroupMatches(a, b, "layout");
  }

  let symbolsMatch = true;
  if (relationFilters.symbols) {
    symbolsMatch = matches.symbols && tagGroupMatches(a, b, "symbols");
  }

  // Color group AND layout group AND symbol group.
  // Inside each tag group, selected labels are OR.
  return colorMatch && layoutMatch && symbolsMatch;
}

function tagGroupMatches(a, b, key) {
  const selectedTags = tagFilters[key] || [];

  // If no specific labels are selected, any shared tag in that group is enough.
  if (selectedTags.length === 0) {
    return sharedCount(a, b, key) > 0;
  }

  // OR within the same group: any selected label may match.
  return selectedTags.some(tag =>
    a[key] && b[key] && a[key].includes(tag) && b[key].includes(tag)
  );
}

function similarity(a, b) {
  if (!a || !b) return 0;

  const matches = relationMatches(a, b);
  let score = 0;

  if (matches.colors) score += 6;
  else if (matches.commonColors) score += 4;
  if (matches.layout) score += sharedCount(a, b, "layout") * 3;
  if (matches.symbols) score += sharedCount(a, b, "symbols") * 2;

  return score;
}

function arrangeBySimilarity() {
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const outerRadius = Math.min(canvas.width, canvas.height) * 0.42;

  // Start in a deterministic spiral instead of random positions.
  flags.forEach((f, i) => {
    const angle = i * 2.399963; // golden angle
    const r = outerRadius * Math.sqrt((i + 0.5) / flags.length);
    f.x = centerX + Math.cos(angle) * r;
    f.y = centerY + Math.sin(angle) * r;
  });

  for (let step = 0; step < 700; step++) {
    for (let i = 0; i < flags.length; i++) {
      for (let j = i + 1; j < flags.length; j++) {
        const a = flags[i];
        const b = flags[j];
        const score = passesRelationFilters(a, b) ? similarity(a, b) : 0;

        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;

        const desiredDistance = score > 0 ? 390 - score * 28 : 430;

        const force = (dist - desiredDistance) * 0.003;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        a.x += fx;
        a.y += fy;
        b.x -= fx;
        b.y -= fy;

        // Softer spacing for linked/similar flags.
        if (score > 0 && dist < LINK_MIN_DISTANCE) {
          const push = (LINK_MIN_DISTANCE - dist) * 0.08;
          const px = (dx / dist) * push;
          const py = (dy / dist) * push;

          a.x -= px;
          a.y -= py;
          b.x += px;
          b.y += py;
        }
      }
    }

    // Hard global collision pass: applies to every flag pair, linked or not.
    resolveGlobalCollisions();

    // Light pull toward center, otherwise the layout drifts outward.
    flags.forEach(f => {
      f.x += (centerX - f.x) * 0.0005;
      f.y += (centerY - f.y) * 0.0005;
      keepInsideCanvas(f);
    });
  }

  // Final cleanup pass after layout settles.
  for (let n = 0; n < 80; n++) {
    resolveGlobalCollisions();
    flags.forEach(keepInsideCanvas);
  }
}

function resolveGlobalCollisions() {
  for (let i = 0; i < flags.length; i++) {
    for (let j = i + 1; j < flags.length; j++) {
      const a = flags[i];
      const b = flags[j];

      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.sqrt(dx * dx + dy * dy);

      // If two nodes are exactly on top of each other, invent a direction.
      if (!dist) {
        dx = 1;
        dy = 0;
        dist = 1;
      }

      if (dist < GLOBAL_MIN_NODE_DISTANCE) {
        const push = (GLOBAL_MIN_NODE_DISTANCE - dist) * 0.5;
        const px = (dx / dist) * push;
        const py = (dy / dist) * push;

        a.x -= px;
        a.y -= py;
        b.x += px;
        b.y += py;
      }
    }
  }
}

function keepInsideCanvas(f) {
  const margin = 38;
  f.x = Math.max(margin, Math.min(canvas.width - margin, f.x));
  f.y = Math.max(margin, Math.min(canvas.height - margin, f.y));
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawStatusText();
  drawLines();
  drawNodes();
  drawLabels();
  drawMenu();
  drawHover();
}

function drawHover() {
  if (!hoveredFlag) return;

  const padding = 8;
  const imgW = 120;
  const imgH = 70;

  ctx.font = "12px Arial";
  const textWidth = ctx.measureText(hoveredFlag.name).width;

  const w = Math.max(imgW, textWidth) + padding * 2;
  const h = imgH + 24 + padding * 2;

  let x = mouse.x + 12;
  let y = mouse.y + 12;

  if (x + w > canvas.width) x = mouse.x - w - 12;
  if (y + h > canvas.height) y = mouse.y - h - 12;

  // background
  ctx.fillStyle = "rgba(15,23,42,0.95)";
  roundRect(x, y, w, h, 8);
  ctx.fill();

  ctx.strokeStyle = "rgba(148,163,184,0.4)";
  ctx.stroke();

  // image: use contain, not cover, so the full flag is visible
  if (hoveredFlag.img && hoveredFlag.img.complete && hoveredFlag.img.naturalWidth > 0) {
    drawImageContain(
      hoveredFlag.img,
      x + padding,
      y + padding,
      w - padding * 2,
      imgH
    );
  }

  // text
  ctx.fillStyle = "white";
  ctx.textBaseline = "middle";
  ctx.fillText(
    hoveredFlag.name,
    x + padding,
    y + padding + imgH + 12
  );
}

function drawMenu() {
  const x = 14;
  const y = 14;
  const w = 190;
  const h = 138;

  ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
  roundRect(x, y, w, h, 10);
  ctx.fill();

  ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
  ctx.lineWidth = 1;
  roundRect(x, y, w, h, 10);
  ctx.stroke();

  ctx.fillStyle = "white";
  ctx.font = "bold 13px Arial";
  ctx.textBaseline = "middle";
  ctx.fillText("Relations", x + 12, y + 18);

  drawCheckbox("colors", "Exact same colors", x + 12, y + 42);
  drawCheckbox("commonColors", "Almost same colors", x + 12, y + 68);
  drawCheckbox("layout", "Common layout", x + 12, y + 94);
  drawCheckbox("symbols", "Common symbols", x + 12, y + 120);

  drawTagFilterMenu(x, y + h + 10, w);
}

function drawTagFilterMenu(x, y, w) {
  const sections = [];

  if (relationFilters.layout) {
    sections.push({ key: "layout", title: "Layout labels", tags: getAvailableTags("layout") });
  }

  if (relationFilters.symbols) {
    sections.push({ key: "symbols", title: "Symbol labels", tags: getAvailableTags("symbols") });
  }

  if (sections.length === 0) return;

  const rowHeight = 22;
  const sectionTitleHeight = 22;
  const maxTextWidth = w - 38;
  let height = 14;

  sections.forEach(section => {
    height += sectionTitleHeight + section.tags.length * rowHeight;
  });

  ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
  roundRect(x, y, w, height, 10);
  ctx.fill();

  ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
  ctx.lineWidth = 1;
  roundRect(x, y, w, height, 10);
  ctx.stroke();

  let cursorY = y + 16;

  sections.forEach(section => {
    ctx.fillStyle = "white";
    ctx.font = "bold 12px Arial";
    ctx.textBaseline = "middle";
    ctx.fillText(section.title, x + 12, cursorY);
    cursorY += sectionTitleHeight;

    section.tags.forEach(tag => {
      const selected = tagFilters[section.key].includes(tag);

      ctx.strokeStyle = "rgba(226, 232, 240, 0.75)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 12, cursorY - 8, 14, 14);

      if (selected) {
        ctx.fillStyle = "#38bdf8";
        ctx.fillRect(x + 15, cursorY - 5, 8, 8);
      }

      ctx.fillStyle = "white";
      ctx.font = "11px Arial";
      ctx.fillText(shortenLabel(tag, maxTextWidth), x + 34, cursorY - 1);
      cursorY += rowHeight;
    });
  });
}

function drawCheckbox(key, label, x, y) {
  ctx.strokeStyle = "rgba(226, 232, 240, 0.75)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y - 8, 14, 14);

  if (relationFilters[key]) {
    ctx.fillStyle = "#38bdf8";
    ctx.fillRect(x + 3, y - 5, 8, 8);
  }

  ctx.fillStyle = "white";
  ctx.font = "12px Arial";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 22, y - 1);
}

function handleMenuClick(x, y) {
  if (handleTagFilterClick(x, y)) return true;

  const items = [
    { key: "colors", x: 26, y: 48, w: 160, h: 22 },
    { key: "commonColors", x: 26, y: 74, w: 160, h: 22 },
    { key: "layout", x: 26, y: 100, w: 160, h: 22 },
    { key: "symbols", x: 26, y: 126, w: 160, h: 22 },
  ];

  const hit = items.find(item =>
    x >= item.x && x <= item.x + item.w &&
    y >= item.y - 12 && y <= item.y - 12 + item.h
  );

  if (!hit) return false;

  relationFilters[hit.key] = !relationFilters[hit.key];

  // Make color filters mutually exclusive
  if (hit.key === "colors" && relationFilters.colors) {
    relationFilters.commonColors = false;
  }
  if (hit.key === "commonColors" && relationFilters.commonColors) {
    relationFilters.colors = false;
  }

  // Clear tag selections when the parent relation is disabled.
  if (hit.key === "layout" && !relationFilters.layout) {
    tagFilters.layout = [];
  }
  if (hit.key === "symbols" && !relationFilters.symbols) {
    tagFilters.symbols = [];
  }

  draw();
  return true;
}

function handleTagFilterClick(x, y) {
  const menuX = 14;
  const menuY = 14 + 138 + 10;
  const menuW = 190;
  const rowHeight = 22;
  const sectionTitleHeight = 22;

  const sections = [];
  if (relationFilters.layout) sections.push({ key: "layout", tags: getAvailableTags("layout") });
  if (relationFilters.symbols) sections.push({ key: "symbols", tags: getAvailableTags("symbols") });

  if (sections.length === 0) return false;
  if (x < menuX || x > menuX + menuW) return false;

  let cursorY = menuY + 16;

  for (const section of sections) {
    cursorY += sectionTitleHeight;

    for (const tag of section.tags) {
      const rowTop = cursorY - 12;
      const rowBottom = rowTop + rowHeight;

      if (y >= rowTop && y <= rowBottom) {
        toggleTagFilter(section.key, tag);
        draw();
        return true;
      }

      cursorY += rowHeight;
    }
  }

  return false;
}

function toggleTagFilter(key, tag) {
  const list = tagFilters[key];
  const index = list.indexOf(tag);

  if (index >= 0) {
    list.splice(index, 1);
  } else {
    list.push(tag);
  }
}

function getAvailableTags(key) {
  const tags = new Set();

  const sourceFlags = selectedFlag ? [selectedFlag] : flags;

  sourceFlags.forEach(flag => {
    (flag[key] || []).forEach(tag => tags.add(tag));
  });

  return [...tags].sort();
}

function cleanTagFiltersForSelectedFlag() {
  if (!selectedFlag) return;

  ["layout", "symbols"].forEach(key => {
    const allowed = new Set(selectedFlag[key] || []);
    tagFilters[key] = tagFilters[key].filter(tag => allowed.has(tag));
  });
}

function shortenLabel(text, maxWidth) {
  ctx.font = "11px Arial";
  if (ctx.measureText(text).width <= maxWidth) return text;

  let shortened = text;
  while (shortened.length > 3 && ctx.measureText(shortened + "...").width > maxWidth) {
    shortened = shortened.slice(0, -1);
  }

  return shortened + "...";
}

function drawStatusText() {
  if (flags.length === 0) return;
  if (loadedImageCount >= flags.length) return;

  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  ctx.font = "13px Arial";
  ctx.fillText(`Loading flag images ${loadedImageCount}/${flags.length}`, 16, 24);
}

function drawLines() {
  for (let i = 0; i < flags.length; i++) {
    for (let j = i + 1; j < flags.length; j++) {
      const a = flags[i];
      const b = flags[j];
      const score = similarity(a, b);
      const visibleByFilters = passesRelationFilters(a, b);

      if (score > 0 && visibleByFilters) {
        const connectedToSelected =
          selectedFlag === null ||
          a.id === selectedFlag.id ||
          b.id === selectedFlag.id;

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);

        ctx.strokeStyle = connectedToSelected
          ? `rgba(0, 200, 255, ${Math.min(score / 10, 0.9)})`
          : "rgba(80, 80, 80, 0.08)";

        ctx.lineWidth = connectedToSelected ? Math.max(1, score / 2) : 1;
        ctx.stroke();
      }
    }
  }
}

function drawNodes() {
  const relevantIds = getRelevantFlagIds();
  const shouldDim = shouldDimUnassociatedFlags();

  flags.forEach(f => {
    const isSelected = selectedFlag && f.id === selectedFlag.id;
    const isRelevant = !shouldDim || relevantIds.has(f.id);

    ctx.globalAlpha = isRelevant ? 1 : 0.16;

    const radius = isSelected ? SELECTED_RADIUS : NODE_RADIUS;

    ctx.save();
    ctx.beginPath();
    ctx.arc(f.x, f.y, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    if (f.img && f.img.complete && f.img.naturalWidth > 0) {
      drawImageCover(f.img, f.x - radius, f.y - radius, radius * 2, radius * 2);
    } else {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(f.x - radius, f.y - radius, radius * 2, radius * 2);
    }

    ctx.restore();

    ctx.beginPath();
    ctx.arc(f.x, f.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = isSelected ? "#38bdf8" : "#94a3b8";
    ctx.lineWidth = isSelected ? 3 : 1;
    ctx.stroke();

    ctx.globalAlpha = 1;
  });
}

function shouldDimUnassociatedFlags() {
  return selectedFlag !== null || activeFilterKeys().length > 0 || tagFilters.layout.length > 0 || tagFilters.symbols.length > 0;
}

function getRelevantFlagIds() {
  const relevant = new Set();

  if (selectedFlag) {
    relevant.add(selectedFlag.id);
    flags.forEach(f => {
      if (f.id !== selectedFlag.id && passesRelationFilters(f, selectedFlag)) {
        relevant.add(f.id);
      }
    });
    return relevant;
  }

  // If specific layout/symbol tags are selected, keep flags with those tags bright
  // even if they have no matching partner.
  flags.forEach(f => {
    const hasSelectedLayout =
      relationFilters.layout &&
      tagFilters.layout.length > 0 &&
      tagFilters.layout.some(tag => (f.layout || []).includes(tag));

    const hasSelectedSymbol =
      relationFilters.symbols &&
      tagFilters.symbols.length > 0 &&
      tagFilters.symbols.some(tag => (f.symbols || []).includes(tag));

    if (hasSelectedLayout || hasSelectedSymbol) {
      relevant.add(f.id);
    }
  });

  for (let i = 0; i < flags.length; i++) {
    for (let j = i + 1; j < flags.length; j++) {
      const a = flags[i];
      const b = flags[j];
      const score = similarity(a, b);

      if (score > 0 && passesRelationFilters(a, b)) {
        relevant.add(a.id);
        relevant.add(b.id);
      }
    }
  }

  return relevant;
}

function drawImageContain(img, x, y, w, h) {
  const imgRatio = img.naturalWidth / img.naturalHeight;
  const boxRatio = w / h;

  let drawW = w;
  let drawH = h;

  if (imgRatio > boxRatio) {
    drawH = w / imgRatio;
  } else {
    drawW = h * imgRatio;
  }

  const drawX = x + (w - drawW) / 2;
  const drawY = y + (h - drawH) / 2;

  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(x, y, w, h);

  ctx.drawImage(img, drawX, drawY, drawW, drawH);
}

function drawImageCover(img, x, y, w, h) {
  const imgRatio = img.naturalWidth / img.naturalHeight;
  const boxRatio = w / h;

  let sx = 0;
  let sy = 0;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;

  if (imgRatio > boxRatio) {
    sw = img.naturalHeight * boxRatio;
    sx = (img.naturalWidth - sw) / 2;
  } else {
    sh = img.naturalWidth / boxRatio;
    sy = (img.naturalHeight - sh) / 2;
  }

  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function drawLabels() {
  if (!selectedFlag) return;

  const visibleFlags = flags.filter(f =>
    f.id === selectedFlag.id || passesRelationFilters(f, selectedFlag)
  );

  const placedLabels = [];

  // Draw selected label first.
  const selected = visibleFlags.find(f => f.id === selectedFlag.id);
  if (selected) {
    const label = placeLabel(selected, placedLabels, true);
    if (label) {
      drawLabelBox(label, true);
      placedLabels.push(label);
    }
  }

  // Then draw connected labels, strongest similarity first.
  visibleFlags
    .filter(f => f.id !== selectedFlag.id)
    .sort((a, b) => similarity(b, selectedFlag) - similarity(a, selectedFlag))
    .forEach(f => {
      const label = placeLabel(f, placedLabels, false);
      if (label) {
        drawLabelBox(label, false);
        placedLabels.push(label);
      }
    });
}

function placeLabel(flag, placedLabels, isSelected) {
  const radius = isSelected ? SELECTED_RADIUS : NODE_RADIUS;
  const font = isSelected ? "bold 15px Arial" : "12px Arial";
  ctx.font = font;

  const textWidth = ctx.measureText(flag.name).width;
  const boxWidth = textWidth + LABEL_PADDING * 2;
  const boxHeight = isSelected ? 24 : 20;

  const candidates = [
    { x: flag.x + radius + 8, y: flag.y - boxHeight / 2 },
    { x: flag.x - radius - 8 - boxWidth, y: flag.y - boxHeight / 2 },
    { x: flag.x - boxWidth / 2, y: flag.y - radius - 8 - boxHeight },
    { x: flag.x - boxWidth / 2, y: flag.y + radius + 8 },
    { x: flag.x + radius + 8, y: flag.y + radius + 2 },
    { x: flag.x - radius - 8 - boxWidth, y: flag.y + radius + 2 },
    { x: flag.x + radius + 8, y: flag.y - radius - 2 - boxHeight },
    { x: flag.x - radius - 8 - boxWidth, y: flag.y - radius - 2 - boxHeight },
  ];

  const nodes = flags
    .filter(f =>
      !selectedFlag ||
      f.id === selectedFlag.id ||
      passesRelationFilters(f, selectedFlag)
    )
    .map(f => ({
      x: f.x - NODE_RADIUS - 3,
      y: f.y - NODE_RADIUS - 3,
      w: (NODE_RADIUS + 3) * 2,
      h: (NODE_RADIUS + 3) * 2,
    }));

  for (const c of candidates) {
    const label = {
      text: flag.name,
      x: Math.max(2, Math.min(canvas.width - boxWidth - 2, c.x)),
      y: Math.max(2, Math.min(canvas.height - boxHeight - 2, c.y)),
      w: boxWidth,
      h: boxHeight,
      font,
    };

    const overlapsLabel = placedLabels.some(existing => rectanglesOverlap(label, existing));
    const overlapsNode = nodes.some(node => rectanglesOverlap(label, node));

    if (!overlapsLabel && !overlapsNode) {
      return label;
    }
  }

  // If there is no clean placement, skip weaker labels instead of cluttering the map.
  return null;
}

function rectanglesOverlap(a, b) {
  return !(
    a.x + a.w < b.x ||
    b.x + b.w < a.x ||
    a.y + a.h < b.y ||
    b.y + b.h < a.y
  );
}

function drawLabelBox(label, isSelected) {
  ctx.font = label.font;
  ctx.textBaseline = "middle";

  ctx.fillStyle = isSelected ? "rgba(14, 165, 233, 0.88)" : "rgba(15, 23, 42, 0.88)";
  roundRect(label.x, label.y, label.w, label.h, 6);
  ctx.fill();

  ctx.strokeStyle = isSelected ? "rgba(224, 242, 254, 0.8)" : "rgba(148, 163, 184, 0.35)";
  ctx.lineWidth = 1;
  roundRect(label.x, label.y, label.w, label.h, 6);
  ctx.stroke();

  ctx.fillStyle = "white";
  ctx.fillText(label.text, label.x + LABEL_PADDING, label.y + label.h / 2 + 0.5);
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

canvas.addEventListener("mousemove", event => {
  const rect = canvas.getBoundingClientRect();
  mouse.x = event.clientX - rect.left;
  mouse.y = event.clientY - rect.top;

  const found = flags.find(f => {
    const dx = mouse.x - f.x;
    const dy = mouse.y - f.y;
    return Math.sqrt(dx * dx + dy * dy) < NODE_RADIUS;
  });

  hoveredFlag = found || null;
  draw();
});

canvas.addEventListener("click", event => {
  const rect = canvas.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;

  if (handleMenuClick(mouseX, mouseY)) return;

  const clicked = flags.find(f => {
    const dx = mouseX - f.x;
    const dy = mouseY - f.y;
    return Math.sqrt(dx * dx + dy * dy) < SELECTED_RADIUS;
  });

  if (clicked) {
    selectedFlag = selectedFlag && selectedFlag.id === clicked.id ? null : clicked;
    cleanTagFiltersForSelectedFlag();
    draw();
  }
});
