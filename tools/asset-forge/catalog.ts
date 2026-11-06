/**
 * Everything generated with the OpenAI API, most important first, so a hit budget only loses the
 * least important art. To fit the $2 budget each call is a sheet, sliced into many sprites. Logos,
 * status suns, sky scenes, badges' lettering and stickers are drawn in code instead.
 */
export interface Sprite {
  id: string;
  alt: string;
}

export interface Sheet {
  id: string;
  prompt: string;
  size: '1024x1024' | '1536x1024' | '1024x1536';
  quality: 'medium' | 'medium' | 'high';
  transparent: boolean;
  /** Grid of sprites, left to right, top to bottom. Empty means the whole image is one asset. */
  cols: number;
  rows: number;
  sprites: Sprite[];
  /** Earlier sheet ids passed as reference images. */
  refs: string[];
  /** Longest side of the exported @2x file. */
  maxSide: number;
  /** A reference only, never shown in the app. */
  referenceOnly?: boolean;
}

const STYLE =
  'Risograph print illustration: two or three ink overprints with visible grain, halftone dots and slight misregistration, like a hand-printed training-camp zine. Inks only: dawn apricot #FFB37A, coral #FF6B5B, deep indigo #2B2A6B, sky teal #3FB8AF, on cream paper #FFF6E9. Flat shapes, bold friendly linework. Not a photograph. No real brands or logos.';

const ROLLO =
  'Rollo: a small, round, cheerful rooster coach. His comb is shaped like a little pulse wave. He wears a coach whistle on a lanyard and a terry-cloth sweatband. Warm, encouraging, a bit dramatic.';

const NO_TEXT = 'No text, letters or numbers anywhere.';

const grid = (cols: number, rows: number, list: string): string =>
  `A sprite sheet: exactly ${cols} columns by ${rows} rows on an invisible even grid. Each item sits fully inside its own cell, centred, with wide empty space around it. Nothing touches, overlaps or crosses a cell edge. No grid lines, no frames, no shadows between cells. Items in order, left to right, top to bottom: ${list}.`;

