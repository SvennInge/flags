const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

canvas.width = 1500;
canvas.height = 1100;

let flags = [];
let selectedFlag = null;
let loadedImageCount = 0;
let hoveredFlag = null;
let mouse = { x: 0, y: 0 };
let tagMenuScroll = 0;
let pendingDraw = false;

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
const LINK_MIN_DISTANCE = 0;
const GLOBAL_MIN_NODE_DISTANCE = NODE_RADIUS * 2 + 20;
const LABEL_PADDING = 6;

const MAIN_MENU = { x: 14, y: 14, w: 190, h: 138 };
const TAG_MENU = { x: 14, y: 162, w: 190, h: 680 };

fetch("flags.json")
  .then(res => res.json())
  .then(data => {
    flags = data;
    drawLoadingScreen("Preparing map layout...");

    // Give the browser a real chance to paint the loading message before layout work.
    setTimeout(() => {
      flags.forEach(f => {
        f.img = new Image();
        f.img.onload = () => {
          loadedImageCount++;
          requestDraw();
        };
        f.img.onerror = () => {
          loadedImageCount++;
          requestDraw();
        };
        f.img.src = f.image;
      });

      arrangeBySimilarity();
      requestDraw();
    }, 50);
  });

function requestDraw() {
  if (pendingDraw) return;

  pendingDraw = true;
  requestAnimationFrame(() => {
    pendingDraw = false;
    draw();
  });
}

function drawLoadingScreen(message) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
  ctx.font = "20px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(message, canvas.width / 2, canvas.height / 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function sharedCount(a, b, key) {
  if (!a[key] || !b[key]) return 0;
  return a[key].filter(item => b[key].includes(item)).length;
}

function getMainColors(flag) {
  return [...new Set(flag.colors?.main || [])];
}

function getSecondaryColors(flag) {
  return [...new Set(flag.colors?.secondary || [])];
}

function getAllColors(flag) {
  return [...new Set([...getMainColors(flag), ...getSecondaryColors(flag)])];
}

function colorsFullyMatch(a, b) {
  const aMain = getMainColors(a);
  const bMain = getMainColors(b);
  const aSecondary = getSecondaryColors(a);
  const bSecondary = getSecondaryColors(b);

  if (aMain.length === 0 || bMain.length === 0) return false;

  return sameColorSet(aMain, bMain) && sameColorSet(aSecondary, bSecondary);
}

function colorsSubsetMatch(a, b) {
  const aMain = getMainColors(a);
  const bMain = getMainColors(b);

  if (aMain.length === 0 || bMain.length === 0) return false;

  // With no selected flag, use the same rule as the default color relation.
  if (!selectedFlag) {
    return colorsCompatible(a, b);
  }

  const selectedColors = getMainColors(selectedFlag);
  const other = a.id === selectedFlag.id ? b : a;
  const otherColors = getMainColors(other);

  if (selectedColors.length === 0 || otherColors.length === 0) return false;

  // For selected flag mode:
  // - two-main-color selected flags require exact main-color match
  // - multi-main-color selected flags allow exact match or the other flag having exactly one extra main color
  if (selectedColors.length <= 2) {
    return sameColorSet(selectedColors, otherColors);
  }

  const exact = sameColorSet(selectedColors, otherColors);
  const oneExtra =
    otherColors.length === selectedColors.length + 1 &&
    selectedColors.every(color => otherColors.includes(color));

  return exact || oneExtra;
}

function sameColorSet(aColors, bColors) {
  if (aColors.length !== bColors.length) return false;
  return aColors.every(color => bColors.includes(color));
}

