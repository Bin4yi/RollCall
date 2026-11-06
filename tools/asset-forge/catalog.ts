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
    id: 'logo',
    prompt: `${STYLE} A logo wordmark reading exactly "ROLL CALL" in chunky, rounded, friendly indigo capital letters on one line. A coral sun rises from behind the first letter O of ROLL, and a thin heartbeat pulse line runs along the baseline as the horizon. Only those two words. Transparent background.`,
    size: '1536x1024',
    quality: 'medium',
    transparent: true,
    cols: 0,
    rows: 0,
    sprites: [{ id: 'logo_wordmark', alt: 'Roll Call' }],
    refs: [],
    maxSide: 1200,
  },
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
    prompt: `${STYLE} Portrait busts of twelve different fictional adult athletes in the same riso style, each inside a soft circle of colour, clearly illustrated and never photographic. Plain sports clothing with no stripes, logos or marks. Transparent background outside the circles. ${grid(
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
    prompt: `${STYLE} Four square illustrations for a landing page. Plain clothing with no stripes, logos or marks. Transparent background. ${grid(
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
  {
    id: 'legs_guide',
    prompt: `${STYLE} ${ROLLO} Keep him exactly like the reference. Transparent background. ${grid(
      4,
      3,
      'Rollo with wings on his hips, knees bent in a quick dip before jumping; Rollo high in the air, wings on hips, legs straight; Rollo landing with straight legs, wings on hips; a pair of simple footprints on a small floor mat, a place to stand; Rollo balancing on one leg, wings out a little; Rollo sitting with one leg up on a cushion, an ice pack on it, relaxed; Rollo counting on his wing feathers; Rollo putting a barbell down, pleased, the set is done; Rollo drinking from a water bottle, taking a break; Rollo tapping on a window pane from outside with one wing; a phone propped on a floor, a person facing it from the front, standing a few steps back; a phone propped on a floor, a person side-on to it, standing a few steps back',
    )} ${NO_TEXT}`,
    size: '1536x1024',
    quality: 'medium',
    transparent: true,
    cols: 4,
    rows: 3,
    sprites: [
      { id: 'jump_dip', alt: 'Rollo dipping with wings on hips' },
      { id: 'jump_air', alt: 'Rollo in the air with straight legs' },
      { id: 'jump_land', alt: 'Rollo landing with straight legs' },
      { id: 'floor_marker', alt: 'Footprints marking where to stand' },
      { id: 'balance_pose', alt: 'Rollo balancing on one leg' },
      { id: 'card_skip', alt: 'Rollo resting a leg on a cushion' },
      { id: 'rollo_count', alt: 'Rollo counting on his feathers' },
      { id: 'rollo_rack', alt: 'Rollo putting a barbell down' },
      { id: 'rollo_water', alt: 'Rollo drinking from a water bottle' },
      { id: 'nudge_window', alt: 'Rollo tapping on a window' },
      { id: 'camera_front', alt: 'A phone on the floor with a person facing it' },
      { id: 'camera_side', alt: 'A phone on the floor with a person side-on to it' },
    ],
    refs: ['rollo_sheet'],
    maxSide: 560,
  },
  {
    id: 'exercises',
    prompt: `${STYLE} Fifteen small exercise illustrations of the same fictional adult in plain clothes with no stripes, logos or marks, all at the same scale, each showing the lowest or hardest point of the movement. Transparent background. ${grid(
      5,
      3,
      'bodyweight squat from the front; bodyweight squat from the side; goblet squat holding a kettlebell from the front; goblet squat holding a kettlebell from the side; lunge from the front; lunge from the side; push-up from the front; push-up from the side; glute bridge lying on the back from the front; glute bridge lying on the back from the side; overhead press with dumbbells from the front; overhead press with dumbbells from the side; plank from the front; plank from the side; one kettlebell on its own',
    )} ${NO_TEXT}`,
    size: '1536x1024',
    quality: 'medium',
    transparent: true,
    cols: 5,
    rows: 3,
    sprites: [
      ...['squat', 'goblet', 'lunge', 'pushup', 'bridge', 'press', 'plank'].flatMap((e) =>
        ['front', 'side'].map((v) => ({ id: `ex_${e}_${v}`, alt: `${e} from the ${v}` })),
      ),
      { id: 'ex_kettlebell', alt: 'A kettlebell' },
    ],
    refs: [],
    maxSide: 300,
  },
  {
    id: 'emblems',
    prompt: `${STYLE} Twenty-four round team emblem badges in one matching style, each a bold simple symbol inside a circle with a thick indigo ring. Transparent background outside the circles. ${grid(
      6,
      4,
      'fox head; ocean wave; mountain peak; lantern; comet; pine tree; owl; otter; heron; bear; hare; stag; anchor; compass; acorn; fern; kite; sailing boat; rising sun; crescent moon; shooting star; beehive; lighthouse; wolf',
    )} ${NO_TEXT}`,
    size: '1536x1024',
    quality: 'medium',
    transparent: true,
    cols: 6,
    rows: 4,
    sprites: ['fox', 'wave', 'mountain', 'lantern', 'comet', 'pine', 'owl', 'otter', 'heron', 'bear', 'hare', 'stag', 'anchor', 'compass', 'acorn', 'fern', 'kite', 'sail', 'sun', 'moon', 'star', 'hive', 'light', 'wolf'].map(
      (n) => ({ id: `emblem_${n}`, alt: `${n} crew emblem` }),
    ),
    refs: [],
    maxSide: 200,
  },
  {
    id: 'map_tiles',
    prompt: `${STYLE} Nine small landscape symbols for a board-game map, seen from slightly above, each one compact and fitting inside a hexagon, with no ground plate or background. Transparent background. ${grid(
      3,
      3,
      'tufts of meadow grass with a few flowers; a cluster of pine trees; a bend of a river with small waves; a small round lake with reeds; a rounded grassy hill; a rocky mountain pass with two peaks; a sandy coast with a wave; a tall striped lighthouse; a tiny village of three houses',
    )} ${NO_TEXT}`,
    size: '1024x1024',
    quality: 'medium',
    transparent: true,
    cols: 3,
    rows: 3,
    sprites: ['meadow', 'forest', 'river', 'lake', 'hill', 'pass', 'coast', 'lighthouse', 'village'].map((k) => ({ id: `tile_${k}`, alt: `${k} tile` })),
    refs: [],
    maxSide: 200,
  },
  {
    id: 'season',
    prompt: `${STYLE} ${ROLLO} Keep him exactly like the reference. Transparent background. ${grid(
      4,
      3,
      'a small triangular flag on a pole; one soft round cloud of morning mist; a golden sun-shaped trophy cup; a league badge of a thin sun just under the horizon, mostly indigo; a league badge of a half-risen sun, coral; a league badge of a full high sun, apricot; a league badge of a big golden low sun with long rays; an empty decorative ribbon banner with nothing written on it; Rollo fast asleep on a hilltop, one wing holding a small flag; Rollo cheering with both wings up; Rollo pointing at a little folded map; Rollo with three small cheerful chicks in sweatbands beside him',
    )} ${NO_TEXT}`,
    size: '1536x1024',
    quality: 'medium',
    transparent: true,
    cols: 4,
    rows: 3,
    sprites: [
      { id: 'crew_flag', alt: 'A crew flag' },
      { id: 'fog_cloud', alt: 'A cloud of morning mist' },
      { id: 'trophy', alt: 'A golden sun cup' },
      { id: 'league_dawn', alt: 'Dawn league badge' },
      { id: 'league_morning', alt: 'Morning league badge' },
      { id: 'league_midday', alt: 'Midday league badge' },
      { id: 'league_golden', alt: 'Golden Hour league badge' },
      { id: 'banner_frame', alt: 'A ribbon banner' },
      { id: 'rollo_rested', alt: 'Rollo asleep on a hilltop holding a flag' },
      { id: 'rollo_cheer', alt: 'Rollo cheering' },
      { id: 'rollo_map', alt: 'Rollo pointing at a map' },
      { id: 'rollo_crew', alt: 'Rollo with three small chicks' },
    ],
    refs: ['rollo_sheet'],
    maxSide: 480,
  },
  {
    id: 'camp',
    prompt: `${STYLE} Six small farm buildings for a cosy game base, all seen from the same slightly raised angle at a matching scale, each on its own with no ground plate. Transparent background. ${grid(
      3,
      2,
      'a little wooden chicken coop; a raised vegetable patch with carrots; a tiny oval running track; a red barn; a windmill; a small striped lighthouse',
    )} ${NO_TEXT}`,
    size: '1536x1024',
    quality: 'medium',
    transparent: true,
    cols: 3,
    rows: 2,
    sprites: ['coop', 'patch', 'track', 'barn', 'windmill', 'lighthouse'].map((b) => ({ id: `camp_${b}`, alt: `${b} building` })),
    refs: [],
    maxSide: 420,
  },
  {
    id: 'valley_unlit',
    prompt: `${STYLE} Wide landing-page scene: a peaceful valley seen from a hilltop just before dawn, still dark and mostly deep indigo with muted teal. Rolling hills, a winding river, a pine forest, a small lake, a mountain pass, and a striped lighthouse on a far coast. The land is subtly divided into large soft hexagon patches. No people. ${NO_TEXT}`,
    size: '1536x1024',
    quality: 'medium',
    transparent: false,
    cols: 0,
    rows: 0,
    sprites: [{ id: 'valley_unlit', alt: 'A dark valley just before dawn' }],
    refs: [],
    maxSide: 1536,
  },
  {
    id: 'valley_lit',
    prompt: `${STYLE} This exact valley, same composition and every feature in the same place, now at sunrise: warm apricot and coral light floods the hexagon patches, the sky glows, and a big halftone sun sits low over the mountain pass. Keep the river, forest, lake and lighthouse exactly where they are. No people. ${NO_TEXT}`,
    size: '1536x1024',
    quality: 'medium',
    transparent: false,
    cols: 0,
    rows: 0,
    sprites: [{ id: 'valley_lit', alt: 'The same valley lit up by the sunrise' }],
    refs: ['valley_unlit'],
    maxSide: 1536,
  },
  {
    id: 'rollo_idle_frames',
    prompt: `${STYLE} ${ROLLO} Keep him exactly like the reference. Six animation frames of a gentle idle loop, for a small farm scene. Rollo stays in the same place and size in every frame, standing with his feet still; only his chest, head and tail move slightly as he breathes, looks about and blinks. Transparent background. ${grid(3, 2, 'looking ahead; chest rising; chest high, tail lifted; head turned a little; blinking; chest falling')} ${NO_TEXT}`,
    size: '1536x1024',
    quality: 'medium',
    transparent: true,
    cols: 3,
    rows: 2,
    sprites: [1, 2, 3, 4, 5, 6].map((n) => ({ id: `idle_f${n}`, alt: '' })),
    refs: ['rollo_sheet'],
    maxSide: 320,
  },
  {
    // Test fixture for the pose pipeline only. Never shipped or shown in the app.
    id: 'test_person',
    prompt: 'A realistic full-length studio photograph of one fictional adult person in plain dark shorts and a plain light T-shirt, facing the camera, standing upright with both hands on their hips, feet slightly apart. The whole body from head to toe is visible with generous empty space all around, and the person takes up about half the height of the frame. Plain light grey seamless background, even light. No text or logos.',
    size: '1024x1536',
    quality: 'medium',
    transparent: false,
    cols: 0,
    rows: 0,
    sprites: [{ id: 'test_person', alt: '' }],
    refs: [],
    maxSide: 1024,
    referenceOnly: true,
  },
  {
    // Background for the DEV banner and YouTube thumbnail. Words are added in code, in the real brand font.
    id: 'promo_wide',
    prompt: `${STYLE} ${ROLLO} Wide promotional scene for a phone app, matching the reference character. On the right side of the frame, a smartphone propped on a low wooden post at a running track at dawn, its screen glowing with a big halftone rising sun and a heartbeat wave. Rollo stands beside the phone, excited, pointing a wing at it. A huge halftone sun rises behind them, and the horizon line is a heartbeat wave. The entire left half of the image is calm open sky with soft rays and nothing else in it. Bold, simple shapes that read at small sizes. ${NO_TEXT}`,
    size: '1536x1024',
    quality: 'medium',
    transparent: false,
    cols: 0,
    rows: 0,
    sprites: [{ id: 'promo_wide', alt: '' }],
    refs: ['rollo_sheet'],
    maxSide: 1536,
    referenceOnly: true,
  },
];
