/* Mure — pluie de glyphes du héros.
   Un seul canvas, ~18 img/s, arrêté quand l'onglet est masqué.
   Rien ne s'exécute si l'utilisateur préfère réduire les animations. */

const canvas = document.getElementById("rain");
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

const GLYPHS = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン0123456789abcdef#@$%&*<>/\\{}[]=+-";
const FONT_SIZE = 15;
const FPS = 18;

let ctx = null;
let columns = 0;
let drops = [];
let raf = 0;
let last = 0;
let running = false;

function setup() {
  if (!canvas) return false;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return false;

  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);

  ctx = canvas.getContext("2d");
  if (!ctx) return false;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  columns = Math.ceil(rect.width / FONT_SIZE);
  drops = Array.from({ length: columns }, () => Math.random() * -40);
  ctx.fillStyle = "#040705";
  ctx.fillRect(0, 0, rect.width, rect.height);
  ctx.font = `${FONT_SIZE}px "JetBrains Mono", ui-monospace, monospace`;
  return true;
}

function frame(now) {
  if (!running) return;
  if (now - last < 1000 / FPS) {
    raf = requestAnimationFrame(frame);
    return;
  }
  last = now;

  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  ctx.fillStyle = "rgba(4, 7, 5, 0.10)";
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < columns; i += 1) {
    const y = drops[i] * FONT_SIZE;
    const glyph = GLYPHS[(Math.random() * GLYPHS.length) | 0];
    const head = Math.random() < 0.04;

    ctx.fillStyle = head ? "#d6ffe2" : "#2fdd5f";
    ctx.fillText(glyph, i * FONT_SIZE, y);

    if (y > h && Math.random() > 0.975) drops[i] = Math.random() * -20;
    drops[i] += 1;
  }

  raf = requestAnimationFrame(frame);
}

function start() {
  if (running || reduce.matches || !setup()) return;
  running = true;
  last = 0;
  raf = requestAnimationFrame(frame);
}

function stop() {
  running = false;
  cancelAnimationFrame(raf);
}

if (canvas) {
  if (reduce.matches) {
    canvas.hidden = true;
  } else {
    start();
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
      else start();
    });

    let resizeTimer = 0;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        stop();
        start();
      }, 220);
    });

    reduce.addEventListener("change", (event) => {
      if (event.matches) {
        stop();
        canvas.hidden = true;
      } else {
        canvas.hidden = false;
        start();
      }
    });
  }
}
