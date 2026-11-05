// Server-side Claude calls for Dadi's Map.
// The API key stays on the server; the tablet only talks to /api/*.
// Used by the Vite dev/preview servers (vite.config.ts) and by server/serve.mjs.
import Anthropic from '@anthropic-ai/sdk';
import * as z from 'zod/v4';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const MODEL = process.env.DADI_MODEL || 'claude-opus-5-5';

export const MOTIONS = ['fly', 'swim', 'sway', 'float', 'spin', 'bounce', 'swing', 'flicker', 'breathe', 'rock', 'flow', 'walk', 'hop', 'none'];
const PLACES = ['sky', 'ground', 'water'];

let client = null;
const hasCredentials = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);
function getClient() {
  if (client) return client;
  try { client = new Anthropic(); } catch { client = null; }
  return client;
}

const Guess = z.object({
  kind: z.string().describe('One lowercase English noun for the thing, e.g. "bird", "tree", "cat", "sun", "house".'),
  label: z.string().describe('A short warm caption a grandmother would say, 2-4 words, e.g. "a little bird".'),
  motion: z.enum(MOTIONS),
  place: z.enum(PLACES),
});
const Recognition = z.object({
  // asked first, so the answer is read against what the prompt would bring out
  likely_for_prompt: z.array(z.string()).describe('Before looking closely: 6 to 10 things a grandmother or a small child would most likely draw for the prompt of the day, most likely first, as single nouns.'),
  ...Guess.shape,
  is_drawing: z.boolean().describe('true when there is anything drawn or written by hand: a picture, a scribble, writing, a faint pencil sketch, even a small or unfinished one. false only when there is clearly no hand-made mark at all: a photo of a face, a room or an object, or a screen.'),
  confidence: z.number().describe('0 to 1. How sure you are about kind.'),
  alternatives: z.array(Guess).describe('Up to 3 other things it could be, most likely first.'),
});

const RECOGNISE_SYSTEM = `You look at drawings made on paper by a grandmother (Dadi) and her young grandchild for a calm family drawing app.
Each day they answer the same drawing prompt. The drawings can be very rough: wobbly lines, odd proportions, scribbles, missing parts. A small child might draw a bird as a circle with two lines.
It can be anything at all (an animal, a person, a vehicle, food, a building, a festival, a feeling drawn as a heart), so do not limit yourself to the examples below.
Be generous and imaginative: use the day's prompt as a strong hint, then decide what the drawing most likely is.
Pick a motion that will bring it to life on a small floating island:
- fly: birds, butterflies, bees, planes, dragons
- swim: fish, ducks on water, turtles, whales
- sway: trees, flowers, plants, grass, people waving
- float: moon, clouds, balloons, kites, stars, hearts
- spin: sun, wheels, fans, tops, flowers seen from the front
- bounce: balls, drums, frogs, happy faces
- swing: bells, lanterns, swings, hanging things
- flicker: diyas, candles, fire, lamps
- rock: boats, cradles, rocking chairs
- flow: waves, rivers, rain, wind lines
- walk: cats, dogs, cows, elephants, people, cars, trains
- hop: rabbits, kangaroos, sparrows on the ground, little children
- breathe: buildings, food, cups, objects that just sit there, or when you are unsure
- none: only if nothing else fits
place: "sky" for things that are up high (birds, sun, moon, kites, clouds, planes, stars), "water" for things in water (fish, boats, waves), otherwise "ground".
Only drawings belong on the map, but be generous: these are drawings by young children and grandparents, often faint, scribbly, unfinished, with writing on them, photographed with hands or a table at the edges. Any hand-made mark counts as a drawing. Set is_drawing to false only when there is clearly nothing drawn or written by hand (a photo of a person, a room, an object, a screen).
How to decide:
1. First list what people typically draw for today's prompt (likely_for_prompt). "Draw something that makes a splash" brings fish, frogs, ducks, rain, a stone, a child in a puddle, a whale; "Draw your favourite fruit" brings mango, apple, banana, watermelon.
2. Then look at the drawing's shapes and match them against that list: a circle with a tail drawn for the splash prompt is a fish, not a balloon. Prefer an answer from the list unless the drawing clearly shows something else.
3. Only when the drawing is clearly something not on the list, say what it is.
4. Put the next best answers in alternatives, from the list where they fit, so the family can tap the right one.
Never give up: if you really cannot tell, pick the most likely thing on the list, set confidence low, and use motion "breathe".`;

