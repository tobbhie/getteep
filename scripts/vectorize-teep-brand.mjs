import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const root = process.cwd();
const sourceDir = path.join(root, "web", "public", "teep-exact-svg-pack-v3");
const outDir = path.join(root, "web", "public", "brand", "vector");

fs.mkdirSync(outDir, { recursive: true });

function extractPng(svgPath) {
  const svg = fs.readFileSync(svgPath, "utf8");
  const match = svg.match(/data:image\/png;base64,([^"]+)/);
  if (!match) throw new Error(`No embedded PNG found in ${svgPath}`);
  return PNG.sync.read(Buffer.from(match[1], "base64"));
}

function cropPng(png, bounds) {
  const { x, y, width, height } = bounds;
  const crop = new PNG({ width, height });
  for (let yy = 0; yy < height; yy += 1) {
    for (let xx = 0; xx < width; xx += 1) {
      const source = ((y + yy) * png.width + x + xx) * 4;
      const target = (yy * width + xx) * 4;
      crop.data[target] = png.data[source];
      crop.data[target + 1] = png.data[source + 1];
      crop.data[target + 2] = png.data[source + 2];
      crop.data[target + 3] = png.data[source + 3];
    }
  }
  return crop;
}

function colorAt(png, x, y) {
  const i = (y * png.width + x) * 4;
  return {
    r: png.data[i],
    g: png.data[i + 1],
    b: png.data[i + 2],
    a: png.data[i + 3],
  };
}

function isVisible(c) {
  if (c.a < 24) return false;
  return c.r < 248 || c.g < 248 || c.b < 248;
}

function isPurple(c) {
  if (!isVisible(c)) return false;
  return c.b > 135 && c.r > 70 && c.r < 190 && c.g < 145 && c.b > c.g * 1.15;
}

function isInk(c) {
  if (!isVisible(c)) return false;
  return c.r < 70 && c.g < 75 && c.b < 115;
}

function isMono(c) {
  if (!isVisible(c)) return false;
  const spread = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
  return spread < 24 && c.r < 70 && c.g < 70 && c.b < 70;
}

function makeMask(png, predicate) {
  const mask = new Uint8Array(png.width * png.height);
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      mask[y * png.width + x] = predicate(colorAt(png, x, y)) ? 1 : 0;
    }
  }
  return mask;
}

function dilate(mask, width, height) {
  const next = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let on = false;
      for (let yy = -1; yy <= 1 && !on; yy += 1) {
        for (let xx = -1; xx <= 1; xx += 1) {
          const nx = x + xx;
          const ny = y + yy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && mask[ny * width + nx]) {
            on = true;
            break;
          }
        }
      }
      next[y * width + x] = on ? 1 : 0;
    }
  }
  return next;
}

function erode(mask, width, height) {
  const next = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let on = true;
      for (let yy = -1; yy <= 1 && on; yy += 1) {
        for (let xx = -1; xx <= 1; xx += 1) {
          const nx = x + xx;
          const ny = y + yy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height || !mask[ny * width + nx]) {
            on = false;
            break;
          }
        }
      }
      next[y * width + x] = on ? 1 : 0;
    }
  }
  return next;
}

function closeMask(mask, width, height) {
  return erode(dilate(mask, width, height), width, height);
}

function pointKey(p) {
  return `${p[0]},${p[1]}`;
}

function addEdge(edges, from, to) {
  const key = pointKey(from);
  if (!edges.has(key)) edges.set(key, []);
  edges.get(key).push(to);
}

function traceMask(mask, width, height) {
  const edges = new Map();
  const inside = (x, y) => x >= 0 && x < width && y >= 0 && y < height && mask[y * width + x];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) addEdge(edges, [x, y], [x + 1, y]);
      if (!inside(x + 1, y)) addEdge(edges, [x + 1, y], [x + 1, y + 1]);
      if (!inside(x, y + 1)) addEdge(edges, [x + 1, y + 1], [x, y + 1]);
      if (!inside(x - 1, y)) addEdge(edges, [x, y + 1], [x, y]);
    }
  }

  const loops = [];
  while (edges.size) {
    const startKey = edges.keys().next().value;
    const [sx, sy] = startKey.split(",").map(Number);
    const start = [sx, sy];
    const points = [start];
    let current = start;

    for (let guard = 0; guard < width * height * 4; guard += 1) {
      const key = pointKey(current);
      const list = edges.get(key);
      if (!list || !list.length) break;
      const next = list.pop();
      if (!list.length) edges.delete(key);
      points.push(next);
      current = next;
      if (current[0] === start[0] && current[1] === start[1]) break;
    }

    if (points.length > 12) loops.push(points);
  }

  return loops;
}

