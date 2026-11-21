// GTA 6 meme generator for Make.fun
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';

const FONT: Record<string, number[]> = {
  ' ': [0x00, 0x00, 0x00, 0x00, 0x00],
  '.': [0x00, 0x03, 0x03, 0x00, 0x00],
  '1': [0x21, 0x21, 0x7F, 0x01, 0x01],
  '3': [0x49, 0x49, 0x49, 0x49, 0x7F],
  '6': [0x3E, 0x49, 0x49, 0x49, 0x06],
  'A': [0x3F, 0x48, 0x48, 0x48, 0x3F],
  'D': [0x7F, 0x41, 0x41, 0x41, 0x3E],
  'E': [0x7F, 0x49, 0x49, 0x49, 0x49],
  'F': [0x7F, 0x48, 0x48, 0x48, 0x48],
  'G': [0x3E, 0x41, 0x49, 0x49, 0x2E],
  'I': [0x41, 0x41, 0x7F, 0x41, 0x41],
  'K': [0x7F, 0x08, 0x14, 0x22, 0x41],
  'M': [0x7F, 0x60, 0x58, 0x60, 0x7F],
  'N': [0x7F, 0x60, 0x50, 0x48, 0x7F],
  'O': [0x3E, 0x41, 0x41, 0x41, 0x3E],
  'P': [0x7F, 0x48, 0x48, 0x48, 0x30],
  'R': [0x7F, 0x48, 0x4C, 0x4A, 0x31],
  'S': [0x31, 0x49, 0x49, 0x49, 0x46],
  'T': [0x40, 0x40, 0x7F, 0x40, 0x40],
  'U': [0x7E, 0x01, 0x01, 0x01, 0x7E],
  'W': [0x7F, 0x06, 0x45, 0x06, 0x7F],
  'Y': [0x60, 0x10, 0x1F, 0x10, 0x60]
};

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[i] = c;
}

function crc32(buf: Buffer): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function makeChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const crcVal = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crcVal, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function lerpColor(c1: [number, number, number], c2: [number, number, number], t: number): [number, number, number] {
  const tc = Math.max(0, Math.min(1, t));
  return [
    Math.round(c1[0] + (c2[0] - c1[0]) * tc),
    Math.round(c1[1] + (c2[1] - c1[1]) * tc),
    Math.round(c1[2] + (c2[2] - c1[2]) * tc)
  ];
}

class Framebuffer {
  width = 1024;
  height = 1024;
  data = Buffer.alloc(1024 * 1024 * 3, 0);

