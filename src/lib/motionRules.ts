// How any recognised thing should move, by what kind of thing it is.
// Covers every DoodleNet category plus common words a family might type, so no drawing is left without life.
import type { Motion, Spot } from './types';

type Rule = [Motion, Spot, string[]];
const RULES: Rule[] = [
  ['fly', 'sky', ['bird', 'parrot', 'owl', 'swan', 'flamingo', 'crow', 'sparrow', 'pigeon', 'eagle', 'butterfly', 'bee', 'mosquito', 'bat', 'dragon', 'angel', 'airplane', 'plane', 'helicopter', 'flying_saucer', 'ufo', 'fairy', 'dragonfly', 'fly', 'insect', 'rocket', 'feather', 'peacock_flying']],
  ['swim', 'water', ['fish', 'shark', 'whale', 'dolphin', 'octopus', 'crab', 'lobster', 'sea_turtle', 'turtle', 'mermaid', 'duck', 'submarine', 'snorkel', 'jellyfish', 'seal', 'frogfish', 'goldfish']],
  ['rock', 'water', ['boat', 'sailboat', 'canoe', 'speedboat', 'cruise_ship', 'aircraft_carrier', 'ship', 'raft', 'cradle', 'see_saw', 'rocking_chair']],
  ['flow', 'water', ['ocean', 'river', 'pond', 'pool', 'beach', 'waterslide', 'rain', 'wave', 'waves', 'sea', 'squiggle', 'zigzag', 'line', 'garden_hose', 'animal_migration', 'stitches', 'hot_tub', 'water']],
  ['float', 'sky', ['cloud', 'moon', 'star', 'rainbow', 'hot_air_balloon', 'balloon', 'parachute', 'kite', 'snowflake', 'lightning', 'heart', 'bubble', 'hurricane', 'tornado', 'ghost']],
  ['spin', 'sky', ['sun']],
  ['spin', 'ground', ['fan', 'ceiling_fan', 'windmill', 'wheel', 'bicycle', 'compass', 'clock', 'alarm_clock', 'wristwatch', 'circle', 'donut', 'pizza', 'cookie', 'soccer_ball', 'basketball', 'baseball', 'hockey_puck', 'bottlecap', 'roller_coaster', 'boomerang', 'top', 'diamond', 'octagon', 'hexagon', 'star_shape']],
  ['walk', 'ground', ['cat', 'dog', 'cow', 'horse', 'sheep', 'pig', 'lion', 'tiger', 'bear', 'panda', 'elephant', 'giraffe', 'zebra', 'camel', 'rhinoceros', 'monkey', 'raccoon', 'squirrel', 'hedgehog', 'mouse', 'ant', 'spider', 'scorpion', 'snail', 'snake', 'crocodile', 'penguin', 'goat', 'deer', 'peacock', 'hen', 'chicken', 'person', 'man', 'woman', 'girl', 'boy', 'baby', 'grandma', 'grandmother', 'dadi', 'nani', 'grandpa', 'family', 'friend', 'teacher', 'face', 'smiley_face', 'yoga', 'snowman', 'teddy-bear', 'car', 'truck', 'pickup_truck', 'bus', 'school_bus', 'train', 'tractor', 'van', 'police_car', 'ambulance', 'firetruck', 'bulldozer', 'motorbike', 'skateboard', 'rollerskates', 'rickshaw', 'auto', 'scooter', 'cart']],
  ['hop', 'ground', ['rabbit', 'bunny', 'kangaroo', 'frog', 'grasshopper', 'cricket', 'toad']],
  ['bounce', 'ground', ['ball', 'drums', 'drum', 'dumbbell', 'basket', 'jack', 'toy', 'note', 'music', 'song', 'guitar', 'violin', 'cello', 'piano', 'trumpet', 'trombone', 'saxophone', 'clarinet', 'harp', 'microphone', 'headphones', 'megaphone', 'radio', 'stereo', 'telephone', 'cell_phone', 'tabla', 'flute']],
  ['swing', 'ground', ['bell', 'lantern', 'chandelier', 'swing_set', 'swing', 'necklace', 'bracelet', 'purse', 'key', 'umbrella', 'hourglass', 'pendulum']],
  ['flicker', 'ground', ['candle', 'campfire', 'fireplace', 'fire', 'matches', 'lighter', 'light_bulb', 'flashlight', 'floor_lamp', 'streetlight', 'lighthouse', 'traffic_light', 'diya', 'lamp', 'torch', 'firework', 'sparkler']],
  ['sway', 'ground', ['tree', 'palm_tree', 'flower', 'house_plant', 'bush', 'grass', 'leaf', 'cactus', 'mushroom', 'broccoli', 'asparagus', 'garden', 'plant', 'sunflower', 'rose', 'lotus', 'bamboo', 'string_bean', 'carrot', 'onion', 'flag', 'scarecrow', 'mountain']],
];
const MAP = new Map<string, [Motion, Spot]>();
for (const [m, p, words] of RULES) for (const w of words) if (!MAP.has(w)) MAP.set(w, [m, p]);

const singular = (w: string) => w.replace(/(ies)$/, 'y').replace(/(ches|shes|xes|ses)$/, m => m.slice(0, -2)).replace(/([^s])s$/, '$1');

/** Motion and place for any word; things we don't know get a gentle breathe on the ground. */
export function motionFor(word: string): { motion: Motion; place: Spot; known: boolean } {
  const w = word.toLowerCase().trim().replace(/[\s-]+/g, '_');
  const hit = MAP.get(w) || MAP.get(singular(w)) || MAP.get(w.split('_').pop()!) || MAP.get(singular(w.split('_').pop()!));
  return hit ? { motion: hit[0], place: hit[1], known: true } : { motion: 'breathe', place: 'ground', known: false };
}

export const prettyLabel = (label: string) => {
  const t = label.replace(/_/g, ' ').replace(/^The /, 'the ');
  if (/^the /.test(t) || /s$/.test(t) && !/ss$/.test(t)) return t;
  return (/^[aeiou]/i.test(t) ? 'an ' : 'a ') + t;
};
