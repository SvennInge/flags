const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

canvas.width = 1200;
canvas.height = 850;

let flags = [];
let selectedFlag = null;
let loadedImageCount = 0;

const NODE_RADIUS = 22;
const SELECTED_RADIUS = 28;
const LINK_MIN_DISTANCE = 62;
const GLOBAL_MIN_NODE_DISTANCE = NODE_RADIUS * 2 + 10;
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

function similarity(a, b) {
  if (!a || !b) return 0;

  const colorMatch = sharedCount(a, b, "colors");
  const layoutMatch = sharedCount(a, b, "layout");
  const symbolMatch = sharedCount(a, b, "symbols");

  return colorMatch * 2 + layoutMatch * 3 + symbolMatch * 2;
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
        const score = similarity(a, b);

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

      if (score > 0) {
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
  flags.forEach(f => {
    const isSelected = selectedFlag && f.id === selectedFlag.id;
    const isConnected =
      selectedFlag === null ||
      f.id === selectedFlag.id ||
      similarity(f, selectedFlag) > 0;

    ctx.globalAlpha = isConnected ? 1 : 0.16;

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
    f.id === selectedFlag.id || similarity(f, selectedFlag) > 0
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

  const nodes = flags.map(f => ({
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

canvas.addEventListener("click", event => {
  const rect = canvas.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;

  const clicked = flags.find(f => {
    const dx = mouseX - f.x;
    const dy = mouseY - f.y;
    return Math.sqrt(dx * dx + dy * dy) < SELECTED_RADIUS;
  });

  if (clicked) {
    selectedFlag = selectedFlag && selectedFlag.id === clicked.id ? null : clicked;
    draw();
  }
});