  setPixel(x: number, y: number, rgb: [number, number, number]) {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || xi >= this.width || yi < 0 || yi >= this.height) return;
    const idx = (yi * this.width + xi) * 3;
    this.data[idx] = rgb[0];
    this.data[idx + 1] = rgb[1];
    this.data[idx + 2] = rgb[2];
  }

  blendPixel(x: number, y: number, rgb: [number, number, number], alpha: number) {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || xi >= this.width || yi < 0 || yi >= this.height) return;
    const idx = (yi * this.width + xi) * 3;
    const a = Math.max(0, Math.min(1, alpha));
    const invA = 1 - a;
    this.data[idx] = Math.round(this.data[idx] * invA + rgb[0] * a);
    this.data[idx + 1] = Math.round(this.data[idx + 1] * invA + rgb[1] * a);
    this.data[idx + 2] = Math.round(this.data[idx + 2] * invA + rgb[2] * a);
  }

  fillRect(x: number, y: number, w: number, h: number, rgb: [number, number, number]) {
    const x0 = Math.max(0, Math.floor(x));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y0 = Math.max(0, Math.floor(y));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    for (let yi = y0; yi < y1; yi++) {
      for (let xi = x0; xi < x1; xi++) {
        const idx = (yi * this.width + xi) * 3;
        this.data[idx] = rgb[0];
        this.data[idx + 1] = rgb[1];
        this.data[idx + 2] = rgb[2];
      }
    }
  }

  fillCircle(cx: number, cy: number, r: number, rgb: [number, number, number]) {
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.width, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.height, Math.ceil(cy + r));
    const r2 = r * r;
    for (let yi = y0; yi < y1; yi++) {
      const dy = yi - cy;
      const dy2 = dy * dy;
      for (let xi = x0; xi < x1; xi++) {
        const dx = xi - cx;
        if (dx * dx + dy2 <= r2) {
          const idx = (yi * this.width + xi) * 3;
          this.data[idx] = rgb[0];
          this.data[idx + 1] = rgb[1];
          this.data[idx + 2] = rgb[2];
        }
      }
    }
  }

  drawLine(x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let cx = x0;
    let cy = y0;
    while (true) {
      this.setPixel(cx, cy, rgb);
      if (cx === x1 && cy === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        cx += sx;
      }
      if (e2 < dx) {
        err += dx;
        cy += sy;
      }
    }
  }

  fillPolygon(points: [number, number][], rgb: [number, number, number]) {
    if (points.length < 3) return;
    let minY = this.height;
    let maxY = 0;
    for (const p of points) {
      if (p[1] < minY) minY = Math.floor(p[1]);
      if (p[1] > maxY) maxY = Math.ceil(p[1]);
    }
    minY = Math.max(0, minY);
    maxY = Math.min(this.height - 1, maxY);

    for (let y = minY; y <= maxY; y++) {
      const nodes: number[] = [];
      let j = points.length - 1;
      for (let i = 0; i < points.length; i++) {
        const yi = points[i][1];
        const yj = points[j][1];
        if ((yi < y && yj >= y) || (yj < y && yi >= y)) {
          const xi = points[i][0];
          const xj = points[j][0];
          nodes.push(xi + (y - yi) / (yj - yi) * (xj - xi));
        }
        j = i;
      }
      nodes.sort((a, b) => a - b);
      for (let i = 0; i < nodes.length; i += 2) {
        if (i + 1 < nodes.length) {
          const xStart = Math.max(0, Math.ceil(nodes[i]));
          const xEnd = Math.min(this.width, Math.floor(nodes[i + 1]));
          for (let x = xStart; x <= xEnd; x++) {
            this.setPixel(x, y, rgb);
          }
        }
      }
    }
  }

  verticalGradient(x: number, y: number, w: number, h: number, cTop: [number, number, number], cBottom: [number, number, number]) {
    const x0 = Math.max(0, Math.floor(x));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y0 = Math.max(0, Math.floor(y));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    const totalH = h === 0 ? 1 : h;
    for (let yi = y0; yi < y1; yi++) {
      const t = (yi - y) / totalH;
      const col = lerpColor(cTop, cBottom, t);
      for (let xi = x0; xi < x1; xi++) {
        const idx = (yi * this.width + xi) * 3;
        this.data[idx] = col[0];
        this.data[idx + 1] = col[1];
        this.data[idx + 2] = col[2];
      }
    }
  }

  textWidth(text: string, scale: number): number {
    if (text.length === 0) return 0;
    return text.length * 6 * scale - scale;
  }

  drawText(text: string, x: number, y: number, scale: number, color: [number, number, number], outlineColor: [number, number, number]) {
    const offsets = [
      [-scale, -scale], [0, -scale], [scale, -scale],
      [-scale, 0],                    [scale, 0],
      [-scale, scale],  [0, scale],  [scale, scale]
    ];
    for (const [ox, oy] of offsets) {
      this.drawTextRaw(text, x + ox, y + oy, scale, outlineColor);
    }
    this.drawTextRaw(text, x, y, scale, color);
  }

  drawTextRaw(text: string, startX: number, startY: number, scale: number, color: [number, number, number]) {
    let cursorX = startX;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const glyph = FONT[ch] || FONT['?'] || [0, 0, 0, 0, 0];
      for (let col = 0; col < 5; col++) {
        const b = glyph[col];
        for (let row = 0; row < 7; row++) {
          if ((b & (1 << (6 - row))) !== 0) {
            this.fillRect(cursorX + col * scale, startY + row * scale, scale, scale, color);
          }
        }
      }
      cursorX += 6 * scale;
    }
  }
}

