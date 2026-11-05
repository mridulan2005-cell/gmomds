// English / Hindi. Text is written in English in the code and looked up here for Hindi (English stays the fallback).
import { Fragment, createElement, type ReactNode } from 'react';
import type { AppState } from './types';
import { PROMPTS_HI } from './i18n-prompts';
import { useApp } from './store';

export type Lang = 'en' | 'hi';
/** The two languages on offer: [as written in it, in English, code]. */
export const LANG_OPTIONS: [string, string, Lang][] = [['English', 'English', 'en'], ['हिन्दी', 'Hindi', 'hi']];
export const langOf = (s: Pick<AppState, 'lang'>): Lang => (s.lang === 'Hindi' ? 'hi' : 'en');

const UI: Record<string, string> = {
  // the language step
  'Before we begin · {n} of {total}': 'शुरू करने से पहले · {n}/{total}',
  'Which language are you comfortable in?': 'आप किस भाषा में सहज हैं?',
  'You can both change this later.': 'आप इसे बाद में भी बदल सकते हैं।',
  'Next': 'आगे',
  // onboarding
  'Hi!': 'नमस्ते!',
  "What's your name?": 'आपका नाम क्या है?',
  "{role}, what's your name?": '{role}, आपका नाम क्या है?',
  'Your name': 'आपका नाम',
  'Listening…': 'सुन रहे हैं…',
  "Couldn't hear that. Try again or type it.": 'सुनाई नहीं दिया। फिर से बोलिए या लिख दीजिए।',
  'Say your name…': 'अपना नाम बोलिए…',
  'Type it, or tap the mic and say it': 'लिखिए, या माइक दबाकर बोलिए',
  '{name}, who are you playing with?': '{name}, आप किसके साथ खेल रहे हैं?',
  '{name}, what do you love?': '{name}, आपको क्या पसंद है?',
  "That's who": 'यही हैं',
  "That's me": 'हाँ, यही',
  "That's {name}!": 'यह रहा {name}!',
  'Start our map': 'हमारा नक्शा शुरू करें',
  'Grandmother': 'दादी', 'Grandfather': 'दादा', 'Mom': 'मम्मी', 'Dad': 'पापा',
  'Animals': 'जानवर', 'Birds': 'पक्षी', 'Sky': 'आसमान', 'Sea': 'समुद्र', 'Snow': 'बर्फ़', 'Garden': 'बगीचा',
  'Stories': 'कहानियाँ', 'Family': 'परिवार', 'Friends': 'दोस्त', 'Food': 'खाना', 'God': 'भगवान', 'Music': 'संगीत',
  '{by}, draw {subj}!': '{by}, {subj} का चित्र बनाइए!',
  'Make it silly. Little {subj} will walk around all your maps.': 'मज़ेदार बनाइए। नन्हा-सा {subj} आपके सारे नक्शों में घूमेगा।',
  'Pencil': 'पेंसिल', 'Eraser': 'रबर', 'Start over': 'फिर से शुरू',
  'by {by}': '{by} ने बनाया',
  // how it works
  'How it works': 'यह कैसे चलता है',
  'Daily prompt, together': 'रोज़ का डूडल, साथ-साथ',
  'Every day you both get the same prompt. Draw it side by side.': 'हर दिन आप दोनों को एक ही विषय मिलेगा। साथ बैठकर बनाइए।',
  'Your drawings come alive': 'आपके चित्र जी उठते हैं',
  'Scan them in and watch them move on your map.': 'उन्हें स्कैन कीजिए और नक्शे पर चलते हुए देखिए।',
  'Finish maps, walk around!': 'नक्शे पूरे कीजिए, घूमिए!',
  'A few days build a place. Fill whole maps, then walk around inside them.': 'कुछ दिनों में एक जगह बनती है। पूरे नक्शे भरिए, फिर उनके अंदर घूमिए।',
  "Let's draw": 'चलो बनाएँ',
  // today's doodle
  "Today's doodle": 'आज का डूडल',
  'Map': 'नक्शा', 'Scrapbook': 'स्क्रैपबुक', 'All maps': 'सारे नक्शे', 'Settings': 'सेटिंग्स',
  'All drawn!': 'सब बन गया!',
  '{n} pairs!': '{n} जोड़ी!',
  'Our place is ready.': 'हमारी जगह तैयार है।',
  'See what we made': 'देखें हमने क्या बनाया',
  'All done for today': 'आज का काम पूरा',
  'Next prompt in': 'अगला डूडल आएगा',
  'Day': 'दिन',
  '??? · prompt {n} of {total}': '??? · डूडल {n}/{total}',
  "{name}'s turn": '{name} की बारी',
  "We're done!": 'हो गया!',
  'Finding today’s prompt…': 'आज का डूडल ढूँढ रहे हैं…',
  'One more to go': 'बस एक और',
  'Walk to the pin on the map to unlock it': 'इसे खोलने के लिए नक्शे पर पिन तक चलिए',
  'Go to the map': 'नक्शे पर चलें',
  'Colour the door brown. It has to be the darkest colour in your drawing.': 'दरवाज़े को भूरे रंग से रंगिए। यह आपके चित्र का सबसे गहरा रंग होना चाहिए।',
  'Language': 'भाषा',
  // scanning
  'Looking for the door…': 'दरवाज़ा ढूँढ रहे हैं…',
  'Scanning. Keep it still.': 'स्कैन हो रहा है। हिलाइए मत।',
  'Door found! It’s the darkest colour.': 'दरवाज़ा मिल गया! यह सबसे गहरा रंग है।',
  'Scanned! We’ll put a door in the middle.': 'स्कैन हो गया! हम बीच में दरवाज़ा लगा देंगे।',
  "It's scanned!": 'स्कैन हो गया!',
  'That came out a bit blurry': 'तस्वीर थोड़ी धुंधली आई',
  "We couldn't see a drawing": 'हमें कोई चित्र नहीं दिखा',
  'That looks like more than a drawing': 'इसमें चित्र के अलावा भी कुछ दिख रहा है',
  'Let’s try that again': 'चलो फिर से कोशिश करें',
  'Put your dream house on the tray': 'अपने सपनों का घर ट्रे पर रखिए',
  'Put your drawing on the tray': 'अपना चित्र ट्रे पर रखिए',
  "Put {name}'s drawing on the tray": '{name} का चित्र ट्रे पर रखिए',
  'Opening the camera…': 'कैमरा खुल रहा है…',
  'Hands away from the paper': 'कागज़ से हाथ हटाइए',
  'Hold still…': 'स्थिर रखिए…',
  'Found the paper': 'कागज़ मिल गया',
  'Paper goes here': 'कागज़ यहाँ रखिए',
  '🎤 Say “take”': '🎤 “take” बोलिए',
  'Together': 'साथ में',
  'Looks like': 'लगता है यह है',
  'Not quite?': 'सही नहीं?',
  "The camera isn't available here. You can take or choose a photo of the drawing instead.": 'यहाँ कैमरा नहीं चल रहा। आप चित्र की फ़ोटो खींच या चुन सकते हैं।',
  'Hold the tablet still and try again.': 'टैबलेट को स्थिर रखिए और फिर से कोशिश कीजिए।',
  'We found the paper but no pencil marks on it. Make sure the drawing faces the camera, or press a little harder with the pencil, and try again.': 'कागज़ तो मिला, पर उस पर पेंसिल के निशान नहीं दिखे। चित्र कैमरे की तरफ़ रखिए, या पेंसिल थोड़ा दबाकर चलाइए, और फिर से कोशिश कीजिए।',
  'Hold the paper so it fills most of the picture, with nothing else in front of it, and try again.': 'कागज़ ऐसे पकड़िए कि वह तस्वीर का ज़्यादातर हिस्सा भर दे और सामने कुछ और न हो, फिर से कोशिश कीजिए।',
  'Something went wrong while scanning. Please try again.': 'स्कैन करते समय कुछ गड़बड़ हो गई। कृपया फिर से कोशिश कीजिए।',
  'Scanning…': 'स्कैन हो रहा है…',
  'Take': 'खींचें',
  'Choose a photo': 'फ़ोटो चुनें',
  'Try again': 'फिर से कोशिश करें',
  "See today's sketches": 'आज के चित्र देखें',
  "Now {name}'s turn": 'अब {name} की बारी',
  'Retake': 'फिर से लें',
  'Use a photo': 'फ़ोटो से',
  'Save this photo': 'यह फ़ोटो सहेजें',
  'Flip': 'पलटें',
  'Door': 'दरवाज़ा',
  'Door goes here': 'दरवाज़ा यहाँ',
  'Is it {label}?': 'क्या यह {label} है?',
  'What did you draw?': 'आपने क्या बनाया?',
  'Or tap the right one, and it will move the right way on the map.': 'या सही वाला छुइए, फिर यह नक्शे पर सही तरह से चलेगा।',
  'Tap the right one, and it will move the right way on the map.': 'सही वाला छुइए, फिर यह नक्शे पर सही तरह से चलेगा।',
  'Something else:': 'कुछ और:',
  "That's it": 'यही है',
  'Keep “{label}”': '“{label}” ही रखें',
  // today's sketches
  "TODAY'S": 'आज के',
  'SKETCHES': 'चित्र',
  'Show on map': 'नक्शे पर दिखाएँ',
  // the maps
  'All our maps': 'हमारे सारे नक्शे',
  'Our map': 'हमारा नक्शा',
  'Scroll or drag to look through · tap a map to go inside': 'खिसकाकर देखिए · अंदर जाने के लिए किसी नक्शे को छुइए',
  'Tap the map to go inside': 'अंदर जाने के लिए नक्शे को छुइए',
  'Next up: {name}': 'अगला: {name}',
  '{w} place to build · tap Today’s doodle to begin': '{n} जगह बनानी है · शुरू करने के लिए आज का डूडल दबाइए',
  '{w} places to build · tap Today’s doodle to begin': '{n} जगहें बनानी हैं · शुरू करने के लिए आज का डूडल दबाइए',
  'Press Play and follow the light to the pin': 'खेलें दबाइए और रोशनी के पीछे-पीछे पिन तक चलिए',
  ' · in progress': ' · बन रहा है',
  'Drag to move around · two fingers to turn · tap a room to visit it': 'घूमने के लिए खींचिए · मोड़ने के लिए दो उँगलियाँ · अंदर जाने के लिए किसी कमरे को छुइए',
  'Drag to move around · two fingers to turn · tap a place to visit it': 'घूमने के लिए खींचिए · मोड़ने के लिए दो उँगलियाँ · अंदर जाने के लिए किसी जगह को छुइए',
  'Next up in {name} · tap Today’s doodle to begin': 'आगे {name} में · शुरू करने के लिए आज का डूडल दबाइए',
  'Drag to move around · two fingers to turn': 'घूमने के लिए खींचिए · मोड़ने के लिए दो उँगलियाँ',
  'The last drawing goes in…': 'आख़िरी चित्र लग रहा है…',
  'Cross the bridge': 'पुल पार करें',
  'On to our next map': 'अगले नक्शे पर चलें',
  'See our map': 'हमारा नक्शा देखें',
  'On to the next place': 'अगली जगह पर चलें',
  'Built!': 'बन गया!',
  'Complete!': 'पूरा हुआ!',
  'Play': 'खेलें',
  'Exit': 'बाहर',
  'Follow the light to the pin!': 'रोशनी के पीछे-पीछे पिन तक चलिए!',
  'Joystick to walk · drag to look around': 'चलने के लिए जॉयस्टिक · देखने के लिए खींचिए',
  'Tap a drawing, a flower, {a} or {b}': 'किसी चित्र, फूल, {a} या {b} को छुइए',
  'Last prompt': 'आख़िरी डूडल',
  'Let’s draw it': 'चलो बनाएँ',
  'Keep exploring': 'घूमते रहें',
  'In our scrapbook': 'हमारी स्क्रैपबुक में',
  'Look inside': 'अंदर देखें',
  'Put the roof back': 'छत वापस लगाएँ',
  '{n} more prompt until you unlock this!': 'बस {n} और डूडल, फिर यह खुलेगा!',
  '{n} more prompts until you unlock this!': 'बस {n} और डूडल, फिर यह खुलेगा!',
  // on the 3D map
  'This week · {n} to go': 'इस हफ़्ते · {n} बाकी',
  'Door found!': 'दरवाज़ा मिल गया!',
  'Walk closer!': 'थोड़ा पास आइए!',
  'Hi there!': 'नमस्ते!',
  'Mmm, flowers!': 'वाह, फूल!',
  'Hello!': 'नमस्ते!',
  'Meow!': 'म्याऊँ!', 'Tweet tweet!': 'चीं चीं!', 'Splash!': 'छपाक!', 'Yum, a mango!': 'वाह, आम!', 'Mmm, smells lovely!': 'वाह, क्या ख़ुशबू है!',
  'What a big tree!': 'कितना बड़ा पेड़!', 'So warm!': 'कितनी गरमाहट!', 'Hello, moon!': 'नमस्ते, चंदा मामा!', 'So bright!': 'कितना उजाला!',
  'Up it goes!': 'ऊपर, और ऊपर!', 'Ding ding!': 'टन टन!', 'Dum dum!': 'ढम ढम!', 'La la la!': 'ला ला ला!', 'Ahoy!': 'अरे वाह!', 'Whoosh!': 'सर्र!', 'Mmm, chai!': 'वाह, चाय!',
  // the scrapbook
  'Day {n}': 'दिन {n}',
  'Days {a}–{b}': 'दिन {a}–{b}',
  ' · Together day': ' · साथ वाला दिन',
  'Part {n} of {total}': 'भाग {n}/{total}',
  'First map': 'पहला नक्शा',
  'Previous page': 'पिछला पन्ना', 'Next page': 'अगला पन्ना',
  // the mute button
  'Mute the voice': 'आवाज़ बंद करें', 'Turn the voice on': 'आवाज़ चालू करें',

  // ---- what the voice says on each screen ----
  'Namaste! Which language are you comfortable in? Pick one, then tap Next.': 'नमस्ते! आप किस भाषा में सहज हैं? एक भाषा चुनिए, फिर आगे दबाइए।',
  "Hi! What's your name? Type it, or tap the mic and say it.": 'नमस्ते! आपका नाम क्या है? लिखिए, या माइक दबाकर बोलिए।',
  "Namaste, {role}! What's your name? Type it, or tap the mic and say it.": 'नमस्ते {role}! आपका नाम क्या है? लिखिए, या माइक दबाकर बोलिए।',
  "{name}, what do you love? Tap everything you like, then tap That's me.": '{name}, आपको क्या-क्या पसंद है? जो भी अच्छा लगे उसे छुइए, फिर हाँ, यही दबाइए।',
  "{name}, who are you playing with? Pick one, then tap That's who.": '{name}, आप किसके साथ खेल रहे हैं? एक चुनिए, फिर यही हैं दबाइए।',
  "{by}, now draw {subj}! Make it silly. When you're done, tap the orange button.": '{by}, अब {subj} का चित्र बनाइए! मज़ेदार बनाइए। हो जाए तो नारंगी बटन दबाइए।',
  "Here's how it works. Every day you both get the same doodle, and draw it side by side. Scan your drawings and watch them come alive on your map. Finish maps, then walk around inside them. Tap Let's draw to begin.":
    'देखिए यह कैसे चलता है। हर दिन आप दोनों को एक ही डूडल मिलेगा, उसे साथ बैठकर बनाइए। अपने चित्र स्कैन कीजिए और उन्हें नक्शे पर जी उठते देखिए। नक्शे पूरे कीजिए, फिर उनके अंदर घूमिए। शुरू करने के लिए चलो बनाएँ दबाइए।',
  "Today's doodle: {prompt}. Draw it on paper, each on your own sheet. When you're both done, tap We're done.": 'आज का डूडल: {prompt}। अपने-अपने कागज़ पर बनाइए। आप दोनों का हो जाए, तो हो गया दबाइए।',
  "Today you draw together, on one sheet: {prompt}. When you're done, tap We're done.": 'आज आप दोनों मिलकर एक ही कागज़ पर बनाइए: {prompt}। हो जाए, तो हो गया दबाइए।',
  "{name}, it's your turn. Tap {name}'s turn to scan your drawing.": '{name}, अब आपकी बारी। अपना चित्र स्कैन करने के लिए {name} की बारी दबाइए।',
  'All done for today! Come back tomorrow for the next doodle.': 'आज का काम पूरा! अगले डूडल के लिए कल फिर आइए।',
  'Your place is ready! Tap See what we made.': 'आपकी जगह तैयार है! देखें हमने क्या बनाया दबाइए।',
  'One more to go! Go to the map, press Play, and walk to the red pin to unlock it.': 'बस एक और! नक्शे पर जाइए, खेलें दबाइए, और लाल पिन तक चलिए, वह खुल जाएगा।',
  "Put {name}'s drawing on the tray and keep it still. Then tap Take.": '{name} का चित्र ट्रे पर रखिए और हिलाइए मत। फिर खींचें दबाइए।',
  'Put your drawing on the tray and keep it still. Then tap Take.': 'अपना चित्र ट्रे पर रखिए और हिलाइए मत। फिर खींचें दबाइए।',
  'Put your dream house on the tray and keep it still. Then tap Take.': 'अपने सपनों के घर का चित्र ट्रे पर रखिए और हिलाइए मत। फिर खींचें दबाइए।',
  "It's scanned! Tap the orange button to go on.": 'स्कैन हो गया! आगे बढ़ने के लिए नारंगी बटन दबाइए।',
  "Let's try that again. Tap Try again.": 'चलो फिर से कोशिश करें। फिर से कोशिश करें दबाइए।',
  "Here are today's sketches! Tap Show on map to see them come alive.": 'ये रहे आज के चित्र! इन्हें जी उठते देखने के लिए नक्शे पर दिखाएँ दबाइए।',
  'Here are all your maps. Tap a map to go inside.': 'ये रहे आपके सारे नक्शे। अंदर जाने के लिए किसी नक्शे को छुइए।',
  "Next up: {name}! Tap Today's doodle to begin.": 'अगला: {name}! शुरू करने के लिए आज का डूडल दबाइए।',
  'Your map has come alive! Press Play and follow the light to the red pin.': 'आपका नक्शा जी उठा है! खेलें दबाइए और रोशनी के पीछे-पीछे लाल पिन तक चलिए।',
  'Here is {name}. Drag to look around, or press Play to walk inside.': 'यह रहा {name}। देखने के लिए खींचिए, या अंदर घूमने के लिए खेलें दबाइए।',
  "Next up in {name}. Tap Today's doodle to begin.": 'आगे {name} में। शुरू करने के लिए आज का डूडल दबाइए।',
  '{name}: complete! Tap the orange button to go on.': '{name} पूरा हुआ! आगे बढ़ने के लिए नारंगी बटन दबाइए।',
  '{name}: built! Tap the orange button to go on.': '{name} बन गया! आगे बढ़ने के लिए नारंगी बटन दबाइए।',
  "You found the pin! Build a bridge to go to your next map. Tap Let's draw it.": 'आपको पिन मिल गया! अपने अगले नक्शे तक जाने के लिए एक पुल बनाइए। चलो बनाएँ दबाइए।',
  'Use the joystick to walk around. Tap a drawing, a flower, {a} or {b} to say hello.': 'घूमने के लिए जॉयस्टिक चलाइए। नमस्ते कहने के लिए किसी चित्र, फूल, {a} या {b} को छुइए।',
  'Follow the light to the red pin.': 'रोशनी के पीछे-पीछे लाल पिन तक चलिए।',
  'This is your scrapbook. Swipe, or tap the arrows, to turn the pages.': 'यह आपकी स्क्रैपबुक है। पन्ने पलटने के लिए खिसकाइए, या तीर दबाइए।',
};