/**
 * @param {{ image: string, mediaType?: string, prompt: string, who?: string }} body
 */
export async function recognise(body) {
  const c = getClient();
  if (!c) return { status: 503, json: { error: 'no_api_key' } };
  const data = String(body.image || '').replace(/^data:[^,]+,/, '');
  if (!data) return { status: 400, json: { error: 'no_image' } };
  const who = body.who === 'dadi' ? 'Dadi (the grandmother)' : 'the grandchild';
  try {
    const res = await c.messages.parse({
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: 'low', format: zodOutputFormat(Recognition) },
      system: RECOGNISE_SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: body.mediaType || 'image/jpeg', data } },
          { type: 'text', text: `Today's prompt was: "${String(body.prompt || '').slice(0, 200)}".\nThis drawing is by ${who}. What is it, and how should it move?` },
        ],
      }],
    });
    if (res.stop_reason === 'refusal' || !res.parsed_output) return { status: 502, json: { error: 'no_answer' } };
    const { is_drawing, likely_for_prompt, ...out } = res.parsed_output;
    if (is_drawing === false) return { status: 200, json: { ...out, notDrawing: true } };
    out.kind = out.kind.toLowerCase().trim().split(/\s+/).pop() || 'thing';
    out.confidence = Math.max(0, Math.min(1, out.confidence));
    if (out.confidence < 0.35) out.motion = 'breathe';
    out.alternatives = (out.alternatives || []).slice(0, 3);
    return { status: 200, json: out };
  } catch (e) {
    return errorReply(e);
  }
}

const PromptOut = z.object({
  text: z.string().describe('One short open-ended drawing prompt, starting with "Draw".'),
  // shown and read aloud when they chose Hindi
  hi: z.string().describe('The same prompt in simple, warm everyday Hindi, in Devanagari script (e.g. "कुछ ऐसा बनाइए जो उड़ता हो").'),
});

/**
 * @param {{ theme?: string, loves?: {dadi?: string[], child?: string[]}, recent?: string[], childName?: string }} body
 */
export async function makePrompt(body) {
  const c = getClient();
  if (!c) return { status: 503, json: { error: 'no_api_key' } };
  const loves = body.loves || {};
  try {
    const res = await c.messages.parse({
      model: MODEL,
      max_tokens: 1000,
      output_config: { effort: 'low', format: zodOutputFormat(PromptOut) },
      system: 'You write one daily drawing prompt for a grandmother (Dadi) and her young grandchild who each draw their own answer on paper. Keep it to one short line (at most 8 words), open-ended, gentle, easy for a small child, and starting with "Draw". Never mention the hidden theme word itself.',
      messages: [{
        role: 'user',
        content: `Hidden theme of the place we are building: ${body.theme || 'anything'}.
Dadi loves: ${(loves.dadi || []).join(', ') || 'many things'}.
${body.childName || 'The grandchild'} loves: ${(loves.child || []).join(', ') || 'many things'}.
Recent prompts (do not repeat): ${(body.recent || []).slice(-10).join(' | ') || 'none'}.`,
      }],
    });
    const text = res.parsed_output?.text?.trim();
    if (!text) return { status: 502, json: { error: 'no_answer' } };
    const hi = res.parsed_output?.hi?.trim();
    return { status: 200, json: { text: text.replace(/[.!]+$/, ''), ...(hi ? { hi: hi.replace(/[.!।]+$/, '') } : {}) } };
  } catch (e) {
    return errorReply(e);
  }
}

function errorReply(e) {
  if (e instanceof Anthropic.AuthenticationError) return { status: 503, json: { error: 'no_api_key' } };
  if (e instanceof Anthropic.RateLimitError) return { status: 429, json: { error: 'rate_limited' } };
  if (e instanceof Anthropic.APIError) return { status: 502, json: { error: 'api_error', status: e.status } };
  // Missing credentials surface as a plain Error from the SDK.
  if (e && /api key|apiKey|authToken|credentials/i.test(String(e.message))) return { status: 503, json: { error: 'no_api_key' } };
  console.error('[dadi api]', e);
  return { status: 500, json: { error: 'server_error' } };
}