function encodePNG(fb: Framebuffer): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(fb.width, 0);
  ihdrData.writeUInt32BE(fb.height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type RGB
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdrChunk = makeChunk('IHDR', ihdrData);

  const rowSize = fb.width * 3;
  const rawData = Buffer.alloc(fb.height * (rowSize + 1));
  for (let y = 0; y < fb.height; y++) {
    rawData[y * (rowSize + 1)] = 0; // filter byte 0
    fb.data.copy(rawData, y * (rowSize + 1) + 1, y * rowSize, (y + 1) * rowSize);
  }

  const idatData = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', idatData);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function drawScene(fb: Framebuffer) {
  // 1. Sky gradients
  const skyH = 620;
  fb.verticalGradient(0, 0, 1024, 120, hexToRgb('#1A0B2E'), hexToRgb('#7B2D8B'));
  fb.verticalGradient(0, 120, 1024, 180, hexToRgb('#7B2D8B'), hexToRgb('#FF2E63'));
  fb.verticalGradient(0, 300, 1024, 180, hexToRgb('#FF2E63'), hexToRgb('#FF9A3D'));
  fb.verticalGradient(0, 480, 1024, 140, hexToRgb('#FF9A3D'), hexToRgb('#FFD166'));

  // 2. Sun
  const sunCx = 730;
  const sunCy = 400;
  fb.fillCircle(sunCx, sunCy, 120, hexToRgb('#FFD166'));
  fb.fillCircle(sunCx, sunCy, 100, hexToRgb('#FFF3B0'));

  // 3. Skyline silhouette & windows
  fb.fillRect(0, 560, 1024, 65, hexToRgb('#140A24'));
  const windowCols = [
    50, 65, 120, 135, 210, 225, 340, 355, 420, 435, 510, 525,
    630, 645, 750, 765, 840, 855, 920, 935, 980, 995
  ];
  for (const wx of windowCols) {
    fb.fillRect(wx, 575, 8, 12, hexToRgb('#FFD166'));
    fb.fillRect(wx, 600, 8, 12, hexToRgb('#FFD166'));
  }

  // 4. Ocean
  fb.verticalGradient(0, 625, 1024, 135, hexToRgb('#0E4D64'), hexToRgb('#083344'));
  // Shimmer dashes
  for (let y = 640; y < 750; y += 18) {
    for (let x = 100; x < 900; x += 90) {
      fb.fillRect(x + ((y * 7) % 30), y, 22, 3, hexToRgb('#7FD4E8'));
    }
  }
  // Sun reflection column
  fb.verticalGradient(sunCx - 35, 625, 70, 135, [255, 209, 102], [8, 51, 68]);

  // 5. Road
  fb.fillRect(0, 760, 1024, 264, hexToRgb('#1F2430'));
  // Sandy shoulders
  fb.fillPolygon([[0, 760], [140, 760], [0, 1024]], hexToRgb('#C9A86A'));
  fb.fillPolygon([[1024, 760], [884, 760], [1024, 1024]], hexToRgb('#C9A86A'));
  // Centre line dashes
  for (let y = 780; y < 1024; y += 45) {
    fb.fillRect(508, y, 8, 28, hexToRgb('#FFD166'));
  }

  // 6. Palm trees
  // Left palm
  fb.fillPolygon([[50, 1024], [80, 1024], [70, 700], [55, 700]], hexToRgb('#12081F'));
  for (const [fx, fy] of [[65, 690], [45, 670], [85, 675], [60, 650], [75, 655]]) {
    fb.fillCircle(fx, fy, 18, hexToRgb('#12081F'));
  }
  // Right palm
  fb.fillPolygon([[974, 1024], [944, 1024], [954, 700], [969, 700]], hexToRgb('#12081F'));
  for (const [fx, fy] of [[959, 690], [939, 670], [979, 675], [954, 650], [969, 655]]) {
    fb.fillCircle(fx, fy, 18, hexToRgb('#12081F'));
  }

  // 7. Convertible car
  fb.fillPolygon([[220, 905], [800, 905], [760, 810], [260, 810]], hexToRgb('#16121F'));
  // Rim light
  fb.drawLine(260, 810, 760, 810, hexToRgb('#FF2E63'));
  // Wheels
  fb.fillCircle(330, 905, 55, hexToRgb('#0A070F'));
  fb.fillCircle(330, 905, 25, hexToRgb('#3A3445'));
  fb.fillCircle(690, 905, 55, hexToRgb('#0A070F'));
  fb.fillCircle(690, 905, 25, hexToRgb('#3A3445'));
  // Passengers
  fb.fillCircle(350, 800, 32, hexToRgb('#0E0A18')); // driver cap
  fb.fillRect(325, 790, 35, 15, hexToRgb('#0E0A18'));
  fb.fillCircle(580, 795, 38, hexToRgb('#0E0A18')); // passenger

  // 8. Ghost mascot (Make.fun)
  // Outer black silhouette
  fb.fillCircle(515, 610, 135, [0, 0, 0]);
  fb.fillRect(380, 610, 270, 240, [0, 0, 0]);
  // Scallops bottom
  fb.fillCircle(425, 850, 35, [0, 0, 0]);
  fb.fillCircle(515, 850, 35, [0, 0, 0]);
  fb.fillCircle(605, 850, 35, [0, 0, 0]);

  // White body
  fb.fillCircle(515, 610, 120, [255, 255, 255]);
  fb.fillRect(395, 610, 240, 240, [255, 255, 255]);
  fb.fillCircle(425, 850, 30, [255, 255, 255]);
  fb.fillCircle(515, 850, 30, [255, 255, 255]);
  fb.fillCircle(605, 850, 30, [255, 255, 255]);

  // Eyes (sparkle stars)
  for (const [ex, ey] of [[470, 590], [560, 590]]) {
    fb.fillCircle(ex, ey, 10, [0, 0, 0]);
    fb.fillRect(ex - 12, ey - 3, 24, 6, [0, 0, 0]);
    fb.fillRect(ex - 3, ey - 12, 6, 24, [0, 0, 0]);
  }

  // Raised hand
  fb.fillCircle(640, 600, 22, [0, 0, 0]);
  fb.fillCircle(640, 600, 18, [255, 255, 255]);

  // Magenta disc (centred at 640, 545 per fix brief)
  const discCx = 640;
  const discCy = 545;
  const discR = 45;
  fb.fillCircle(discCx, discCy, discR, hexToRgb('#E6007E'));

  // White five-pointed star on disc
  // Simple polygon/points for a star
  const starPoints: [number, number][] = [
    [discCx, discCy - 22],
    [discCx + 6, discCy - 6],
    [discCx + 22, discCy - 6],
    [discCx + 9, discCy + 4],
    [discCx + 14, discCy + 20],
    [discCx, discCy + 10],
    [discCx - 14, discCy + 20],
    [discCx - 9, discCy + 4],
    [discCx - 22, discCy - 6],
    [discCx - 6, discCy - 6]
  ];
  fb.fillPolygon(starPoints, [255, 255, 255]);
}