/** Names of maps and places. */
const NAMES: Record<string, string> = {
  'Welcome Party': 'स्वागत पार्टी', 'Dream House': 'सपनों का घर', 'Living Room': 'बैठक', 'Kitchen': 'रसोई', 'Park': 'पार्क', 'Bridge': 'पुल',
  'The Town': 'शहर', 'The River': 'नदी', 'The Garden': 'बगीचा', 'The Market': 'बाज़ार', 'The Rooftop': 'छत',
  'The Hillside': 'पहाड़ी', 'The Stream': 'धारा', 'The Tea Garden': 'चाय बागान', 'The Village Fair': 'गाँव का मेला', 'The Hilltop': 'पहाड़ की चोटी',
  'The Animal Sanctuary': 'पशु अभयारण्य', 'The Watering Hole': 'पानी का गड्ढा', 'The Grassland': 'घास का मैदान', 'The Fruit Grove': 'फलों का बाग', 'The Treetops': 'पेड़ों की फुनगियाँ',
  'The City': 'नगर', 'The Canal': 'नहर', 'The Park': 'पार्क', 'The Bazaar': 'बाज़ार', 'The Terrace': 'छत',
  'The Seaside': 'समुद्र तट', 'The Beach': 'समुद्र किनारा', 'The Coconut Grove': 'नारियल का बाग', 'The Fish Market': 'मछली बाज़ार', 'The Lighthouse': 'प्रकाशस्तंभ',
  'The Forest': 'जंगल', 'The Waterfall': 'झरना', 'The Clearing': 'खुला मैदान', 'The Berry Patch': 'बेर की झाड़ियाँ', 'The Treehouse': 'पेड़ वाला घर',
  'The Village': 'गाँव', 'The Pond': 'तालाब', 'The Courtyard': 'आँगन', 'The Kitchen': 'रसोई', 'The Balcony': 'बालकनी',
  'The Desert': 'रेगिस्तान', 'The Oasis': 'नख़लिस्तान', 'The Cactus Garden': 'कैक्टस बगीचा', 'The Camel Fair': 'ऊँट मेला', 'The Dunes': 'रेत के टीले',
};

