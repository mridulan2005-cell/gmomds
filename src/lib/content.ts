// Curated content: onboarding tiles, place themes, prompt pools and the per-kind palette.
import type { Guess, Motion, Spot } from './types';
import { motionFor, prettyLabel } from './motionRules';

/** pairs of drawings (prompts) that finish a place and reveal its theme */
export const PAIRS = 4, PAIRS_WORD = 'Four';
/** What the place says as each pair builds a little more of it (MapScene.scenery), per theme, after pair 1…PAIRS. */
export const BUILD_NOTES: Record<string, string[]> = {
  river: ['Oh, a riverbed is dug out! Keep drawing to see what fills it.', 'Water is trickling in! Keep going to get it flowing.', 'The river is starting to flow! Reeds are growing on its banks.', 'The river is flowing! Lily pads and a little bridge are here.'],
  garden: ['Oh, flower beds are dug! Keep drawing to see what grows.', 'Tiny sprouts are popping up! What will they become?', 'Trees and hedges have grown! Something is about to bloom…', 'The flowers are blooming! What a place you made.'],
  market: ['Oh, wooden posts are going up! Keep drawing to see what they hold.', 'Colourful awnings are up! Somebody is setting up shop…', 'Fruit and crates are arriving! It is getting busy.', 'Flags and lanterns are up! Everything is ready.'],
  rooftop: ['Oh, roof tiles are laid! Keep drawing to see what is up here.', 'A water tank and pots of plants! Keep going…', 'A washing line and a kite! It is breezy up here.', 'Fairy lights and stars are out! What a night.'],
};
export const INK = '#3d2b22', DADI = '#2F5FD0', CHILD = '#E4572E', ORANGE = '#F26A2E', SUN = '#FFC93C';
export const inkOf = (who: 'dadi' | 'child') => (who === 'dadi' ? DADI : CHILD);