function colorsCompatible(a, b) {
  const aMain = getMainColors(a);
  const bMain = getMainColors(b);

  if (aMain.length === 0 || bMain.length === 0) return false;

  // Two-main-color flags only link exact same main-color matches.
  if (aMain.length <= 2 || bMain.length <= 2) {
    return sameColorSet(aMain, bMain);
  }

  // Multi-main-color flags link exact matches or one extra/missing main color.
  if (sameColorSet(aMain, bMain)) return true;

  const lengthDiff = Math.abs(aMain.length - bMain.length);
  if (lengthDiff !== 1) return false;

  const smaller = aMain.length < bMain.length ? aMain : bMain;
  const larger = aMain.length < bMain.length ? bMain : aMain;

  return smaller.every(color => larger.includes(color));
}

function colorSimilarityRatio(a, b) {
  const aMain = getMainColors(a);
  const bMain = getMainColors(b);

  if (aMain.length === 0 || bMain.length === 0) return 0;

  const sharedMain = aMain.filter(color => bMain.includes(color)).length;
  const mainUnion = new Set([...aMain, ...bMain]).size;
  const mainRatio = sharedMain / mainUnion;

  const aSecondary = getSecondaryColors(a);
  const bSecondary = getSecondaryColors(b);
  const sharedSecondary = aSecondary.filter(color => bSecondary.includes(color)).length;
  const secondaryUnion = new Set([...aSecondary, ...bSecondary]).size;
  const secondaryRatio = secondaryUnion > 0 ? sharedSecondary / secondaryUnion : 0;

  // Main colors dominate; secondary colors only slightly strengthen a line.
  return mainRatio * 0.85 + secondaryRatio * 0.15;
}

function meaningfulColorOverlap(a, b) {
  return colorsCompatible(a, b);
}

function relationMatches(a, b) {
  return {
    colors: colorsFullyMatch(a, b),
    commonColors: colorsSubsetMatch(a, b),
    colorOverlap: meaningfulColorOverlap(a, b),
    layout: sharedCount(a, b, "layout") > 0,
    symbols: sharedCount(a, b, "symbols") > 0,
  };
}

function activeFilterKeys() {
  return Object.keys(relationFilters).filter(key => relationFilters[key]);
}

function tagGroupMatches(a, b, key) {
  const selectedTags = tagFilters[key] || [];

  if (selectedTags.length === 0) {
    return sharedCount(a, b, key) > 0;
  }

  return selectedTags.some(tag =>
    a[key] && b[key] && a[key].includes(tag) && b[key].includes(tag)
  );
}

function passesRelationFilters(a, b) {
  if (!a || !b) return false;

  const active = activeFilterKeys();
  const matches = relationMatches(a, b);

  if (active.length === 0) {
    return matches.colorOverlap || matches.layout || matches.symbols;
  }

  let colorMatch = true;
  if (relationFilters.colors || relationFilters.commonColors) {
    colorMatch =
      (relationFilters.colors && matches.colors) ||
      (relationFilters.commonColors && matches.commonColors);
  }

  let layoutMatch = true;
  if (relationFilters.layout) {
    layoutMatch = matches.layout && tagGroupMatches(a, b, "layout");
  }

  let symbolsMatch = true;
  if (relationFilters.symbols) {
    symbolsMatch = matches.symbols && tagGroupMatches(a, b, "symbols");
  }

  return colorMatch && layoutMatch && symbolsMatch;
}

function similarity(a, b) {
  if (!a || !b) return 0;

  const matches = relationMatches(a, b);
  let score = 0;

  if (matches.colors) {
    score += 6;
  } else if (matches.commonColors) {
    score += 4;
  } else if (matches.colorOverlap) {
    score += colorSimilarityRatio(a, b) * 5;
  }
  if (matches.layout) score += sharedCount(a, b, "layout") * 3;
  if (matches.symbols) score += sharedCount(a, b, "symbols") * 2;

  return score;
}

