const wingsUp = [
  "....KK..........",
  "...KWWK.KK......",
  "..KWWWWKWWK..K..",
  "..KWWWwKWWK.K..K",
  "...KWwwKWwK.K.K.",
];

const wingsDown = [
  "................",
  "................",
  ".............K..",
  ".KKKKKKKK...K..K",
  "KWWWWWWwwK..K.K.",
];

const body = [
  "..KKKKKKKKKKKKK.",
  ".KYYKKYYKKYYYYYK",
  "KKYYKKYYKKYYEKYK",
  "KKYYKKYYKKYYKKYK",
  ".KyyKKyyKKyYYYYK",
  "..KKKKKKKKKKKKK.",
];

const badged = [
  "..KKKKKKKKKKKKK.",
  ".KYAAAAAAKYYYYYK",
  "KKYUAUUUUKYYEKYK",
  "KKYUUAUEEKYYKKYK",
  ".KyUAUUUUKyYYYYK",
  "..KKKKKKKKKKKKK.",
];

const legs = ["....K..K..K.....", "...K..K..K......", "................", "................", "................"];
const legsTucked = ["...K..K..K......", "....K..K..K.....", "................", "................", "................"];
const holding = ["....K.KKK.K.....", ".....KLHHK......", ".....KHHhK......", "......KKK.......", "................"];
const letting = ["....K..K..K.....", "...K..K..K......", "......KKK.......", ".....KLHHK......", "......KKK......."];

const mirror = (rows) => rows.map((row) => Array.from(row).reverse().join(""));
const build = (wings, torso, under) => [...wings, ...torso, ...under];
const flap = (torso, under, alt = under) => [build(wingsUp, torso, under), build(wingsDown, torso, alt)];

const base = { w: 16, h: 16 };
const hover = flap(body, legs, legsTucked);
const carry = flap(body, holding);
const deposit = [build(wingsUp, body, holding), build(wingsDown, body, letting), build(wingsUp, body, legs), build(wingsDown, body, legsTucked)];
const agent = flap(badged, legs, legsTucked);

const face = [
  "..KK........KK..",
  "..KK........KK..",
  "...K........K...",
  "....K.KKKK.K....",
  "....KKYYYYKK....",
  "...KYYYYYYYYK...",
  "..KYKKYYYYKKYK..",
  "..KYEKYYYYEKYK..",
  "..KYNYYYYYYNYK..",
  "..KYYYKKKKYYYK..",
  "..KYYYYYYYYYYK..",
  "..KKKKKKKKKKKK..",
  "..KYYYYYYYYYYK..",
  "..KKKKKKKKKKKK..",
  "...KyyyyyyyyK...",
  "....KKKKKKKK....",
];

const blink = face.map((row, index) => (index === 6 ? "..KYYYYYYYYYYK.." : index === 7 ? "..KYKKYYYYKKYK.." : row));

export const beeSprites = {
  bee: { ...base, frames: [hover[0]] },
  "bee-hover": { ...base, frames: hover, timeline: [[0, 140], [1, 140]] },
  "bee-fly": { ...base, frames: hover, timeline: [[0, 70], [1, 70]] },
  "bee-fly-left": { ...base, frames: hover.map(mirror), timeline: [[0, 70], [1, 70]] },
  "bee-carry": { ...base, frames: carry, timeline: [[0, 90], [1, 90]] },
  "bee-carry-left": { ...base, frames: carry.map(mirror), timeline: [[0, 90], [1, 90]] },
  "bee-deposit": { ...base, frames: deposit, timeline: [[0, 280], [1, 280], [0, 280], [1, 280], [2, 140], [3, 140], [2, 140], [3, 140]] },
  "bee-claude": { ...base, palette: { A: "#E8744A" }, frames: agent, timeline: [[0, 140], [1, 140]] },
  "bee-codex": { ...base, palette: { A: "#3BB3B8" }, frames: agent, timeline: [[0, 140], [1, 140]] },
  "bee-face": { ...base, frames: [face, blink], timeline: [[0, 2600], [1, 160]] },
};