const circ = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
const ell = (cx: number, cy: number, rx: number, ry: number) => `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;

/** Placeholder icons (64×64) from the prototype. Used only for onboarding tiles and the optional sample data. */
export const ICON: Record<string, { f: string[]; s: string[] }> = {
  cat: { f: ['M14 30L16 10 28 20Q32 19 36 20L48 10 50 30Q50 52 32 52 14 52 14 30Z'], s: ['M25 32h.1M39 32h.1M28 40q4 4 8 0'] },
  bird: { f: ['M8 38Q20 16 40 28L56 20 46 34Q44 52 24 48Q12 46 8 38Z'], s: ['M36 33h.1M18 52l-4 6M28 52l-2 6'] },
  mango: { f: ['M32 16Q54 18 50 40 46 58 28 52 10 46 16 28 20 16 32 16Z'], s: ['M32 16Q40 4 50 10'] },
  chai: { f: ['M12 26H44V40Q44 54 28 54 12 54 12 40Z'], s: ['M44 30Q58 30 54 40 52 46 44 46M22 6q-5 6 0 11M32 6q-5 6 0 11'] },
  diya: { f: ['M6 36Q32 64 58 36Z', 'M32 34Q20 22 32 6 44 22 32 34Z'], s: [] },
  kite: { f: ['M32 4L52 28 32 52 12 28Z'], s: ['M32 4V52M12 28H52M32 52q-9 4 0 8t0 5'] },
  note: { f: [ell(18, 46, 7, 5.5), ell(44, 40, 7, 5.5)], s: ['M24 46V14L50 8V40'] },
  waves: { f: [], s: ['M6 18q8-9 13 0t13 0t13 0t13 0M6 32q8-9 13 0t13 0t13 0t13 0M6 46q8-9 13 0t13 0t13 0t13 0'] },
  tree: { f: ['M32 6Q54 6 52 28 48 42 32 40 14 42 12 26 10 6 32 6Z'], s: ['M32 58V36'] },
  moon: { f: ['M40 6Q12 12 16 38 22 60 48 52 26 46 28 28 30 14 40 6Z'], s: ['M50 14l3 7 7 1-6 4 2 7-6-4-6 4 2-7-6-4 7-1z'] },
  fish: { f: ['M6 32Q26 10 46 32 26 54 6 32Z', 'M46 32L60 18V46Z'], s: ['M18 29h.1'] },
  home: { f: ['M12 28V56H52V28Z'], s: ['M6 30L32 6 58 30', 'M27 56V40H39V56'] },
  sun: { f: [circ(32, 32, 11)], s: ['M32 6v10M32 48v10M6 32h10M48 32h10M14 14l7 7M43 43l7 7M14 50l7-7M43 21l7-7'] },
  boat: { f: ['M8 40H56L48 56H16Z', 'M32 36V6L52 32Z'], s: ['M4 60q8-6 14 0t14 0t14 0'] },
  bell: { f: ['M14 46Q14 14 32 12 50 14 50 46Z'], s: ['M8 48H56M28 56h8M32 6v6'] },
  drum: { f: ['M8 24Q32 12 56 24V46Q32 60 8 46Z'], s: ['M8 24Q32 36 56 24M20 6l8 16M44 6l-8 16'] },
  flower: { f: [circ(32, 22, 6), circ(32, 9, 6), circ(45, 22, 6), circ(19, 22, 6), circ(32, 35, 6)], s: ['M32 58V34'] },
};

/** Fill colour per kind (NC in the prototype) — used when a drawing has no crayon colour of its own. */
export const NC: Record<string, string> = {
  cat: '#FFB26B', bird: '#FFC93C', mango: '#FF9F1C', chai: '#C98B5A', diya: '#FF7A1A', kite: '#FF5D8F', note: '#9B5DE5', waves: '#5AB0F0', tree: '#6CC24A', moon: '#FFE066', fish: '#FF8A3D', home: '#E86A4A', house: '#E86A4A', sun: '#FFCE1F', boat: '#E4572E', bell: '#FFC93C', drum: '#E4572E', flower: '#FF7BAC',
  dog: '#D9A066', cow: '#F4E3C3', butterfly: '#FF7BAC', star: '#FFE066', cloud: '#FFFFFF', heart: '#FF5D8F', apple: '#F25C54', banana: '#FFE066', car: '#5AB0F0', train: '#E4572E', person: '#FFB26B', grandma: '#C9A3E8', girl: '#FFB26B', boy: '#FFB26B', rainbow: '#FF9F1C', leaf: '#6CC24A', plant: '#6CC24A', river: '#5AB0F0', rain: '#8CCFF0', duck: '#FFE066', elephant: '#B8B8C8', rabbit: '#F4E3C3', ball: '#F25C54', cup: '#C98B5A', lamp: '#FF7A1A', candle: '#FF7A1A', balloon: '#FF5D8F', plane: '#8CCFF0', turtle: '#6CC24A', frog: '#6CC24A', bee: '#FFC93C',
};
const PALETTE = ['#FFC93C', '#FF9F1C', '#FF7BAC', '#9BD770', '#8CCFF0', '#F6C778', '#C9A3E8', '#FFB26B'];
export function fillFor(kind: string, seed = 0) { return NC[kind] || PALETTE[(hash(kind) + seed) % PALETTE.length]; }
function hash(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }

/** The onboarding "what do you love?" tiles: broad interests, each with its own little icon and colour. */
export const TILES: [string, string][] = [['Animals', 'animals'], ['Birds', 'birds'], ['Sky', 'sky'], ['Sea', 'sea'], ['Snow', 'snow'], ['Garden', 'garden'], ['Stories', 'stories'], ['Family', 'family'], ['Friends', 'friends'], ['Food', 'food'], ['God', 'god'], ['Music', 'music']];
/** A hand-drawn picture for each tile (public/loves). */
export const LOVE_ART: Record<string, string> = Object.fromEntries(
  ['animals', 'family', 'food', 'friends', 'garden', 'god', 'music', 'sea', 'snow', 'stories'].map(k => [k, `${import.meta.env.BASE_URL}loves/${k}.png`])
    .concat([['birds', `${import.meta.env.BASE_URL}loves/birds.svg`], ['sky', `${import.meta.env.BASE_URL}loves/sky.svg`]]),
);
export const LOVE_ICON: Record<string, { f: string[]; s: string[]; c: string }> = {
  animals: { ...ICON.cat, c: '#FFB26B' },
  birds: { ...ICON.bird, c: '#FFC93C' },
  sky: { f: ['M10 46Q4 46 4 39 4 32 12 32 13 24 22 24 28 16 38 22 50 20 50 32 60 32 60 40 60 46 52 46Z'], s: ['M44 6v5M56 12l-4 4M32 12l4 4'], c: '#8CCFF0' },
  sea: { ...ICON.waves, c: '#5AB0F0' },
  snow: { f: [], s: ['M32 6V58M9 19L55 45M9 45L55 19', 'M26 10l6 6 6-6M26 54l6-6 6 6M10 27l8-2-2-8M54 37l-8 2 2 8M10 37l8 2-2 8M54 27l-8-2 2-8'], c: '#BFE6FA' },
  garden: { ...ICON.flower, c: '#FF7BAC' },
  stories: { f: ['M32 16Q20 8 6 12V52Q20 48 32 56Z', 'M32 16Q44 8 58 12V52Q44 48 32 56Z'], s: ['M32 16V56M14 22q6-1 11 2M14 31q6-1 11 2M39 24q6-3 11-2M39 33q6-3 11-2'], c: '#C9A3E8' },
  family: { ...ICON.home, c: '#E86A4A' },
  friends: { f: ['M18 24a8 8 0 1 0 .1 0Z', 'M46 24a8 8 0 1 0 .1 0Z', 'M4 56Q4 38 18 38 32 38 32 56Z', 'M32 56Q32 38 46 38 60 38 60 56Z'], s: ['M24 44q8 4 16 0'], c: '#9BD770' },
  food: { ...ICON.mango, c: '#FF9F1C' },
  god: { ...ICON.diya, c: '#FF7A1A' },
  music: { ...ICON.note, c: '#9B5DE5' },
};

export interface ThemeDef { theme: string; color: string; shape: 'A' | 'B' | 'C' | 'D'; prompts: string[] }
/** The four hidden themes of every map's places (water, growing things, food and things, sky). */
export const THEMES: ThemeDef[] = [
  { theme: 'river', color: '#8CCFF0', shape: 'A', prompts: ['Draw something that moves', 'Draw something that floats', 'Draw something that lives in water', 'Draw something shiny', 'Draw something that makes a splash', 'Draw something that sings', 'Draw something you see on a boat ride', 'Draw something wet'] },
  { theme: 'garden', color: '#9BD770', shape: 'B', prompts: ['Draw something that grows', 'Draw something with leaves', 'Draw a tiny creature', 'Draw something green', 'Draw something that smells nice', 'Draw a place to rest', 'Draw something sweet from a tree', 'Draw a morning visitor'] },
  { theme: 'market', color: '#F6C778', shape: 'C', prompts: ['Draw your favourite fruit', 'Draw something round', 'Draw something you drink', 'Draw something you carry', 'Draw a treat', 'Draw something from a festival', 'Draw something colourful', 'Draw something that makes a sound'] },
  { theme: 'rooftop', color: '#F2A28A', shape: 'D', prompts: ['Draw something you see at night', 'Draw something that flies', 'Draw something in the sky', 'Draw something warm', 'Draw something that lights up', 'Draw something that waves', 'Draw something far away', 'Draw something you hold with both hands'] },
];

/** Each map is a kind of place; its four places are named for it, in the order of THEMES (water, garden, market, sky). */
export interface MapKind { name: string; places: [string, string, string, string] }
export const MAPS: MapKind[] = [
  { name: 'The Town', places: ['The River', 'The Garden', 'The Market', 'The Rooftop'] },
  { name: 'The Hillside', places: ['The Stream', 'The Tea Garden', 'The Village Fair', 'The Hilltop'] },
  { name: 'The Animal Sanctuary', places: ['The Watering Hole', 'The Grassland', 'The Fruit Grove', 'The Treetops'] },
  { name: 'The City', places: ['The Canal', 'The Park', 'The Bazaar', 'The Terrace'] },
  { name: 'The Seaside', places: ['The Beach', 'The Coconut Grove', 'The Fish Market', 'The Lighthouse'] },
  { name: 'The Forest', places: ['The Waterfall', 'The Clearing', 'The Berry Patch', 'The Treehouse'] },
  { name: 'The Village', places: ['The Pond', 'The Courtyard', 'The Kitchen', 'The Balcony'] },
  { name: 'The Desert', places: ['The Oasis', 'The Cactus Garden', 'The Camel Fair', 'The Dunes'] },
];

/** A prompt in a curated place; on a together day they draw on one sheet, side by side. */
export interface PromptDef { text: string; together?: boolean }
export interface PlaceDef { name: string; shape: 'A' | 'B' | 'C' | 'D'; color: string; theme: string; prompts?: PromptDef[] }
export interface MapDef { name: string; places: PlaceDef[] }
const pr = (text: string, together = false): PromptDef => (together ? { text, together } : { text });

/**
 * The first maps tell a little story, with their own prompts and their own number of places:
 * a one-place Welcome Party, then a Dream House of rooms. After them come the kinds of places in MAPS (four places each).
 */
export const STORY_MAPS: MapDef[] = [
  { name: 'Welcome Party', places: [
    { name: 'Welcome Party', shape: 'D', color: '#F2A28A', theme: '', prompts: [pr('Draw something you’d bring to a party'), pr('Draw a song you’d dance to'), pr('Draw the party lights'), pr('Draw a gift for each other')] },
  ] },
  { name: 'Dream House', places: [
    { name: 'Living Room', shape: 'C', color: '#F6C778', theme: '', prompts: [pr('Draw the other person’s perfect evening.'), pr('What can you see outside your dream window?'), pr('Draw something you’d keep forever.'), pr('Fill one room with things you both love.', true)] },
    { name: 'Kitchen', shape: 'A', color: '#F2A28A', theme: '', prompts: [pr('Draw a food that takes you back to a happy memory.'), pr('If you were a dish, what would you taste like?'), pr('Who would you invite to a special dinner?'), pr('Set one big table with both your favourite foods.', true)] },
    { name: 'Park', shape: 'B', color: '#9BD770', theme: 'garden', prompts: [pr('Draw each other with your ages swapped.'), pr('Draw something you’ve always wanted to do.'), pr('Draw a place you’d love to take each other.')] },
  ] },
];

/** The Welcome Party's first pairs come already drawn ([Dadi's, the grandchild's]), one per prompt but the last. */
export const WELCOME_DRAWN: [string, string][] = [['drum', 'mango'], ['note', 'bell'], ['diya', 'sun']];

/** The n-th map (0 = the first one they make). */
export function mapDef(n: number): MapDef {
  if (n < STORY_MAPS.length) return STORY_MAPS[n];
  const kind = MAPS[(n - STORY_MAPS.length) % MAPS.length];
  return { name: kind.name, places: THEMES.map((t, i) => ({ name: kind.places[i], shape: t.shape, color: t.color, theme: t.theme })) };
}

/** Finished example maps: [prompt, Dadi's drawing, the grandchild's drawing] per theme, drawn with the sample icons. */
export const EXAMPLE_PAIRS: Record<string, [string, string, string][]> = {
  river: [['Draw something that moves', 'waves', 'fish'], ['Draw something that floats', 'diya', 'boat'], ['Draw something shiny', 'fish', 'sun'], ['Draw something that sings', 'bird', 'note'], ['Draw something you see on a boat ride', 'fish', 'boat'], ['Draw something that lives in water', 'fish', 'fish'], ['Draw something wet', 'waves', 'boat'], ['Draw something that makes a splash', 'boat', 'fish']],
  garden: [['Draw something that grows', 'tree', 'flower'], ['Draw something with leaves', 'tree', 'flower'], ['Draw a morning visitor', 'bird', 'cat'], ['Draw something green', 'tree', 'tree'], ['Draw something that smells nice', 'flower', 'chai'], ['Draw a place to rest', 'home', 'tree'], ['Draw something sweet from a tree', 'mango', 'mango'], ['Draw a tiny creature', 'bird', 'cat']],
  market: [['Draw your favourite fruit', 'mango', 'mango'], ['Draw something round', 'sun', 'drum'], ['Draw something you drink', 'chai', 'chai'], ['Draw something from a festival', 'diya', 'kite'], ['Draw something colourful', 'kite', 'flower'], ['Draw something that makes a sound', 'bell', 'drum'], ['Draw a treat', 'mango', 'chai'], ['Draw something you carry', 'drum', 'kite']],
  rooftop: [['Draw something you see at night', 'moon', 'diya'], ['Draw something that flies', 'kite', 'bird'], ['Draw something in the sky', 'sun', 'moon'], ['Draw something warm', 'sun', 'chai'], ['Draw something that lights up', 'diya', 'moon'], ['Draw something far away', 'moon', 'tree'], ['Draw something you hold with both hands', 'chai', 'drum'], ['Draw something that waves', 'waves', 'flower']],
};
export const themeLabel = (t: string) => ({ river: 'River', garden: 'Garden', market: 'Market', rooftop: 'Rooftop' } as Record<string, string>)[t] || t;

/** Prompts drawn from the onboarding picks. */
export const LOVE_PROMPTS: Record<string, string[]> = {
  animals: ['Draw a friend with four legs', 'Draw an animal having a nap', 'Draw the biggest animal you know'],
  birds: ['Draw a bird you saw last', 'Draw a bird in its nest', 'Draw something with feathers'],
  sky: ['Draw something in the sky', 'Draw the sky at night', 'Draw a cloud that looks like something'],
  sea: ['Draw something from the sea', 'Draw something that swims', 'Draw a day at the beach'],
  snow: ['Draw something cold', 'Draw a snowy day', 'Draw something you wear in winter'],
  garden: ['Draw something that grows', 'Draw a flower you like', 'Draw a tree you know'],
  stories: ['Draw someone from a story', 'Draw a magical creature', 'Draw the start of a story'],
  family: ['Draw someone in your family', 'Draw where you sleep', 'Draw something you do together'],
  friends: ['Draw a friend', 'Draw a game you play with friends', 'Draw something you would share'],
  food: ['Draw your favourite food', 'Draw something sweet', 'Draw something you drink together'],
  god: ['Draw something from a festival', 'Draw something that glows', 'Draw a place you pray'],
  music: ['Draw a song you know', 'Draw something that makes music', 'Draw someone dancing'],
};

export const MOTIONS: Motion[] = ['fly', 'swim', 'sway', 'float', 'spin', 'bounce', 'swing', 'flicker', 'breathe', 'rock', 'flow', 'walk', 'hop', 'none'];

/** What we know about common kinds: how they move and where they live. Used for local guesses and corrections. */
export const KINDS: Record<string, [Motion, Spot, string]> = {
  bird: ['fly', 'sky', 'a little bird'], sparrow: ['fly', 'sky', 'a sparrow'], parrot: ['fly', 'sky', 'a parrot'], crow: ['fly', 'sky', 'a crow'], peacock: ['walk', 'ground', 'a peacock'], butterfly: ['fly', 'sky', 'a butterfly'], bee: ['fly', 'sky', 'a busy bee'], plane: ['fly', 'sky', 'an aeroplane'],
  fish: ['swim', 'water', 'a fish'], duck: ['swim', 'water', 'a duck'], turtle: ['swim', 'water', 'a turtle'], whale: ['swim', 'water', 'a whale'], boat: ['rock', 'water', 'a boat'],
  waves: ['flow', 'water', 'waves'], river: ['flow', 'water', 'a river'], rain: ['flow', 'sky', 'rain'],
  tree: ['sway', 'ground', 'a tree'], flower: ['sway', 'ground', 'a flower'], plant: ['sway', 'ground', 'a plant'], leaf: ['sway', 'ground', 'a leaf'], grass: ['sway', 'ground', 'grass'],
  sun: ['spin', 'sky', 'the sun'], moon: ['float', 'sky', 'the moon'], star: ['float', 'sky', 'a star'], cloud: ['float', 'sky', 'a cloud'], kite: ['float', 'sky', 'a kite'], balloon: ['float', 'sky', 'a balloon'], rainbow: ['float', 'sky', 'a rainbow'], heart: ['float', 'ground', 'a heart'],
  cat: ['walk', 'ground', 'a cat'], dog: ['walk', 'ground', 'a dog'], cow: ['walk', 'ground', 'a cow'], elephant: ['walk', 'ground', 'an elephant'], person: ['walk', 'ground', 'a person'], car: ['walk', 'ground', 'a car'], train: ['walk', 'ground', 'a train'],
  rabbit: ['hop', 'ground', 'a rabbit'], frog: ['hop', 'ground', 'a frog'],
  ball: ['bounce', 'ground', 'a ball'], drum: ['bounce', 'ground', 'a drum'],
  bell: ['swing', 'ground', 'a bell'], lantern: ['swing', 'ground', 'a lantern'],
  diya: ['flicker', 'ground', 'a diya'], candle: ['flicker', 'ground', 'a candle'], lamp: ['flicker', 'ground', 'a lamp'], fire: ['flicker', 'ground', 'a fire'],
  note: ['bounce', 'ground', 'a song'], home: ['breathe', 'ground', 'a home'], house: ['breathe', 'ground', 'a house'], mango: ['breathe', 'ground', 'a mango'], apple: ['breathe', 'ground', 'an apple'], chai: ['breathe', 'ground', 'a cup of chai'], cup: ['breathe', 'ground', 'a cup'],
};
const ALIASES: Record<string, string> = { birds: 'bird', fishes: 'fish', trees: 'tree', flowers: 'flower', kites: 'kite', cats: 'cat', dogs: 'dog', stars: 'star', boats: 'boat', water: 'waves', wave: 'waves', sea: 'waves', grows: 'plant', grow: 'plant', night: 'moon', sky: 'cloud', flies: 'bird', fly: 'bird', swims: 'fish', swim: 'fish', song: 'note', sing: 'note', sings: 'note', music: 'note', light: 'diya', lights: 'diya', glows: 'diya', diwali: 'diya', fruit: 'mango', sweet: 'mango', drink: 'chai', tea: 'chai', sleep: 'home', rest: 'home', four: 'cat', legs: 'cat', warm: 'sun', round: 'ball', sound: 'bell', floats: 'boat', float: 'boat', tall: 'tree', leaves: 'tree', green: 'leaf', creature: 'bee', visitor: 'bird' };

/** A guess for any word: curated kinds first, then the general motion rules, so typed corrections move too. */
export function guessFor(kind: string): Guess {
  const k = KINDS[kind];
  if (k) return { kind, motion: k[0], place: k[1], label: k[2] };
  const m = motionFor(kind);
  return { kind, motion: m.motion, place: m.place, label: prettyLabel(kind) };
}

/** Offline guess, used only when Claude can't be reached: lean on the prompt's words. */
export function localGuess(prompt: string): Guess & { confidence: number; alternatives: Guess[] } {
  const words = prompt.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  const hits: string[] = [];
  for (const w of words) { const k = KINDS[w] ? w : ALIASES[w]; if (k && KINDS[k] && !hits.includes(k)) hits.push(k); }
  if (!hits.length) return { kind: 'drawing', label: 'a lovely drawing', motion: 'breathe', place: 'ground', confidence: 0.1, alternatives: ['bird', 'tree', 'flower'].map(guessFor) };
  const [first, ...rest] = hits;
  return { ...guessFor(first), confidence: 0.4, alternatives: rest.concat(['bird', 'tree', 'cat'].filter(k => !hits.includes(k))).slice(0, 3).map(guessFor) };
}

export const QUICK_PICKS = ['bird', 'fish', 'tree', 'flower', 'cat', 'sun', 'moon', 'boat', 'house', 'person', 'butterfly', 'kite'];