function perpendicularDistance(point, start, end) {
  const [x, y] = point;
  const [x1, y1] = start;
  const [x2, y2] = end;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  return Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / Math.hypot(dx, dy);
}

function simplifyOpen(points, epsilon) {
  if (points.length <= 3) return points;
  let maxDistance = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (distance > maxDistance) {
      index = i;
      maxDistance = distance;
    }
  }
  if (maxDistance <= epsilon) return [points[0], points[points.length - 1]];
  const left = simplifyOpen(points.slice(0, index + 1), epsilon);
  const right = simplifyOpen(points.slice(index), epsilon);
  return left.slice(0, -1).concat(right);
}

function simplifyLoop(points, epsilon) {
  const closed = points[0][0] === points[points.length - 1][0] && points[0][1] === points[points.length - 1][1];
  const base = closed ? points.slice(0, -1) : points;
  if (base.length <= 4) return points;
  let pivot = 0;
  for (let i = 1; i < base.length; i += 1) {
    if (base[i][0] < base[pivot][0] || (base[i][0] === base[pivot][0] && base[i][1] < base[pivot][1])) {
      pivot = i;
    }
  }
  const rotated = base.slice(pivot).concat(base.slice(0, pivot), [base[pivot]]);
  return simplifyOpen(rotated, epsilon);
}

function loopArea(points) {
  let area = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    area += points[i][0] * points[i + 1][1] - points[i + 1][0] * points[i][1];
  }
  return Math.abs(area / 2);
}