export const CATALOG: Sheet[] = [
  {
    id: 'rollo_sheet',
    prompt: `${STYLE} Character sheet of ${ROLLO} Four views in a row on plain cream: front, three-quarter, side, back. Same character in every view. ${NO_TEXT}`,
    size: '1536x1024',
    quality: 'medium',
    transparent: false,
    cols: 0,
    rows: 0,
    sprites: [{ id: 'rollo_sheet', alt: 'Character sheet of Rollo the rooster coach' }],
    refs: [],
    maxSide: 1024,
    referenceOnly: true,
  },
  {
    id: 'rollo_poses',
    prompt: `${STYLE} ${ROLLO} Keep him exactly like the reference. Transparent background. ${grid(
      4,
      3,
      'Rollo waving hello; Rollo blowing his whistle; Rollo holding a clipboard, ticking a box; Rollo pointing at a desk lamp; Rollo holding a phone at arm’s length; Rollo sitting very still with eyes closed; Rollo with a wing tip to his beak, saying shh; Rollo celebrating with confetti; Rollo asleep on a pillow; Rollo stretching; Rollo holding a steaming mug; Rollo sprinting',
    )} ${NO_TEXT}`,
    size: '1536x1024',
    quality: 'medium',
    transparent: true,
    cols: 4,
    rows: 3,
    sprites: [
      { id: 'rollo_wave', alt: 'Rollo waving hello' },
      { id: 'rollo_whistle', alt: 'Rollo blowing his whistle' },
      { id: 'rollo_clipboard', alt: 'Rollo ticking a clipboard' },
      { id: 'rollo_lamp', alt: 'Rollo pointing at a desk lamp' },
      { id: 'rollo_phone', alt: 'Rollo holding a phone at arm’s length' },
      { id: 'rollo_still', alt: 'Rollo sitting still with his eyes closed' },
      { id: 'rollo_shh', alt: 'Rollo asking for quiet' },
      { id: 'rollo_celebrate', alt: 'Rollo celebrating with confetti' },
      { id: 'rollo_asleep', alt: 'Rollo asleep on a pillow' },
      { id: 'rollo_stretch', alt: 'Rollo stretching' },
      { id: 'rollo_mug', alt: 'Rollo holding a steaming mug' },
      { id: 'rollo_sprint', alt: 'Rollo sprinting' },
    ],
    refs: ['rollo_sheet'],
    maxSide: 640,
  },
  {
    id: 'avatars',
    prompt: `${STYLE} Portrait busts of twelve different fictional adult athletes in the same riso style, each inside a soft circle of colour, clearly illustrated and never photographic. Transparent background outside the circles. ${grid(
      4,
      3,
      'Amara, a Black woman in her 30s, marathon runner; Kasun, a Sri Lankan man in his 20s, cyclist; Noor, an Arab woman in her 30s wearing a hijab, powerlifter; Diego, a Latino man in his 40s, triathlete; Mei, a Chinese woman in her 20s, swimmer; Tomasz, a white man in his 50s with a grey beard, rower; Priya, an Indian woman in her 30s, climber; Jonah, a Black man in his 20s, footballer; Freya, a white woman in her 50s with short grey hair, runner; Hana, a Japanese woman in her 40s, triathlete; Sione, a Pacific Islander man in his 30s, weightlifter; Elif, a Turkish woman in her 20s, cyclist',
    )} ${NO_TEXT}`,
    size: '1536x1024',
    quality: 'medium',
    transparent: true,
    cols: 4,
    rows: 3,
    sprites: [
      'amara',
      'kasun',
      'noor',
      'diego',
      'mei',
      'tomasz',
      'priya',
      'jonah',
      'freya',
      'hana',
      'sione',
      'elif',
    ].map((n) => ({
      id: `avatar_${n}`,
      alt: `Illustrated portrait of ${n[0]!.toUpperCase()}${n.slice(1)}, a fictional athlete`,
    })),
    refs: [],
    maxSide: 320,
  },
  {
    id: 'rollo_feel',
    prompt: `${STYLE} ${ROLLO} Keep him exactly like the reference. Transparent background. ${grid(
      3,
      2,
      'Rollo’s face looking wrecked and flattened; Rollo’s face tired, with droopy eyes; Rollo’s face okay, a small neutral smile; Rollo’s face good, a big smile; Rollo’s face flying high with joy, little wings out; Rollo looking puzzled with a tangled whistle and lanyard',
    )} ${NO_TEXT}`,
    size: '1536x1024',
    quality: 'medium',
    transparent: true,
    cols: 3,
    rows: 2,
    sprites: [
      { id: 'feel_1', alt: 'Rollo looking wrecked' },
      { id: 'feel_2', alt: 'Rollo looking tired' },
      { id: 'feel_3', alt: 'Rollo looking okay' },
      { id: 'feel_4', alt: 'Rollo looking good' },
      { id: 'feel_5', alt: 'Rollo flying with joy' },
      { id: 'rollo_offline', alt: 'Rollo with a tangled whistle' },
    ],
    refs: ['rollo_sheet'],
    maxSide: 480,
  },
  {
    id: 'hero',
    prompt: `${STYLE} Wide landing-page scene: first light over an empty running track, a huge halftone sun rising, and the horizon line itself is a heartbeat pulse wave. ${ROLLO} He is crowing on a fence post in the foreground, small in the frame, matching the reference. ${NO_TEXT}`,
    size: '1536x1024',
    quality: 'medium',
    transparent: false,
    cols: 0,
    rows: 0,
    sprites: [{ id: 'hero', alt: 'Rollo crowing on a fence post as the sun rises over a running track' }],
    refs: ['rollo_sheet'],
    maxSide: 1536,
  },
  {
    id: 'guide',
    prompt: `${STYLE} ${ROLLO} Keep him exactly like the reference. Small illustrated vignettes for an app. Transparent background. ${grid(
      3,
      2,
      'a phone propped against a water bottle on a table; a person seated with face and upper chest in a phone frame; a desk lamp lighting a seated person from the front; a person sitting calmly with a small stopwatch; Rollo looking at an empty clipboard; Rollo napping happily beside a row of small rising suns',
    )} ${NO_TEXT}`,
    size: '1536x1024',
    quality: 'medium',
    transparent: true,
    cols: 3,
    rows: 2,
    sprites: [
      { id: 'onboard_prop', alt: 'A phone propped up on a table' },
      { id: 'onboard_frame', alt: 'A person with their face and upper chest in view' },
      { id: 'onboard_light', alt: 'A lamp lighting a person from the front' },
      { id: 'onboard_still', alt: 'A person sitting calmly' },
      { id: 'empty_athletes', alt: 'Rollo with an empty clipboard' },
      { id: 'empty_done', alt: 'Rollo napping beside a row of rising suns' },
    ],
    refs: ['rollo_sheet'],
    maxSide: 560,
  },
  {
    id: 'how',
    prompt: `${STYLE} Four square illustrations for a landing page. Transparent background. ${grid(
      2,
      2,
      'a fictional athlete sitting on a bench at dawn, looking at a propped phone; a coach at a laptop looking at a row of small sun icons; a coach’s hand pressing send on a phone, a paper plane flying into the sunrise; a padlock whose body is a sun and whose shackle is a pulse wave',
    )} ${NO_TEXT}`,
    size: '1024x1024',
    quality: 'medium',
    transparent: true,
    cols: 2,
    rows: 2,
    sprites: [
      { id: 'how_athlete', alt: 'An athlete checking in on a propped phone at dawn' },
      { id: 'how_coach', alt: 'A coach looking at a row of suns on a laptop' },
      { id: 'how_send', alt: 'A coach pressing send, a paper plane flying into the sunrise' },
      { id: 'how_privacy', alt: 'A padlock made from a sun and a pulse wave' },
    ],
    refs: [],
    maxSide: 512,
  },
  {
    id: 'sports',
    prompt: `${STYLE} Eight simple bold sport icons in one matching style, indigo with one coral accent. Transparent background. ${grid(
      4,
      2,
      'running shoe; bicycle; swimmer in waves; triathlon: shoe, bicycle wheel and wave together; barbell; rowing oars; football; climbing carabiner',
    )} ${NO_TEXT}`,
    size: '1536x1024',
    quality: 'medium',
    transparent: true,
    cols: 4,
    rows: 2,
    sprites: ['running', 'cycling', 'swimming', 'triathlon', 'lifting', 'rowing', 'football', 'climbing'].map(
      (s) => ({ id: `sport_${s}`, alt: `${s} icon` }),
    ),
    refs: [],
    maxSide: 160,
  },
  {
    id: 'badges',
    prompt: `${STYLE} Six enamel pin badges, each a small sun rising over a heartbeat line, growing grander from the first to the last. Leave the middle of each pin plain, because a number is added later. Transparent background. ${grid(
      3,
      2,
      'tiny plain sun pin; small sun pin with short rays; sun pin with a laurel; bright sun pin with long rays; golden sun pin with laurel and stars; grand radiant sun pin with a crown of rays',
    )} ${NO_TEXT}`,
    size: '1536x1024',
    quality: 'medium',
    transparent: true,
    cols: 3,
    rows: 2,
    sprites: [3, 7, 14, 30, 60, 100].map((n) => ({ id: `badge_${n}`, alt: `${n} sunrises badge` })),
    refs: [],
    maxSide: 240,
  },
  {
    id: 'rollo_wave_frames',
    prompt: `${STYLE} ${ROLLO} Keep him exactly like the reference. Six animation frames of one waving loop. Rollo stays in the same place and size in every frame; only his raised wing moves, from low to high and back. Transparent background. ${grid(3, 2, 'wing low; wing rising; wing high; wing higher, tilted out; wing high; wing rising')} ${NO_TEXT}`,
    size: '1536x1024',
    quality: 'medium',
    transparent: true,
    cols: 3,
    rows: 2,
    sprites: [1, 2, 3, 4, 5, 6].map((n) => ({ id: `wave_f${n}`, alt: '' })),
    refs: ['rollo_sheet'],
    maxSide: 320,
  },
];