function main() {
  const botDir = process.env.MAKEFUN_BOT_DIR || '/bot';
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

  const resolvedBotDir = path.resolve(botDir);
  const resolvedOutDir = path.resolve(outDir);

  const fb = new Framebuffer();
  drawScene(fb);

  // Captions
  // Top captions
  const top1 = 'WAITED 13 YEARS';
  const w1 = fb.textWidth(top1, 8);
  fb.drawText(top1, Math.round((1024 - w1) / 2), 36, 8, [255, 255, 255], [0, 0, 0]);

  const top2 = 'FOR GTA 6';
  const w2 = fb.textWidth(top2, 8);
  fb.drawText(top2, Math.round((1024 - w2) / 2), 108, 8, [255, 255, 255], [0, 0, 0]);

  // Bottom caption area
  fb.fillRect(0, 920, 1024, 104, hexToRgb('#12081F'));

  // MY AI AGENT GOT PAID (scale 6, top near 924)
  const bot1 = 'MY AI AGENT GOT PAID';
  const w3 = fb.textWidth(bot1, 6);
  fb.drawText(bot1, Math.round((1024 - w3) / 2), 924, 6, [255, 255, 255], [0, 0, 0]);

  // ON MAKE.FUN (scale 7, top near 970 per fix brief)
  const prefix = 'ON ';
  const suffix = 'MAKE.FUN';
  const fullLine = prefix + suffix;
  const wFull = fb.textWidth(fullLine, 7);
  const startX = Math.round((1024 - wFull) / 2);

  const wPrefix = fb.textWidth(prefix, 7);
  fb.drawText(prefix, startX, 970, 7, [255, 255, 255], [0, 0, 0]);
  fb.drawText(suffix, startX + wPrefix, 970, 7, hexToRgb('#FF2E63'), [0, 0, 0]);

  // Output
  if (!fs.existsSync(resolvedOutDir)) {
    fs.mkdirSync(resolvedOutDir, { recursive: true });
  }

  const pngBuf = encodePNG(fb);
  fs.writeFileSync(path.join(resolvedOutDir, 'meme.png'), pngBuf);

  const postSrc = path.join(resolvedBotDir, 'POST.json');
  const postDest = path.join(resolvedOutDir, 'POST.json');
  if (fs.existsSync(postSrc)) {
    fs.copyFileSync(postSrc, postDest);
  }

  console.log('Meme generated successfully in', resolvedOutDir);
}

main();