function arrangeBySimilarity() {
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const outerRadius = Math.min(canvas.width, canvas.height) * 0.42;

  // Precompute all meaningful similarity pairs once. This avoids recalculating
  // the same pair scores hundreds of times during layout.
  const pairs = [];
  for (let i = 0; i < flags.length; i++) {
    for (let j = i + 1; j < flags.length; j++) {
      const score = similarity(flags[i], flags[j]);
      if (score > 0) {
        pairs.push({ a: flags[i], b: flags[j], score });
      }
    }
  }

  // Greedy initial ordering: each next flag is the most similar unused flag.
  // This gives the force layout a much better starting point.
  const ordered = buildSimilarityOrder(pairs);

  ordered.forEach((f, i) => {
    const angle = i * 2.399963;
    const r = outerRadius * Math.sqrt((i + 0.5) / ordered.length);
    f.x = centerX + Math.cos(angle) * r;
    f.y = centerY + Math.sin(angle) * r;
  });

  // Keep only stronger relations for the attraction force. Weak relations still
  // draw as lines, but they no longer distort the whole layout as much.
  const attractionPairs = pairs.filter(pair => pair.score >= 6);

  for (let step = 0; step < 360; step++) {
    attractionPairs.forEach(pair => {
      const a = pair.a;
      const b = pair.b;
      const score = pair.score;

      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 1;

      // High similarity should sit close, but never closer than the global node spacing.
      const desiredDistance = Math.max(GLOBAL_MIN_NODE_DISTANCE + 12, 230 - score * 14);
      const force = (dist - desiredDistance) * 0.012;

      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      a.x += fx;
      a.y += fy;
      b.x -= fx;
      b.y -= fy;
    });

    resolveGlobalCollisions();

    flags.forEach(f => {
      f.x += (centerX - f.x) * 0.00035;
      f.y += (centerY - f.y) * 0.00035;
      keepInsideCanvas(f);
    });
  }

  for (let n = 0; n < 50; n++) {
    resolveGlobalCollisions();
    flags.forEach(keepInsideCanvas);
  }
}

function buildSimilarityOrder(pairs) {
  if (flags.length === 0) return [];

  const unused = new Set(flags);
  const ordered = [];

  // Start with the flag that has the strongest total similarity to others.
  let current = flags[0];
  let bestTotal = -1;

  flags.forEach(flag => {
    const total = pairs.reduce((sum, pair) => {
      if (pair.a === flag || pair.b === flag) return sum + pair.score;
      return sum;
    }, 0);

    if (total > bestTotal) {
      bestTotal = total;
      current = flag;
    }
  });

  while (unused.size > 0) {
    ordered.push(current);
    unused.delete(current);

    let next = null;
    let bestScore = -1;

    unused.forEach(candidate => {
      const pair = pairs.find(p =>
        (p.a === current && p.b === candidate) ||
        (p.b === current && p.a === candidate)
      );
      const score = pair ? pair.score : 0;

      if (score > bestScore) {
        bestScore = score;
        next = candidate;
      }
    });

    current = next || [...unused][0];
  }

  return ordered;
}