/** The little notes as a place builds up, in the same order as BUILD_NOTES / ROOM_NOTES. */
export const NOTES_HI: Record<string, string[]> = {
  river: ['अरे, नदी की राह खुद गई! बनाते रहिए, देखें इसमें क्या भरता है।', 'पानी धीरे-धीरे आ रहा है! बहाव शुरू करने के लिए बनाते रहिए।', 'नदी बहने लगी है! किनारों पर सरकंडे उग रहे हैं।', 'नदी बह रही है! कमल के पत्ते और एक छोटा-सा पुल आ गया।'],
  garden: ['अरे, क्यारियाँ खुद गईं! बनाते रहिए, देखें क्या उगता है।', 'नन्हे अंकुर निकल रहे हैं! ये क्या बनेंगे?', 'पेड़ और झाड़ियाँ उग आईं! कुछ खिलने वाला है…', 'फूल खिल गए! कितनी सुंदर जगह बनाई आपने।'],
  market: ['अरे, लकड़ी के खंभे लग रहे हैं! बनाते रहिए, देखें इन पर क्या आता है।', 'रंग-बिरंगे छप्पर लग गए! कोई दुकान सजा रहा है…', 'फल और टोकरियाँ आ रही हैं! चहल-पहल बढ़ रही है।', 'झंडियाँ और लालटेनें लग गईं! सब तैयार है।'],
  rooftop: ['अरे, छत पर खपरैल बिछ गई! बनाते रहिए, देखें ऊपर क्या है।', 'पानी की टंकी और पौधों के गमले! बनाते रहिए…', 'कपड़े सुखाने की रस्सी और एक पतंग! ऊपर हवा चल रही है।', 'झिलमिल बत्तियाँ और तारे निकल आए! क्या रात है।'],
  lr: ['लकड़ी का फ़र्श, सोफ़ा, दरी और लैंप! बैठक बनने लगी है।', 'एक खिड़की! आपका पालतू खिड़की पर बैठा है।', 'दीवार पर एक ताक, उस पर आपकी चीज़ें।', 'एक पौधा और एक तस्वीर। बैठक तैयार है!'],
  kitchen: ['टाइलें और चूल्हा! आपका खाना काउंटर पर रखा है।', 'रसोई की खिड़की से रोशनी आ रही है।', 'सब कुछ ठंडा रखने के लिए एक फ़्रिज।', 'खाने की मेज़, आपके पसंदीदा पकवानों से भरी!'],
  house: ['हमें दरवाज़ा मिल गया! आपके सपनों का घर कमरों के चारों ओर बन रहा है।'],
  park: ['पेड़, बेंच और तालाब। पार्क बढ़ रहा है!', 'खेलने के लिए फिसलपट्टी और झूला।', 'तितलियाँ, बत्ती का खंभा और हवा में उड़ती चीज़ें।', 'पार्क तैयार है! पूरा नक्शा जी उठा है।'],
  bridge: ['पिन से एक तैरते टापू तक पुल बन रहा है। वहाँ क्या होगा?'],
};

