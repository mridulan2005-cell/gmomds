// What a grandmother or a small child would most likely draw for a prompt, most likely first.
// The free on-device recogniser (CLIP) picks among these, so a rough circle with a tail drawn for
// "something that makes a splash" is read as a fish, not a balloon.

const BY_PROMPT: Record<string, string[]> = {
  // river
  'draw something that moves': ['car', 'fish', 'bird', 'train', 'boat', 'butterfly', 'cat', 'dog', 'bicycle', 'river'],
  'draw something that floats': ['boat', 'duck', 'balloon', 'cloud', 'leaf', 'fish', 'lotus', 'bubble', 'kite', 'feather'],
  'draw something that lives in water': ['fish', 'duck', 'frog', 'turtle', 'crab', 'whale', 'octopus', 'dolphin', 'lotus', 'snail'],
  'draw something shiny': ['star', 'sun', 'diamond', 'moon', 'fish', 'necklace', 'mirror', 'coin', 'crown', 'diya'],
  'draw something that makes a splash': ['fish', 'frog', 'duck', 'rain', 'whale', 'boat', 'stone', 'wave', 'child', 'dolphin'],
  'draw something that sings': ['bird', 'frog', 'person', 'cricket', 'radio', 'bell', 'parrot', 'cuckoo', 'guitar', 'flute'],
  'draw something you see on a boat ride': ['fish', 'boat', 'duck', 'bird', 'sun', 'lotus', 'tree', 'wave', 'cloud', 'bridge'],
  'draw something wet': ['rain', 'umbrella', 'fish', 'cloud', 'frog', 'puddle', 'duck', 'wave', 'boat', 'towel'],
  // garden
  'draw something that grows': ['tree', 'flower', 'plant', 'sunflower', 'grass', 'mango', 'carrot', 'mushroom', 'cactus', 'child'],
  'draw something with leaves': ['tree', 'flower', 'plant', 'leaf', 'palm tree', 'bush', 'sunflower', 'cactus', 'rose', 'tulsi'],
  'draw a tiny creature': ['ant', 'butterfly', 'bee', 'ladybug', 'snail', 'spider', 'caterpillar', 'mouse', 'bird', 'frog'],
  'draw something green': ['tree', 'leaf', 'frog', 'grass', 'parrot', 'cactus', 'plant', 'snake', 'turtle', 'cucumber'],
  'draw something that smells nice': ['flower', 'rose', 'food', 'cake', 'mango', 'tea', 'candle', 'jasmine', 'lotus', 'soap'],
  'draw a place to rest': ['bed', 'house', 'chair', 'tree', 'bench', 'swing', 'hammock', 'sofa', 'tent', 'pillow'],
  'draw something sweet from a tree': ['mango', 'apple', 'banana', 'cherry', 'orange', 'coconut', 'guava', 'pear', 'jackfruit', 'honey'],
  'draw a morning visitor': ['bird', 'sun', 'cat', 'crow', 'sparrow', 'dog', 'milkman', 'butterfly', 'squirrel', 'person'],
  // market
  'draw your favourite fruit': ['mango', 'apple', 'banana', 'watermelon', 'orange', 'grapes', 'strawberry', 'pineapple', 'cherry', 'pear'],
  'draw something round': ['ball', 'sun', 'moon', 'apple', 'orange', 'wheel', 'clock', 'pizza', 'cookie', 'balloon'],
  'draw something you drink': ['cup', 'tea', 'glass', 'milk', 'juice', 'bottle', 'coconut', 'mug', 'water', 'lemonade'],
  'draw something you carry': ['bag', 'basket', 'umbrella', 'box', 'bucket', 'phone', 'baby', 'book', 'purse', 'flower'],
  'draw a treat': ['ice cream', 'cake', 'cookie', 'candy', 'laddoo', 'chocolate', 'lollipop', 'donut', 'jalebi', 'cupcake'],
  'draw something from a festival': ['diya', 'kite', 'rangoli', 'firework', 'lantern', 'star', 'balloon', 'cake', 'flower', 'drum'],
  'draw something colourful': ['rainbow', 'butterfly', 'flower', 'kite', 'balloon', 'parrot', 'peacock', 'umbrella', 'fish', 'rangoli'],
  'draw something that makes a sound': ['drum', 'bell', 'bird', 'guitar', 'dog', 'car', 'phone', 'clock', 'trumpet', 'whistle'],
  // rooftop
  'draw something you see at night': ['moon', 'star', 'owl', 'bat', 'lamp', 'cloud', 'candle', 'firework', 'cat', 'house'],
  'draw something that flies': ['bird', 'butterfly', 'airplane', 'kite', 'bee', 'helicopter', 'balloon', 'dragonfly', 'rocket', 'parrot'],
  'draw something in the sky': ['sun', 'moon', 'star', 'cloud', 'bird', 'airplane', 'kite', 'rainbow', 'balloon', 'rocket'],
  'draw something warm': ['sun', 'fire', 'cup', 'tea', 'blanket', 'candle', 'diya', 'sweater', 'cat', 'heart'],
  'draw something that lights up': ['lamp', 'diya', 'candle', 'star', 'sun', 'moon', 'light bulb', 'firework', 'firefly', 'torch'],
  'draw something that waves': ['flag', 'hand', 'person', 'tree', 'wave', 'kite', 'flower', 'grass', 'ribbon', 'cat'],
  'draw something far away': ['moon', 'star', 'mountain', 'sun', 'airplane', 'house', 'rocket', 'planet', 'bird', 'cloud'],
  'draw something you hold with both hands': ['cup', 'ball', 'baby', 'book', 'bowl', 'box', 'gift', 'cat', 'flower', 'drum'],
};