function resolveGlobalCollisions() {
  for (let i = 0; i < flags.length; i++) {
    for (let j = i + 1; j < flags.length; j++) {
      const a = flags[i];
      const b = flags[j];

      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.sqrt(dx * dx + dy * dy);

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
    const radius = isSelected ? SELECTED_RADIUS : NODE_RADIUS;

    ctx.globalAlpha = isRelevant ? 1 : 0.16;

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

function drawMenu() {
  const { x, y, w, h } = MAIN_MENU;

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

  drawTagFilterMenu(TAG_MENU.x, TAG_MENU.y, TAG_MENU.w);
}

function drawTagFilterMenu(x, y, w) {
  const sections = getTagMenuSections();
  if (sections.length === 0) return;

  const rowHeight = 26;
  const sectionTitleHeight = 22;
  const maxTextWidth = w - 38;
  const visibleHeight = TAG_MENU.h;

  clampTagMenuScroll(sections, rowHeight, sectionTitleHeight);

  ctx.save();

  ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
  roundRect(x, y, w, visibleHeight, 10);
  ctx.fill();

  ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
  ctx.lineWidth = 1;
  roundRect(x, y, w, visibleHeight, 10);
  ctx.stroke();

  ctx.beginPath();
  ctx.rect(x, y, w, visibleHeight);
  ctx.clip();

  let cursorY = y + 16 - tagMenuScroll;

  sections.forEach(section => {
    ctx.fillStyle = "white";
    ctx.font = "bold 12px Arial";
    ctx.textBaseline = "middle";
    ctx.fillText(section.title, x + 12, cursorY);
    cursorY += sectionTitleHeight;

    section.tags.forEach(tag => {
      const selected = tagFilters[section.key].includes(tag);

      drawMenuCheckbox(selected, x + 12, cursorY - 1);

      ctx.fillStyle = "white";
      ctx.font = "11px Arial";
      ctx.textBaseline = "middle";
      ctx.fillText(shortenLabel(tag, maxTextWidth), x + 34, cursorY - 1);

      cursorY += rowHeight;
    });
  });

  ctx.restore();
  drawTagMenuScrollbar(sections, rowHeight, sectionTitleHeight);
}

function drawTagMenuScrollbar(sections, rowHeight, sectionTitleHeight) {
  const contentHeight = getTagMenuContentHeight(sections, rowHeight, sectionTitleHeight);
  if (contentHeight <= TAG_MENU.h) return;

  const trackX = TAG_MENU.x + TAG_MENU.w - 8;
  const trackY = TAG_MENU.y + 10;
  const trackW = 4;
  const trackH = TAG_MENU.h - 20;

  const thumbH = Math.max(28, trackH * (TAG_MENU.h / contentHeight));
  const maxScroll = contentHeight - TAG_MENU.h + 8;
  const thumbY = trackY + (trackH - thumbH) * (tagMenuScroll / maxScroll);

  ctx.fillStyle = "rgba(148, 163, 184, 0.20)";
  roundRect(trackX, trackY, trackW, trackH, 3);
  ctx.fill();

  ctx.fillStyle = "rgba(56, 189, 248, 0.75)";
  roundRect(trackX, thumbY, trackW, thumbH, 3);
  ctx.fill();
}

function drawCheckbox(key, label, x, y) {
  drawMenuCheckbox(relationFilters[key], x, y);

  ctx.fillStyle = "white";
  ctx.font = "12px Arial";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 22, y - 1);
}

function drawMenuCheckbox(selected, x, y) {
  ctx.strokeStyle = "rgba(226, 232, 240, 0.75)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y - 8, 14, 14);

  if (selected) {
    ctx.fillStyle = "#38bdf8";
    ctx.fillRect(x + 3, y - 5, 8, 8);
  }
}

function drawHover() {
  if (!hoveredFlag) return;

  const padding = 8;

  let imgW = 256;
  let imgH = 256;

  if (hoveredFlag.img && hoveredFlag.img.naturalWidth > 0) {
    imgW = hoveredFlag.img.naturalWidth;
    imgH = hoveredFlag.img.naturalHeight;
  }

  ctx.font = "12px Arial";
  const textWidth = ctx.measureText(hoveredFlag.name).width;

  const w = Math.max(imgW, textWidth) + padding * 2;
  const h = imgH + 24 + padding * 2;

  let x = mouse.x + 12;
  let y = mouse.y + 12;

  if (x + w > canvas.width) x = mouse.x - w - 12;
  if (y + h > canvas.height) y = mouse.y - h - 12;

  ctx.fillStyle = "rgba(15,23,42,0.95)";
  roundRect(x, y, w, h, 8);
  ctx.fill();

  ctx.strokeStyle = "rgba(148,163,184,0.4)";
  ctx.stroke();

  if (hoveredFlag.img && hoveredFlag.img.complete && hoveredFlag.img.naturalWidth > 0) {
    ctx.drawImage(hoveredFlag.img, x + padding, y + padding, imgW, imgH);
  }

  ctx.fillStyle = "white";
  ctx.textBaseline = "middle";
  ctx.fillText(hoveredFlag.name, x + padding, y + padding + imgH + 12);
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
  const selected = visibleFlags.find(f => f.id === selectedFlag.id);

  if (selected) {
    const label = placeLabel(selected, placedLabels, true);
    if (label) {
      drawLabelBox(label, true);
      placedLabels.push(label);
    }
  }

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

function getTagMenuSections() {
  const sections = [];

  if (relationFilters.layout) {
    sections.push({ key: "layout", title: "Layout labels", tags: getAvailableTags("layout") });
  }

  if (relationFilters.symbols) {
    sections.push({ key: "symbols", title: "Symbol labels", tags: getAvailableTags("symbols") });
  }

  return sections;
}

function getTagMenuContentHeight(sections, rowHeight, sectionTitleHeight) {
  let height = 16;
  sections.forEach(section => {
    height += sectionTitleHeight + section.tags.length * rowHeight;
  });
  return height;
}

function clampTagMenuScroll(sections, rowHeight, sectionTitleHeight) {
  const contentHeight = getTagMenuContentHeight(sections, rowHeight, sectionTitleHeight);
  const maxScroll = Math.max(0, contentHeight - TAG_MENU.h + 8);
  tagMenuScroll = Math.max(0, Math.min(tagMenuScroll, maxScroll));
}

function handleMenuClick(x, y) {
  if (handleTagFilterClick(x, y)) return true;

  const items = [
    { key: "colors", x: 26, y: 48, w: 160, h: 24 },
    { key: "commonColors", x: 26, y: 74, w: 160, h: 24 },
    { key: "layout", x: 26, y: 100, w: 160, h: 24 },
    { key: "symbols", x: 26, y: 126, w: 160, h: 24 },
  ];

  const hit = items.find(item =>
    x >= item.x && x <= item.x + item.w &&
    y >= item.y - 13 && y <= item.y - 13 + item.h
  );

  if (!hit) return false;

  relationFilters[hit.key] = !relationFilters[hit.key];

  if (hit.key === "colors" && relationFilters.colors) {
    relationFilters.commonColors = false;
  }
  if (hit.key === "commonColors" && relationFilters.commonColors) {
    relationFilters.colors = false;
  }

  if (hit.key === "layout" && !relationFilters.layout) {
    tagFilters.layout = [];
  }
  if (hit.key === "symbols" && !relationFilters.symbols) {
    tagFilters.symbols = [];
  }

  tagMenuScroll = 0;
  requestDraw();
  return true;
}

function handleTagFilterClick(x, y) {
  const sections = getTagMenuSections();
  if (sections.length === 0) return false;
  if (x < TAG_MENU.x || x > TAG_MENU.x + TAG_MENU.w || y < TAG_MENU.y || y > TAG_MENU.y + TAG_MENU.h) return false;

  const rowHeight = 26;
  const sectionTitleHeight = 22;
  clampTagMenuScroll(sections, rowHeight, sectionTitleHeight);

  let cursorY = TAG_MENU.y + 16 - tagMenuScroll;

  for (const section of sections) {
    cursorY += sectionTitleHeight;

    for (const tag of section.tags) {
      const rowTop = cursorY - 13;
      const rowBottom = rowTop + rowHeight;

      if (y >= rowTop && y <= rowBottom) {
        toggleTagFilter(section.key, tag);
        requestDraw();
        return true;
      }

      cursorY += rowHeight;
    }
  }

  return true;
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
  requestDraw();
});

canvas.addEventListener("wheel", event => {
  const rect = canvas.getBoundingClientRect();
  const mx = event.clientX - rect.left;
  const my = event.clientY - rect.top;

  if (mx >= TAG_MENU.x && mx <= TAG_MENU.x + TAG_MENU.w && my >= TAG_MENU.y && my <= TAG_MENU.y + TAG_MENU.h) {
    const sections = getTagMenuSections();
    if (sections.length > 0) {
      tagMenuScroll += event.deltaY * 0.5;
      clampTagMenuScroll(sections, 26, 22);
      requestDraw();
      event.preventDefault();
    }
  }
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
    tagMenuScroll = 0;
    requestDraw();
  }
});