const fill = (s: string, v?: Record<string, string | number>) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m)) : s);

/** Text in the chosen language ({name}-style blanks filled in). */
export function tr(lang: Lang, en: string, v?: Record<string, string | number>): string {
  if (lang === 'en') return fill(en, v);
  return fill(UI[en] ?? NAMES[en] ?? PROMPTS_HI[en] ?? en, v);
}
/** A prompt's text: its own Hindi (made with it), else the curated translation, else English. */
export const promptIn = (lang: Lang, p: { text: string; hi?: string } | null | undefined) => (!p ? '' : lang === 'hi' ? p.hi || PROMPTS_HI[p.text] || p.text : p.text);
/** A note as a place builds up (theme or room, and which one). */
export const noteIn = (lang: Lang, key: string, i: number, en: string) => (lang === 'hi' ? NOTES_HI[key]?.[i] || en : en);

/** Like tr, with React pieces (coloured names) in the blanks. */
export function trx(lang: Lang, en: string, v: Record<string, ReactNode>): ReactNode {
  const s = lang === 'en' ? en : UI[en] ?? en;
  return createElement(Fragment, null, ...s.split(/(\{\w+\})/).map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return createElement(Fragment, { key: i }, m && m[1] in v ? v[m[1]] : part);
  }));
}

export interface T { (en: string, v?: Record<string, string | number>): string; x: (en: string, v: Record<string, ReactNode>) => ReactNode; lang: Lang }
/** The translator for the language they chose. */
export function useT(): T {
  const lang = langOf(useApp());
  const t = ((en: string, v?: Record<string, string | number>) => tr(lang, en, v)) as T;
  t.x = (en, v) => trx(lang, en, v); t.lang = lang;
  return t;
}