// For prompts not in the list (the family's own, or one Claude wrote): words in the prompt point to these.
const BY_WORD: [RegExp, string[]][] = [
  [/fly|sky|air|wing/, ['bird', 'butterfly', 'airplane', 'kite', 'cloud', 'sun', 'bee', 'balloon']],
  [/water|river|sea|swim|splash|rain|wet|pond|boat/, ['fish', 'boat', 'duck', 'frog', 'rain', 'wave', 'turtle', 'whale']],
  [/grow|garden|leaf|leaves|green|plant|tree|flower/, ['tree', 'flower', 'plant', 'leaf', 'sunflower', 'grass', 'butterfly', 'bee']],
  [/eat|food|fruit|sweet|treat|kitchen|market|drink/, ['mango', 'apple', 'banana', 'cake', 'cup', 'ice cream', 'watermelon', 'cookie']],
  [/night|moon|star|dark|light|lamp|glow|festival/, ['moon', 'star', 'diya', 'lamp', 'candle', 'owl', 'firework', 'lantern']],
  [/animal|pet|creature|friend|zoo|farm/, ['cat', 'dog', 'cow', 'elephant', 'bird', 'rabbit', 'lion', 'fish']],
  [/home|house|family|love|people|person|you|yourself|grand/, ['house', 'person', 'family', 'heart', 'grandmother', 'child', 'tree', 'sun']],
  [/sound|music|sing|song|noise/, ['drum', 'bell', 'bird', 'guitar', 'flute', 'radio', 'person', 'trumpet']],
  [/go|move|travel|ride|road|far/, ['car', 'train', 'bus', 'bicycle', 'airplane', 'boat', 'rickshaw', 'road']],
];

/** Common things anyone might draw, for any prompt: the recogniser always considers these too. */
export const EVERYDAY = [
  'bird', 'fish', 'cat', 'dog', 'cow', 'elephant', 'rabbit', 'butterfly', 'bee', 'snake', 'frog', 'duck', 'turtle', 'horse', 'lion',
  'tree', 'flower', 'leaf', 'grass', 'sun', 'moon', 'star', 'cloud', 'rain', 'rainbow', 'mountain', 'river', 'wave',
  'house', 'person', 'stick figure', 'girl', 'boy', 'smiley face', 'face', 'family', 'heart', 'car', 'bus', 'train', 'airplane', 'boat', 'bicycle', 'kite', 'balloon', 'ball',
  'apple', 'mango', 'banana', 'cake', 'cup', 'ice cream', 'diya', 'lamp', 'candle', 'umbrella', 'book', 'clock', 'bell', 'drum', 'rocket',
];

export function likelyFor(prompt: string): string[] {
  const p = prompt.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const exact = BY_PROMPT[p];
  if (exact) return exact;
  const out: string[] = [];
  for (const [re, words] of BY_WORD) if (re.test(p)) for (const w of words) if (!out.includes(w)) out.push(w);
  return out.slice(0, 12);
}

/** Words the recogniser uses that are really another kind of thing ("stick figure" is a person). */
export const SAME_AS: Record<string, string> = { 'stick figure': 'person', 'smiley face': 'face', girl: 'person', boy: 'person', milkman: 'person', child: 'person' };
