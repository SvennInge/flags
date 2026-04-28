const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

canvas.width = 800;
canvas.height = 600;

let flags = [];

// Load flags.json
fetch("flags.json")
  .then(res => res.json())
  .then(data => {
    flags = data;

    // Give each flag a random position
    flags.forEach(f => {
      f.x = Math.random() * canvas.width;
      f.y = Math.random() * canvas.height;
    });

    draw();
  });

// Simple similarity (shared colors only for now)
function similarity(a, b) {
  const shared = a.colors.filter(c => b.colors.includes(c));
  return shared.length;
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw lines
  for (let i = 0; i < flags.length; i++) {
    for (let j = i + 1; j < flags.length; j++) {
      const score = similarity(flags[i], flags[j]);

      if (score > 0) {
        ctx.beginPath();
        ctx.moveTo(flags[i].x, flags[i].y);
        ctx.lineTo(flags[j].x, flags[j].y);
        ctx.strokeStyle = `rgba(0,200,255,${score / 3})`;
        ctx.stroke();
      }
    }
  }

  // Draw nodes
  flags.forEach(f => {
    ctx.beginPath();
    ctx.arc(f.x, f.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = "white";
    ctx.fill();

    ctx.fillStyle = "white";
    ctx.font = "12px Arial";
    ctx.fillText(f.name, f.x + 12, f.y + 4);
  });
}