// ---- the voice: a natural neural voice (Azure Speech), warm and lively ----
// AZURE_SPEECH_KEY + AZURE_SPEECH_REGION turn it on; without them the tablet uses its own voices.
const hasTts = () => !!(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION);
const VOICES = {
  en: process.env.DADI_VOICE_EN || 'en-IN-NeerjaNeural',
  hi: process.env.DADI_VOICE_HI || 'hi-IN-SwaraNeural',
};
const esc = s => s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
/** Each sentence gets its own lift: a greeting or an exclamation brighter, a question rising, an instruction calm and clear. */
export function ssml(text, lang, mood) {
  const voice = lang === 'hi' ? VOICES.hi : VOICES.en, xl = lang === 'hi' ? 'hi-IN' : 'en-IN', hype = mood === 'excited';
  const parts = text.match(/[^.!?।]+[.!?।]*\s*/g) || [text];
  const body = parts.map((p, i) => {
    const s = p.trim(); if (!s) return '';
    const bang = /!$/.test(s), ask = /\?$/.test(s), joy = hype && (bang || i === 0);
    // excited: the happy sentences jump up and quicken; the instruction after them settles back to calm and clear
    const pitch = joy ? (i === 0 ? '+18%' : '+14%') : bang ? '+8%' : ask ? '+6%' : i === 0 ? '+3%' : '+0%';
    const rate = joy ? '+10%' : bang ? '+4%' : ask ? '+0%' : '-4%';
    const range = joy ? ' range="+40%"' : '';
    return `<prosody pitch="${pitch}" rate="${rate}"${range}>${esc(s)}</prosody><break time="${joy ? 320 : bang || ask ? 260 : 200}ms"/>`;
  }).join('');
  // en-IN Neerja has speaking styles: cheerful normally, extra cheerful when excited; other voices just use the prosody above
  const inner = /Neerja/i.test(voice) ? `<mstts:express-as style="cheerful" styledegree="${hype ? 2 : 1.2}">${body}</mstts:express-as>` : body;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${xl}"><voice name="${voice}">${inner}</voice></speak>`;
}
/** POST /api/tts {text, lang} → audio/mpeg */
export async function tts(body) {
  if (!hasTts()) return { status: 503, json: { error: 'no_tts' } };
  const text = String(body?.text || '').slice(0, 600).trim(), lang = body?.lang === 'hi' ? 'hi' : 'en', mood = body?.mood === 'excited' ? 'excited' : 'warm';
  if (!text) return { status: 400, json: { error: 'no_text' } };
  try {
    const r = await fetch(`https://${process.env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': process.env.AZURE_SPEECH_KEY, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3', 'User-Agent': 'dadis-map' },
      body: ssml(text, lang, mood),
    });
    if (!r.ok) { console.error('[dadi tts]', r.status, await r.text().catch(() => '')); return { status: 502, json: { error: 'tts_failed' } }; }
    return { status: 200, audio: Buffer.from(await r.arrayBuffer()) };
  } catch (e) { console.error('[dadi tts]', e); return { status: 502, json: { error: 'tts_failed' } }; }
}

/** Connect-style middleware: POST /api/recognise, POST /api/prompt, POST /api/tts, GET /api/health */
export function apiMiddleware() {
  return async (req, res, next) => {
    const url = (req.url || '').split('?')[0];
    if (!url.startsWith('/api/')) return next();
    const send = (status, json) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(json)); };
    if (url === '/api/health') return send(200, { ai: hasCredentials(), model: MODEL, tts: hasTts() });
    if (req.method !== 'POST') return send(405, { error: 'method' });
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 12e6) return send(413, { error: 'too_big' }); }
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch { return send(400, { error: 'bad_json' }); }
    if (url === '/api/tts') {
      const r = await tts(body);
      if (!r.audio) return send(r.status, r.json);
      res.statusCode = 200; res.setHeader('content-type', 'audio/mpeg'); res.setHeader('cache-control', 'public, max-age=31536000, immutable'); return res.end(r.audio);
    }
    const r = url === '/api/recognise' ? await recognise(body) : url === '/api/prompt' ? await makePrompt(body) : { status: 404, json: { error: 'not_found' } };
    send(r.status, r.json);
  };
}