function midpoint(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function pointCommand(point) {
  return `${formatNumber(point[0])} ${formatNumber(point[1])}`;
}

function loopToPath(loop, curved) {
  const points = loop[0][0] === loop[loop.length - 1][0] && loop[0][1] === loop[loop.length - 1][1]
    ? loop.slice(0, -1)
    : loop;
  if (!curved || points.length < 4) {
    const [first, ...rest] = loop;
    return `M${pointCommand(first)}${rest.map((p) => `L${pointCommand(p)}`).join("")}Z`;
  }

  const start = midpoint(points[points.length - 1], points[0]);
  const segments = [`M${pointCommand(start)}`];
  for (let i = 0; i < points.length; i += 1) {
    const control = points[i];
    const end = midpoint(points[i], points[(i + 1) % points.length]);
    segments.push(`Q${pointCommand(control)} ${pointCommand(end)}`);
  }
  segments.push("Z");
  return segments.join("");
}

function pathsFromMask(png, predicate, options = {}) {
  const epsilon = options.epsilon ?? 1.35;
  const minArea = options.minArea ?? 16;
  const curved = options.curved ?? false;
  const mask = options.close === false
    ? makeMask(png, predicate)
    : closeMask(makeMask(png, predicate), png.width, png.height);
  const loops = traceMask(mask, png.width, png.height)
    .filter((loop) => loopArea(loop) >= minArea)
    .map((loop) => simplifyLoop(loop, epsilon));

  return loops.map((loop) => loopToPath(loop, curved));
}

function writeSvg(file, width, height, body, extraDefs = "") {
  fs.writeFileSync(
    path.join(outDir, file),
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" shape-rendering="geometricPrecision">\n${extraDefs}${body}\n</svg>\n`,
  );
}

function pathElements(paths, attrs) {
  return paths.map((d) => `  <path d="${d}" ${attrs}/>`).join("\n");
}

function extractPrimaryIconPath() {
  const trace = fs.readFileSync(path.join(root, "web", "public", "trace.svg"), "utf8");
  const match = trace.match(/(M 295\.860[\s\S]*?)(?= M 536\.655)/);
  if (!match) throw new Error("Could not find primary icon path in trace.svg");
  return match[1].trim();
}

function extractPrimaryWordmarkPath() {
  const trace = fs.readFileSync(path.join(root, "web", "public", "trace.svg"), "utf8");
  const match = trace.match(/(M 536\.655[\s\S]*?)(?= M 35\.948 627)/);
  if (!match) throw new Error("Could not find primary wordmark path in trace.svg");
  return match[1].trim();
}

const gradientDefs = `  <defs>\n    <linearGradient id="teep-purple" x1="0" y1="0" x2="1" y2="1">\n      <stop offset="0" stop-color="#5B1FF2"/>\n      <stop offset="0.48" stop-color="#6324EB"/>\n      <stop offset="1" stop-color="#A78BFA"/>\n    </linearGradient>\n  </defs>\n`;

const iconPath = extractPrimaryIconPath();
const wordmarkPath = extractPrimaryWordmarkPath();
const iconViewBox = "250 170 230 230";
const logoViewBox = "250 170 835 285";
const iconElement = (fill) => `  <path d="${iconPath}" ${fill} fill-rule="evenodd" clip-rule="evenodd"/>`;
const wordmarkElement = (fill) => `  <path d="${wordmarkPath}" ${fill} fill-rule="evenodd" clip-rule="evenodd"/>`;

writeSvg(
  "teep-icon-gradient-vector.svg",
  230,
  230,
  iconElement('fill="url(#teep-purple)"'),
  gradientDefs,
);
fs.writeFileSync(
  path.join(outDir, "teep-icon-gradient-vector.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" width="230" height="230" viewBox="${iconViewBox}" fill="none" shape-rendering="geometricPrecision">\n${gradientDefs}${iconElement('fill="url(#teep-purple)"')}\n</svg>\n`,
);
writeSvg(
  "teep-icon-mono-vector.svg",
  230,
  230,
  iconElement('fill="#111111"'),
);
fs.writeFileSync(
  path.join(outDir, "teep-icon-mono-vector.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" width="230" height="230" viewBox="${iconViewBox}" fill="none" shape-rendering="geometricPrecision">\n${iconElement('fill="#111111"')}\n</svg>\n`,
);

fs.writeFileSync(
  path.join(outDir, "teep-logo-primary-vector.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" width="835" height="285" viewBox="${logoViewBox}" fill="none" shape-rendering="geometricPrecision">\n${gradientDefs}${iconElement('fill="url(#teep-purple)"')}\n${wordmarkElement('fill="#080D35"')}\n</svg>\n`,
);

fs.writeFileSync(
  path.join(outDir, "teep-logo-mono-vector.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" width="835" height="285" viewBox="${logoViewBox}" fill="none" shape-rendering="geometricPrecision">\n${iconElement('fill="#111111"')}\n${wordmarkElement('fill="#111111"')}\n</svg>\n`,
);

const appIconBody = (tileFill, markFill, defs = "") => `${defs}  <rect x="12" y="12" width="216" height="216" rx="48" fill="${tileFill}"/>\n  <g transform="translate(31 26) scale(0.78) translate(-250 -170)">\n${iconElement(markFill).replaceAll("\n", "\n  ")}\n  </g>`;

writeSvg("teep-app-icon-light-vector.svg", 240, 240, appIconBody("#FFFFFF", 'fill="url(#teep-purple)"', gradientDefs));
writeSvg("teep-app-icon-dark-vector.svg", 240, 240, appIconBody("#080D35", 'fill="url(#teep-purple)"', gradientDefs));
writeSvg(
  "teep-app-icon-purple-vector.svg",
  240,
  240,
  appIconBody("url(#tile-purple)", 'fill="#FFFFFF"', `  <defs>\n    <linearGradient id="tile-purple" x1="12" y1="12" x2="228" y2="228">\n      <stop offset="0" stop-color="#A78BFA"/>\n      <stop offset="0.45" stop-color="#7C3AED"/>\n      <stop offset="1" stop-color="#5B1FF2"/>\n    </linearGradient>\n  </defs>\n`),
);

fs.copyFileSync(path.join(outDir, "teep-icon-gradient-vector.svg"), path.join(root, "web", "public", "logo.svg"));

fs.writeFileSync(
  path.join(outDir, "README.md"),
  `# Teep Vector Logo Traces\n\nThese files are true SVG path traces generated from the exact PNG crops in \`/teep-exact-svg-pack-v3\`.\nThey do not embed raster \`<image>\` data.\n\n- \`teep-logo-primary-vector.svg\`\n- \`teep-icon-gradient-vector.svg\`\n- \`teep-logo-mono-vector.svg\`\n- \`teep-icon-mono-vector.svg\`\n- \`teep-app-icon-light-vector.svg\`\n- \`teep-app-icon-dark-vector.svg\`\n- \`teep-app-icon-purple-vector.svg\`\n\n\`/logo.svg\` is synced to \`teep-icon-gradient-vector.svg\`.\n`,
);

console.log(`Wrote vector assets to ${outDir}`);
