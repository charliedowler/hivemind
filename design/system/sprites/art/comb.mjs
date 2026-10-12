const shell = [
  "......KKKK......",
  "....KKAAAAKK....",
  "..KKAAAAAAAAKK..",
  "KKAAAAIIIIAAAAKK",
  "KAAAIIIIIIIIAAAK",
  "KAAIIIIIIIIIIAAK",
  "KAAIIIIIIIIIIAAK",
  "KAAIIIIIIIIIIAAK",
  "KAAIIIIIIIIIIAAK",
  "KAAIIIIIIIIIIAAK",
  "KAAIIIIIIIIIIAAK",
  "KAAIIIIIIIIIIAAK",
  "KAAIIIIIIIIIIAAK",
  "KAAAIIIIIIIIAAAK",
  "KKAAAAIIIIAAAAKK",
  "..KKAAAAAAAAKK..",
  "....KKAAAAKK....",
  "......KKKK......",
];

export const CELL_W = 16;
export const CELL_H = 18;
export const ROW_STEP = 14;

const paint = (wall, inside) =>
  shell.map((row, y) =>
    Array.from(row)
      .map((key, x) => (key === "A" ? wall(x, y) : key === "I" ? inside(x, y) : key))
      .join(""),
  );

const honeyWall = (x, y) => (y <= 2 && x <= 8 ? "L" : y >= 15 || x >= 13 ? "h" : "y");
const greyWall = (x, y) => (y >= 15 || x >= 13 ? "G" : "m");
const tealWall = (x, y) => (y >= 15 || x >= 13 ? "t" : "T");

const hollow = (x, y) => ((x + y) % 2 === 0 && y >= 10 ? "d" : "D");
const honey = (x, y) => (y === 4 && x >= 5 && x <= 7 ? "p" : y <= 5 && x <= 5 ? "L" : y >= 12 || x >= 11 ? "h" : "H");
const level = (line) => (x, y) => (y < line ? hollow(x, 0) : y === line ? (x % 3 === 0 ? "p" : "L") : y >= 12 || x >= 11 ? "h" : "H");
const cap = (x, y) => (y <= 5 && x <= 6 ? "C" : (x === 9 && y === 7) || (x === 5 && y === 10) || (x === 10 && y === 11) ? "M" : y >= 13 || x >= 12 ? "M" : "c");
const stale = (x, y) => (x + y === 15 || (x + y === 16 && y > 7) ? "G" : y >= 12 || x >= 11 ? "m" : "M");
const question = [
  "..PPPP..",
  ".PP..PP.",
  ".....PP.",
  "....PP..",
  "...PP...",
  "........",
  "...PP...",
];
const asked = (x, y) => {
  const glyph = question[y - 5]?.[x - 4];
  return glyph === "P" ? "P" : y >= 13 || x >= 12 ? "U" : "u";
};

export const cells = {
  empty: paint(honeyWall, hollow),
  half: paint(honeyWall, level(9)),
  full: paint(honeyWall, honey),
  sealed: paint(honeyWall, cap),
  outdated: paint(greyWall, stale),
  asked: paint(tealWall, asked),
};

const filling = [9, 7, 5, 11].map((line) => paint(honeyWall, level(line)));

const compose = (rows) => {
  const widest = Math.max(...rows.map((row) => row.cells.length + (row.offset ? 0.5 : 0)));
  const w = Math.ceil(widest * CELL_W);
  const h = CELL_H + (rows.length - 1) * ROW_STEP;
  const canvas = Array.from({ length: h }, () => Array(w).fill("."));
  rows.forEach((row, r) => {
    row.cells.forEach((state, c) => {
      if (!state) return;
      const left = c * CELL_W + (row.offset ? CELL_W / 2 : 0);
      const top = r * ROW_STEP;
      cells[state].forEach((line, y) => {
        Array.from(line).forEach((key, x) => {
          if (key !== ".") canvas[top + y][left + x] = key;
        });
      });
    });
  });
  return { w, h, frames: [canvas.map((line) => line.join(""))] };
};

const tile = (key) => {
  const h = ROW_STEP * 2;
  const canvas = Array.from({ length: h }, () => Array(CELL_W).fill("."));
  const stamps = [[0, 0], [-CELL_W / 2, ROW_STEP], [CELL_W / 2, ROW_STEP], [0, h], [0, -h]];
  stamps.forEach(([left, top]) => {
    shell.forEach((line, y) => {
      Array.from(line).forEach((cell, x) => {
        const cx = left + x;
        const cy = top + y;
        if (cell === "K" && cx >= 0 && cx < CELL_W && cy >= 0 && cy < h) canvas[cy][cx] = key;
      });
    });
  });
  return { w: CELL_W, h, frames: [canvas.map((line) => line.join(""))] };
};

const single = (rows) => ({ w: CELL_W, h: CELL_H, frames: [rows] });

export const combSprites = {
  "cell-empty": single(cells.empty),
  "cell-filling": { w: CELL_W, h: CELL_H, frames: filling, timeline: [[3, 320], [0, 320], [1, 320], [2, 320]] },
  "cell-half": single(cells.half),
  "cell-full": single(cells.full),
  "cell-sealed": single(cells.sealed),
  "cell-outdated": single(cells.outdated),
  "cell-asked": single(cells.asked),
  "comb-cluster": compose([
    { offset: true, cells: ["sealed", "full"] },
    { offset: false, cells: ["full", "half", "empty"] },
    { offset: true, cells: ["full", "sealed"] },
  ]),
  "comb-hero": compose([
    { offset: false, cells: [null, "full", "sealed", "full", null] },
    { offset: true, cells: ["sealed", "full", "half", "empty"] },
    { offset: false, cells: ["full", "full", "sealed", "full", "empty"] },
    { offset: true, cells: ["full", "asked", "full", "half"] },
    { offset: false, cells: [null, "sealed", "full", "outdated", null] },
  ]),
};

export const combTiles = {
  "comb-tile-wax": tile("c"),
  "comb-tile-hive": tile("D"),
  "comb-tile-honey": tile("H"),
  "comb-tile-teal": tile("u"),
};
