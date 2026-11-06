#!/usr/bin/env python3
"""
hush_asset_forge.py  -  the complete HUSH art pack, generated with Meta Model API (Muse Image).

What it makes
  * Anchors first: an art-bible sheet, the Lull mascot sheet, the Listener monster sheet and the
    station plate. Every later image is "anchored" on them (passed as reference images to the
    edits endpoint) so characters and style stay consistent across the whole pack.
  * Backgrounds, hiding-spot POVs, parallax foregrounds, props, UI frames, icons, badges, stamps,
    key art, DEV cover, YouTube thumbnail, poster, story panels, tutorial cards, loading screens,
    collectible tape cards and effects.
  * Transparent PNGs: generated on a flat magenta key, then matted locally (chroma key with
    despill, or rembg if installed).
  * Animations:
      - frame-by-frame cycles drawn by the model with anchored edits (Lull flutter,
        Listener walk, Listener head tilt);
      - procedural loops built from single images (bob, glow pulse, breathe, spin, gentle CRT
        flicker, Ken Burns push-in) and pure effects (static, scanlines, vignette, pulse line).
    Exported as sprite sheet + JSON, transparent WebM (VP9 alpha), MP4 and GIF.
  * manifest.json for the game, and gallery.html to review and pick variants.

Meta Model API exposes image models only (no public video model at the time of writing), so
motion is built from generated frames plus ffmpeg.

Setup
  pip install openai pillow numpy             # required
  pip install rembg onnxruntime               # optional: better cut-outs
  ffmpeg on PATH                              # optional: WebM / MP4 output
  export MODEL_API_KEY="LLM|..."              # create one at dev.meta.ai

Typical flow
  python hush_asset_forge.py --dry-run                     # plan + cost estimate
  python hush_asset_forge.py --only anchors                # make anchors, open gallery.html
  python hush_asset_forge.py --pick lull_sheet=3 --pick listener_sheet=2
  python hush_asset_forge.py                               # everything else, anchored on your picks
  python hush_asset_forge.py --skip-gen                    # redo matting/animations/manifest only
  python hush_asset_forge.py --ids bg_control_room --force # regenerate one asset

Changing a pick after dependants exist? Re-run those dependants with --force.
"""
from __future__ import annotations

import argparse
import base64
import html
import json
import math
import os
import random
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path

try:
    import numpy as np
    from PIL import Image, ImageDraw, ImageEnhance, ImageFilter
except ImportError:  # pragma: no cover
    sys.exit("Missing dependencies: pip install pillow numpy")

try:
    import openai
    from openai import OpenAI
except ImportError:  # only needed for generation
    openai = None
    OpenAI = None

# --------------------------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------------------------
MODEL = os.environ.get("MUSE_IMAGE_MODEL", "muse-image-1.0")
BASE_URL = os.environ.get("META_MODEL_API_BASE", "https://api.meta.ai/v1")
PRICE_PER_IMAGE = float(os.environ.get("MUSE_IMAGE_PRICE", "0.01"))
MAX_RETRIES = 6
KEY_RGB = (255, 0, 255)
FFMPEG = shutil.which("ffmpeg")

# Sizes set the aspect ratio; the server reduces them to a ratio (max ~1600px output).
SQUARE, WIDE, TALL = "1024x1024", "1536x1024", "1024x1536"
CINEMA, BANNER = "1536x864", "1600x672"

SPRITE_MAX_H = 512      # cap for animated sprite frames
BG_ANIM_W = 1280        # width for background loops

# --------------------------------------------------------------------------------------------
# Art direction
# --------------------------------------------------------------------------------------------
WORLD = (
    " Art direction for the game HUSH: Kestrel Listening Station 7, an abandoned 1987 cold-war "
    "acoustic research bunker hidden in a snowy pine forest. Painterly 2.5D indie game art with "
    "crisp readable shapes, analog retro-futurism, glowing CRT phosphor light in cool white and "
    "pale cyan (#CFFAF4, #7FE7DC), soft amber warning accents (#FFB347), deep blue-black shadows "
    "(#0B1016), subtle film grain and VHS softness, volumetric dust in light beams. Quiet, eerie "
    "and beautiful, never gory: no blood, no gore, no injuries."
)
NO_TEXT = " No text, no letters, no numbers, no logos, no watermark."
CUTOUT = (
    " Show the subject alone, isolated on a perfectly flat, uniform, solid pure magenta (#FF00FF) "
    "background: no gradient, no floor, no cast shadow, no vignette, no magenta or pink anywhere "
    "on the subject itself, generous empty margin around the subject, whole subject in frame."
)
REF_NOTE = (
    " Use the reference image(s) only to keep the character design, proportions, colours and art "
    "style exactly the same; draw a brand-new image as described. Ignore the backgrounds of the "
    "reference images."
)
LULL = (
    "Lull, the HUSH mascot: a small round moth-like creature made of soft cool-white and "
    "pale-cyan light, a fluffy glowing body the size of a teacup, two large translucent rounded "
    "wings with a faint thin pulse-wave line pattern running across them, big gentle dark eyes, "
    "tiny feathery antennae, kind calm expression, cute and charming but not childish"
)
LISTENER = (
    "the Listener: a tall gaunt eyeless creature about 2.6 metres tall, its head a cluster of "
    "tarnished brass gramophone horns and old black bakelite telephone receivers all pointing "
    "outward like ears, long thin limbs loosely wrapped in ribbons of brown magnetic tape, dark "
    "matte skin like wet charcoal, slow deliberate stooped posture, no eyes, no visible mouth, "
    "unsettling and uncanny but not gory, no blood"
)
ICON = (
    " Game UI icon: one bold glowing line-art symbol in pale cyan (#7FE7DC) with a soft phosphor "
    "glow, thick even strokes, simple and readable at 32 pixels, centred."
)
BADGE = (
    " Round enamel achievement pin: polished brass rim, deep navy enamel face, a simple glowing "
    "pale-cyan emblem in the centre, slight 3D bevel, front view, centred."
)
STAMP = (
    " A rubber ink stamp impression as if stamped on paper, slightly uneven ink texture, bold "
    "condensed capital letters, rectangular border, tilted a few degrees, ink only."
)


# --------------------------------------------------------------------------------------------
# Asset model
# --------------------------------------------------------------------------------------------
@dataclass
class Asset:
    id: str
    category: str
    prompt: str
    size: str = SQUARE
    refs: list = field(default_factory=list)
    transparent: bool = False
    variants: int = 2
    post: list = field(default_factory=list)       # icon_sizes | dev_cover | thumb
    anim: tuple | None = None                      # (group, frame_index, fps)
    proc: list = field(default_factory=list)       # bob | glow | breathe | spin | flicker | kenburns
    tier: int = 0

    def full_prompt(self) -> str:
        p = self.prompt
        if self.refs:
            p += REF_NOTE
        if self.transparent:
            p += CUTOUT
        return p


def catalog() -> list[Asset]:
    L: list[Asset] = []

    def add(id, cat, prompt, **kw):
        L.append(Asset(id, cat, prompt, **kw))

    # ---------------- anchors ----------------
    add("style_bible", "anchors",
        "An art-bible mood board for the game HUSH arranged as a tidy grid of six panels: a "
        "colour palette strip of the game's colours, a dim concrete corridor lit by one CRT "
        "monitor, a close-up of a reel-to-reel tape machine, a small bunker in a snowy pine "
        "forest at night, a tarnished brass gramophone horn detail, a softly glowing moth made of "
        "light. One cohesive art style." + WORLD + NO_TEXT, size=WIDE, variants=4)
    add("lull_sheet", "anchors",
        "Character reference sheet on a plain off-white background: " + LULL + ". Shown four "
        "times at the same size, evenly spaced: front view, three-quarter view, side view with "
        "wings spread wide, back view. Soft painterly game-art style, consistent design."
        + NO_TEXT, size=WIDE, variants=4)
    add("listener_sheet", "anchors",
        "Character turnaround reference sheet on a plain light grey background: " + LISTENER
        + ". Full body shown three times at the same scale: front, side, three-quarter view. "
        "Painterly game-art style with crisp silhouette." + NO_TEXT, size=WIDE, variants=4)
    add("station_plate", "anchors",
        "Establishing shot at night: a small concrete bunker entrance half-buried in a snowy pine "
        "forest, a tall radio mast with a single blinking red light, one lit window glowing pale "
        "cyan, light snowfall, footprints leading to the door." + WORLD + NO_TEXT,
        size=WIDE, variants=4, proc=["kenburns"])

    # ---------------- backgrounds (empty rooms) ----------------
    rooms = {
        "bg_security_desk": "The security desk: a cramped guard booth seen from the player's "
            "chair, a bank of three glowing CRT monitors showing grainy camera feeds, a desk lamp "
            "casting cool white light, a clipboard, a steel thermos, a rotary phone",
        "bg_control_room": "The control room: a wall of reel-to-reel tape machines and VU "
            "meters, a large round radar-style acoustic map screen glowing cyan, consoles full "
            "of toggles and knobs, a heavy steel door on one side",
        "bg_tape_archive": "The tape archive: tall metal shelves packed with tape boxes and film "
            "canisters, a rolling library ladder, hanging bare bulbs, a reading desk with "
            "headphones, narrow aisles fading into darkness",
        "bg_boiler_room": "The boiler room: a huge old boiler with pressure gauges, pipes along "
            "the ceiling dripping condensation, a fuse box with one empty slot, amber emergency "
            "light, a haze of steam",
        "bg_corridor": "The main corridor: a long concrete corridor with flickering ceiling "
            "light tubes, painted floor arrows, grey acoustic foam panels on the walls, a "
            "distant door left ajar",
    }
    for rid, desc in rooms.items():
        add(rid, "backgrounds", desc + ". Wide view of the empty room with open floor space "
            "where characters could stand; no characters, no people." + WORLD + NO_TEXT,
            size=WIDE, refs=["style_bible"], proc=["flicker"])

    povs = {
        "pov_under_desk": "Point of view of someone hiding under a metal desk, looking out from "
            "the floor between the desk legs into the dim control room, cables hanging down, "
            "floor tiles lit by monitor glow",
        "pov_locker": "Point of view from inside a steel locker, looking out through three "
            "horizontal vent slits into a dim corridor; the locker interior is dark",
        "pov_vent": "Point of view from inside a square metal air duct, looking out through a "
            "grille into a dim room below",
        "pov_shelves": "Point of view crouching behind archive shelves, peering through a gap "
            "between tape boxes into the aisle",
    }
    for pid, desc in povs.items():
        add(pid, "backgrounds", desc + ". Empty, no characters." + WORLD + NO_TEXT,
            size=WIDE, refs=["style_bible"], proc=["flicker"])

    add("bg_escape_dawn", "backgrounds",
        "The escape: a heavy blast door standing open onto a snowy pine forest at dawn, soft pink "
        "and cool blue sky, the first warm sunlight after a long night, footprints in fresh "
        "snow, a feeling of relief." + WORLD + NO_TEXT,
        size=WIDE, refs=["style_bible", "station_plate"], proc=["kenburns"])
    add("bg_game_over", "backgrounds",
        "An empty swivel chair in the dim security booth, a pair of headphones hanging from "
        "the armrest, every CRT showing only static, quiet and eerie." + WORLD + NO_TEXT,
        size=WIDE, refs=["style_bible", "bg_security_desk"], proc=["flicker"])

    # ---------------- parallax foreground layers ----------------
    fgs = {
        "fg_console_edge": "The near edge of a chunky 1980s control console with toggles and a "
            "glowing VU meter, seen close up from below, as a foreground layer",
        "fg_shelf_end": "The end of a tall metal archive shelf stacked with tape boxes, as a "
            "foreground layer",
        "fg_pipes_valve": "A cluster of old pipes with a big round valve wheel and a pressure "
            "gauge, as a foreground layer",
        "fg_desk_edge": "The underside edge of a metal desk with hanging cables, seen from the "
            "floor, as a foreground layer",
    }
    for fid, desc in fgs.items():
        add(fid, "foregrounds", desc + "." + WORLD + NO_TEXT, size=WIDE,
            refs=["style_bible"], transparent=True)

    # ---------------- Lull poses ----------------
    lull = {
        "lull_idle": ("hovering calmly, wings relaxed, glow steady", ["bob", "glow"]),
        "lull_happy": ("wings wide open, glowing brightly, delighted", ["glow"]),
        "lull_worried": ("wings folded around itself, glow dimmed and slightly grey, worried "
                         "eyes", ["breathe"]),
        "lull_sleeping": ("curled up asleep, wings wrapped around its body, very soft glow", []),
        "lull_guiding": ("flying to the right, body tilted, looking back over its shoulder, a "
                         "short trail of light motes behind it", ["bob"]),
        "lull_celebrating": ("doing a happy loop in the air, sparkles of light around it", []),
        "lull_shh": ("antennae lowered, wings hugged in, perfectly still and quiet", []),
        "lull_lamp": ("hovering beside a small desk lamp and pointing at it with one wing, "
                      "helpful", []),
    }
    for lid, (pose, proc) in lull.items():
        add(lid, "characters", f"The same character, {LULL}, {pose}. Soft painterly game art.",
            refs=["lull_sheet"], transparent=True, proc=proc)

    # ---------------- Listener poses ----------------
    listener = {
        "listener_stand": ("standing still, front view, arms hanging, horns slowly turning",
                           ["breathe"], TALL),
        "listener_stalk": ("walking slowly in side view, mid-stride, long arms swaying", [], TALL),
        "listener_lean": ("bending far forward, horn-head lowered and aimed down as if "
                          "listening closely to something hidden below it", ["breathe"], TALL),
        "listener_tilt": ("standing, horn-head tilted to one side, listening intently", [], TALL),
        "listener_reach": ("slowly extending one long thin hand forward, fingers spread, "
                           "searching, not attacking", [], WIDE),
        "listener_silhouette": ("seen as a pure backlit black silhouette against cool light, "
                                "walking past", [], TALL),
        "listener_overhead": ("seen from below, its horn cluster leaning down into view from "
                              "above, filling the top of the frame, dim light", [], SQUARE),
        "listener_far": ("very small in the distance, standing at the far end of a corridor, "
                         "barely visible", [], TALL),
    }
    for lid, (pose, proc, size) in listener.items():
        add(lid, "characters", f"The same creature, {LISTENER}, {pose}. Painterly game art.",
            refs=["listener_sheet"], transparent=True, proc=proc, size=size)

    # ---------------- frame-by-frame animation cycles ----------------
    flutter = ["both wings raised fully up", "wings halfway up", "wings level and fully spread",
               "wings halfway down", "wings fully down", "wings level again, rising"]
    for i, w in enumerate(flutter):
        add(f"lull_flutter_f{i}", "frames",
            f"The same character, {LULL}, front view, hovering, {w}. Frame {i + 1} of 6 of a "
            "smooth wing-flap animation cycle. Identical size, position and lighting in every "
            "frame; only the wings change.", refs=["lull_sheet"], transparent=True,
            variants=1, anim=("lull_flutter", i, 12))
    walk = ["left foot forward touching the ground, right arm forward",
            "weight lowered onto the left leg", "right leg passing the left, upright",
            "rising on the left leg, right leg reaching forward",
            "right foot forward touching the ground, left arm forward",
            "left leg passing the right, upright"]
    for i, w in enumerate(walk):
        add(f"listener_walk_f{i}", "frames",
            f"The same creature, {LISTENER}, strict side view walking to the right, {w}. Frame "
            f"{i + 1} of 6 of a slow walk cycle. Same size and scale in every frame.",
            refs=["listener_sheet"], transparent=True, size=TALL, variants=1,
            anim=("listener_walk", i, 8))
    tilt = ["horn-head facing straight ahead", "horn-head tilted slightly to its left",
            "horn-head tilted strongly to its left, listening", "horn-head returning to centre"]
    for i, w in enumerate(tilt):
        add(f"listener_tilt_f{i}", "frames",
            f"The same creature, {LISTENER}, front view upper body, {w}. Frame {i + 1} of 4 of "
            "a head-tilt animation. Body identical in every frame; only the head moves.",
            refs=["listener_sheet"], transparent=True, size=SQUARE, variants=1,
            anim=("listener_tilt", i, 6))

    # ---------------- props ----------------
    props = {
        "prop_reel_machine": "a 1980s reel-to-reel tape recorder with two spinning reels and VU "
            "meters, three-quarter view",
        "prop_reel_wheel": "a single tape reel seen perfectly face-on from the front, a flat "
            "circular metal reel with three cut-out windows and brown tape wound on it",
        "prop_crt_monitor": "a chunky beige CRT monitor showing a glowing cyan radar sweep",
        "prop_headphones": "a pair of retro studio headphones with a coiled cable",
        "prop_flashlight": "a heavy metal flashlight, switched off",
        "prop_cassette": "a cassette tape with a blank handwritten-style paper label",
        "prop_fuse": "an old glass cartridge fuse with brass end caps",
        "prop_keycard": "a worn plastic security keycard with a magnetic stripe, blank",
        "prop_breaker": "a big industrial breaker switch with a red lever",
        "prop_polaroid": "a polaroid photo of a snowy bunker entrance at night, slightly curled",
        "prop_thermos": "a dented steel thermos flask",
        "prop_desk_lamp": "an articulated metal desk lamp, switched on, casting cool white light",
        "prop_rotary_phone": "a black bakelite rotary telephone",
        "prop_clipboard": "a clipboard with blank paper and a pencil",
        "prop_beacon": "an amber rotating warning beacon light, glowing",
        "prop_oscilloscope": "a small vintage oscilloscope with a glowing green-cyan waveform",
        "prop_gramophone_horn": "a single tarnished brass gramophone horn",
        "prop_tape_box": "a cardboard tape archive box with a blank label",
    }
    for pid, desc in props.items():
        proc = ["spin"] if pid == "prop_reel_wheel" else []
        add(pid, "props", f"Game prop sprite: {desc}." + WORLD + NO_TEXT,
            refs=["style_bible"], transparent=True, proc=proc)

    # ---------------- UI ----------------
    add("ui_logo", "ui",
        "Game logo wordmark reading exactly \"HUSH\": bold condensed letters drawn with one "
        "continuous glowing pale-cyan pulse-wave line that flattens into a perfectly straight "
        "silent line after the last letter, soft phosphor glow, minimal and iconic.",
        size=WIDE, transparent=True, variants=4)
    add("ui_app_icon", "ui",
        "App icon: " + LULL + " glowing in front of a dark rounded CRT screen, deep navy "
        "background, simple bold composition that reads at small sizes." + NO_TEXT,
        refs=["lull_sheet"], variants=4, post=["icon_sizes"])
    add("ui_hud_bezel", "ui",
        "A chunky retro CRT monitor bezel frame in worn beige-grey plastic, front view, with "
        "two knobs, a tiny power LED and a speaker grille along the bottom; the entire screen "
        "area inside the frame is filled with flat solid magenta #FF00FF." + NO_TEXT,
        size=WIDE, transparent=True)
    add("ui_panel", "ui",
        "A riveted dark steel UI panel plate with bevelled edges and small screws in each "
        "corner; the inner area is filled with flat solid magenta #FF00FF." + NO_TEXT,
        size=WIDE, transparent=True)
    add("ui_button", "ui",
        "A single wide rounded rectangular beige console push-button with a subtle pale-cyan "
        "backlight glow around its edge, front view, blank." + NO_TEXT, transparent=True)
    add("ui_noise_meter", "ui",
        "An analog VU-style meter dial, round, cream face with a black arc scale, red zone at "
        "the right end, a thin black needle at rest on the left, front view." + NO_TEXT,
        transparent=True)
    add("ui_oscilloscope_strip", "ui",
        "A long horizontal dark CRT oscilloscope screen strip with a faint grid and rounded "
        "glass, empty, no waveform, framed in black plastic." + NO_TEXT, size=BANNER,
        transparent=False)

    icons = {
        "icon_heart": "a heart", "icon_lungs": "a pair of lungs", "icon_ear": "an ear",
        "icon_stillness": "a closed calm eye", "icon_signal": "antenna signal bars",
        "icon_light": "a lightbulb", "icon_tape": "a cassette tape", "icon_fuse": "a fuse",
        "icon_keycard": "a keycard", "icon_door": "a door", "icon_warning": "a warning triangle",
        "icon_gentle": "a feather", "icon_pause": "a pause symbol",
        "icon_camera": "a webcam", "icon_horn": "a gramophone horn",
    }
    for iid, sym in icons.items():
        add(iid, "icons", f"Icon of {sym}." + ICON + NO_TEXT, transparent=True)

    badges = {
        "badge_ice_veins": "a heart made of ice crystals",
        "badge_ghost_breath": "a soft wisp of breath",
        "badge_statue": "a small stone figure sitting perfectly still",
        "badge_first_light": "a sunrise over pine trees",
        "badge_tape_collector": "three stacked cassette tapes",
        "badge_close_call": "a gramophone horn very close to a tiny hiding figure",
        "badge_sigh_of_relief": "a long slow exhale curl",
        "badge_lull_friend": "the little glowing moth Lull",
    }
    for bid, emb in badges.items():
        refs = ["lull_sheet"] if bid == "badge_lull_friend" else []
        add(bid, "badges", f"Emblem: {emb}." + BADGE + NO_TEXT, transparent=True, refs=refs)

    stamps = {"stamp_survived": ("SURVIVED", "amber-orange"), "stamp_heard": ("HEARD", "red"),
              "stamp_classified": ("CLASSIFIED", "red"),
              "stamp_calm": ("CALM UNDER FIRE", "dark teal")}
    for sid, (word, ink) in stamps.items():
        add(sid, "stamps", f"The stamp reads exactly \"{word}\" in {ink} ink." + STAMP,
            size=WIDE, transparent=True)

    # ---------------- report ----------------
    add("report_bg", "report",
        "A declassified acoustic incident report lying on a dark desk: aged off-white paper, "
        "typewriter-style layout with empty rectangular boxes for charts, a paper clip, a faint "
        "coffee ring, a header that reads exactly \"INCIDENT REPORT\", no other readable text."
        + WORLD, size=TALL, refs=["style_bible"])
    add("report_bg_wide", "report",
        "A wide declassified acoustic incident report spread on a dark desk: aged paper, empty "
        "chart boxes, a polaroid clipped to the corner, a header that reads exactly "
        "\"INCIDENT REPORT\", no other readable text." + WORLD,
        size=WIDE, refs=["style_bible"])

    # ---------------- key art & marketing ----------------
    trio = ["style_bible", "lull_sheet", "listener_sheet"]
    add("keyart_wide", "keyart",
        "Key art: a person hiding under a desk in a dark bunker control room, lit only by the "
        "cool glow of a CRT; in the doorway behind stands the Listener (" + LISTENER + "), its "
        "horns turned toward the desk; beside the person's hands hovers Lull (" + LULL + "), "
        "glowing faintly. Cinematic composition with empty space at the top for a logo."
        + WORLD + NO_TEXT, size=WIDE, refs=trio, variants=4, proc=["kenburns"])
    add("keyart_dev_cover", "keyart",
        "Wide cinematic banner: the Listener (" + LISTENER + ") looming in a dim concrete "
        "corridor on the right, Lull (" + LULL + ") glowing small and brave on the left, a "
        "glowing pale-cyan pulse-wave line running across the whole image that flattens into a "
        "straight line, large bold title text reading exactly \"HUSH\" in the left third."
        + WORLD, size=BANNER, refs=trio, variants=4, post=["dev_cover"])
    add("keyart_thumbnail", "keyart",
        "YouTube thumbnail: extreme close-up of the Listener's brass horn cluster leaning in "
        "from the right, a glowing heart-rate line on the left spiking upward, bold huge text "
        "reading exactly \"HUSH\". High contrast, readable at small size." + WORLD,
        size=CINEMA, refs=["listener_sheet", "style_bible"], variants=4, post=["thumb"])
    add("keyart_poster", "keyart",
        "Vertical movie-style poster: the Listener (" + LISTENER + ") towering at the top in "
        "darkness, far below a single glowing desk where Lull (" + LULL + ") shines, title text "
        "reading exactly \"HUSH\" and a small tagline reading exactly \"IT HEARS YOUR HEART\"."
        + WORLD, size=TALL, refs=trio, variants=4)
    add("keyart_endcard", "keyart",
        "End card: Lull (" + LULL + ") resting on a windowsill of the bunker looking out at a "
        "snowy forest at dawn, warm light, peaceful, large empty area on the left for text."
        + WORLD + NO_TEXT, size=CINEMA, refs=["lull_sheet", "style_bible"], variants=4)

    # ---------------- story panels ----------------
    story = [
        "1987: inside the bunker control room, a researcher seen from behind wearing headphones "
        "at a console, a strange waveform glowing on the screen, snow outside the window",
        "the Listener emerging slowly between tall archive shelves, only its horn cluster lit "
        "by a hanging bulb, tape ribbons trailing",
        "years later: the abandoned station, snow drifted through a half-open door, dust over "
        "the consoles, every monitor dark except one",
        "a person arriving with a flashlight in the dark corridor, and a small glowing moth of "
        "light appearing in front of them offering its light",
    ]
    for i, s in enumerate(story):
        add(f"story_{i + 1}", "story", f"Story panel {i + 1}: {s}. Painterly cinematic "
            "illustration." + WORLD + NO_TEXT, size=WIDE,
            refs=["station_plate", "listener_sheet", "lull_sheet"])

    # ---------------- tutorial cards ----------------
    tuts = {
        "tut_still": "hovering perfectly still beside a desk lamp, a single dust mote frozen in "
                     "the light, everything calm",
        "tut_light": "hovering next to a desk lamp that lights the softly drawn silhouette of a "
                     "person's face evenly from the front",
        "tut_breathe": "with its wings slowly expanding like a deep calm breath, a soft cyan "
                       "wave line looping gently around it",
        "tut_quiet": "with antennae lowered and wings hugged in, being very quiet, while a tiny "
                     "dark horn-headed silhouette stands far away in the background",
    }
    for tid, desc in tuts.items():
        add(tid, "tutorial", f"Tutorial card illustration: {LULL}, {desc}. Rounded card "
            "composition, soft dark background." + WORLD + NO_TEXT, refs=["lull_sheet"])

    # ---------------- loading screens ----------------
    loads = {
        "loading_1": "asleep on top of a slowly turning tape reel",
        "loading_2": "reading a folded paper map of the station by its own glow",
        "loading_3": "peeking out from inside a headphone ear cup",
    }
    for lid, desc in loads.items():
        add(lid, "loading", f"Loading screen art: {LULL}, {desc}, in a dim cosy corner of the "
            "bunker." + WORLD + NO_TEXT, size=CINEMA, refs=["lull_sheet", "style_bible"])

    # ---------------- collectible tape cards ----------------
    tapes = ["a radio mast in falling snow", "an ear-shaped sound spectrogram glowing cyan",
             "an empty corridor lit by one tube light", "a cluster of brass gramophone horns",
             "a pine forest at dawn"]
    for i, t in enumerate(tapes):
        add(f"tape_card_{i + 1}", "tapes",
            f"Illustrated cassette J-card cover for a research tape, showing {t}, with a small "
            f"typed label reading exactly \"LOG 0{i + 1}\"." + WORLD,
            refs=["style_bible"])

    # ---------------- effects ----------------
    fx = {
        "fx_dust": "a loose scatter of tiny glowing dust motes floating in the air",
        "fx_fog": "a single soft wisp of low ground fog, pale and translucent",
        "fx_lightcone": "a cone of cool white light shining down from above with dust in it",
        "fx_tape_strands": "a few loose tangled ribbons of brown magnetic tape",
    }
    for fid, desc in fx.items():
        add(fid, "effects", f"Visual effect sprite: {desc}." + NO_TEXT, size=WIDE,
            transparent=True)

    return L


def assign_tiers(assets: list[Asset]) -> None:
    by = {a.id: a for a in assets}

    def tier(a: Asset, depth=0) -> int:
        if depth > 20:
            raise ValueError(f"reference cycle at {a.id}")
        refs = [by[r] for r in a.refs if r in by]
        return 0 if not refs else 1 + max(tier(r, depth + 1) for r in refs)

    for a in assets:
        a.tier = tier(a)


# --------------------------------------------------------------------------------------------
# Image helpers
# --------------------------------------------------------------------------------------------
def detect_ext(data: bytes) -> str:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    if data[:3] == b"\xff\xd8\xff":
        return ".jpg"
    return ".png"


def chroma_key(img: Image.Image, key=KEY_RGB, inner=70.0, outer=150.0) -> Image.Image:
    arr = np.asarray(img.convert("RGBA")).astype(np.float32)
    rgb = arr[..., :3]
    dist = np.sqrt(((rgb - np.array(key, np.float32)) ** 2).sum(-1))
    alpha = np.clip((dist - inner) / (outer - inner), 0.0, 1.0)
    alpha[alpha < 0.04] = 0.0
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    spill = np.clip(np.minimum(r, b) - g, 0, None)
    edge = (alpha < 0.999).astype(np.float32)
    r = r - spill * edge
    b = b - spill * edge
    out = np.dstack([r, g, b, alpha * arr[..., 3]]).clip(0, 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def rembg_cut(img: Image.Image) -> Image.Image | None:
    try:
        from rembg import remove  # lazy: heavy import
    except Exception:
        return None
    try:
        return remove(img.convert("RGBA"))
    except Exception:
        return None


def coverage(img: Image.Image) -> float:
    return float(np.asarray(img.getchannel("A")).mean() / 255.0)


def trim(img: Image.Image, pad=12) -> Image.Image:
    bbox = img.getchannel("A").point(lambda v: 255 if v > 10 else 0).getbbox()
    if not bbox:
        return img
    l, t, r, b = bbox
    return img.crop((max(0, l - pad), max(0, t - pad),
                     min(img.width, r + pad), min(img.height, b + pad)))


def fit_cover(img: Image.Image, w: int, h: int) -> Image.Image:
    s = max(w / img.width, h / img.height)
    im = img.resize((math.ceil(img.width * s), math.ceil(img.height * s)), Image.LANCZOS)
    l, t = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((l, t, l + w, t + h))


def cap(img: Image.Image, max_w=None, max_h=None) -> Image.Image:
    s = 1.0
    if max_w and img.width > max_w:
        s = min(s, max_w / img.width)
    if max_h and img.height > max_h:
        s = min(s, max_h / img.height)
    if s < 1.0:
        img = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))),
                         Image.LANCZOS)
    return img


def brighten(img: Image.Image, k: float) -> Image.Image:
    a = img.getchannel("A")
    rgb = ImageEnhance.Brightness(img.convert("RGB")).enhance(k)
    rgb.putalpha(a)
    return rgb


def on_bg(img: Image.Image, bg) -> Image.Image:
    base = Image.new("RGBA", img.size, tuple(bg) + (255,))
    base.alpha_composite(img)
    return base


def normalize_frames(frames: list[Image.Image]) -> list[Image.Image]:
    frames = [trim(f, 4) for f in frames]
    target_h = min(SPRITE_MAX_H, sorted(f.height for f in frames)[len(frames) // 2])
    scaled = [f.resize((max(1, round(f.width * target_h / f.height)), target_h), Image.LANCZOS)
              for f in frames]
    W = max(f.width for f in scaled)
    out = []
    for f in scaled:
        c = Image.new("RGBA", (W, target_h), (0, 0, 0, 0))
        c.alpha_composite(f, ((W - f.width) // 2, target_h - f.height))
        out.append(c)
    return out


_SCANLINES: dict = {}


def scanlines(size, gap=3, alpha=38) -> Image.Image:
    if size not in _SCANLINES:
        im = Image.new("RGBA", size, (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        for y in range(0, size[1], gap):
            d.line([(0, y), (size[0], y)], fill=(0, 0, 0, alpha))
        _SCANLINES[size] = im
    return _SCANLINES[size]


def vignette(size, strength=0.65) -> Image.Image:
    w, h = size
    y, x = np.ogrid[:h, :w]
    nx, ny = (x - w / 2) / (w / 2), (y - h / 2) / (h / 2)
    d = np.clip(np.sqrt(nx ** 2 + ny ** 2) / 1.414, 0, 1)
    a = (np.clip((d - 0.45) / 0.55, 0, 1) ** 1.6 * 255 * strength).astype(np.uint8)
    out = np.zeros((h, w, 4), np.uint8)
    out[..., 3] = a
    return Image.fromarray(out, "RGBA")


# --------------------------------------------------------------------------------------------
# Procedural animations  (each returns frames, fps, transparent?)
# --------------------------------------------------------------------------------------------
def p_bob(img):
    img = cap(img, max_h=SPRITE_MAX_H)
    n, amp = 48, max(4, img.height // 40)
    frames = []
    for i in range(n):
        y = amp + round(amp * math.sin(2 * math.pi * i / n))
        f = Image.new("RGBA", (img.width, img.height + 2 * amp), (0, 0, 0, 0))
        f.alpha_composite(img, (0, y))
        frames.append(f)
    return frames, 24, True


def p_breathe(img):
    img = cap(img, max_h=SPRITE_MAX_H)
    n, s = 72, 0.025
    W, H = math.ceil(img.width * (1 + s)) + 2, math.ceil(img.height * (1 + s)) + 2
    frames = []
    for i in range(n):
        k = 1 + s * math.sin(2 * math.pi * i / n)
        im = img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)
        f = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        f.alpha_composite(im, ((W - im.width) // 2, H - im.height))
        frames.append(f)
    return frames, 24, True


def p_glow(img):
    img = cap(img, max_h=SPRITE_MAX_H)
    n, pad = 48, max(16, img.width // 8)
    base = Image.new("RGBA", (img.width + 2 * pad, img.height + 2 * pad), (0, 0, 0, 0))
    base.alpha_composite(img, (pad, pad))
    blurred = base.getchannel("A").filter(ImageFilter.GaussianBlur(pad / 2))
    frames = []
    for i in range(n):
        t = 0.5 + 0.5 * math.sin(2 * math.pi * i / n)
        m = 0.30 + 0.55 * t
        halo = Image.new("RGBA", base.size, (170, 245, 235, 0))
        halo.putalpha(blurred.point(lambda v, m=m: int(min(255, v * m))))
        f = Image.alpha_composite(halo, brighten(base, 1.0 + 0.10 * t))
        frames.append(f)
    return frames, 24, True


def p_spin(img):
    img = cap(img, max_h=SPRITE_MAX_H, max_w=SPRITE_MAX_H)
    side = max(img.width, img.height)
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.alpha_composite(img, ((side - img.width) // 2, (side - img.height) // 2))
    n = 36
    return [sq.rotate(-360 * i / n, resample=Image.BICUBIC) for i in range(n)], 24, True


def p_flicker(img, seed=7):
    rnd = random.Random(seed)
    base = cap(img.convert("RGBA"), max_w=BG_ANIM_W)
    base = on_bg(base, (11, 16, 22))
    n = 72  # 3 s at 24 fps; at most ~1 dip per second (photosensitivity-safe)
    dips = set(rnd.sample(range(n), k=3))
    sl, vg = scanlines(base.size), vignette(base.size)
    frames = []
    for i in range(n):
        k = 0.94 if i in dips else 1.0 - rnd.uniform(0, 0.012)
        f = brighten(base, k)
        if i in dips:
            f = f.transform(f.size, Image.AFFINE, (1, 0, -1, 0, 1, 0))
        noise = (np.random.default_rng(seed * 1000 + i).normal(0, 5, (f.height, f.width, 1)))
        arr = np.asarray(f).astype(np.float32)
        arr[..., :3] = np.clip(arr[..., :3] + noise, 0, 255)
        f = Image.fromarray(arr.astype(np.uint8), "RGBA")
        f.alpha_composite(sl)
        f.alpha_composite(vg)
        frames.append(f)
    return frames, 24, False


def p_kenburns(img):
    src = img.convert("RGBA")
    out_w = BG_ANIM_W
    out_h = round(out_w * src.height / src.width) // 2 * 2
    n = 192  # 8 s
    frames = []
    for i in range(n):
        t = i / (n - 1)
        e = t * t * (3 - 2 * t)
        z = 1.0 + 0.10 * e
        cw, ch = src.width / z, src.height / z
        cx = src.width * (0.48 + 0.04 * e)
        cy = src.height * (0.50 - 0.02 * e)
        x0 = min(max(0.0, cx - cw / 2), src.width - cw)
        y0 = min(max(0.0, cy - ch / 2), src.height - ch)
        box = (x0, y0, x0 + cw, y0 + ch)
        frames.append(src.resize((out_w, out_h), Image.LANCZOS, box=box))
    return frames, 24, False


PROC = {"bob": p_bob, "breathe": p_breathe, "glow": p_glow, "spin": p_spin,
        "flicker": p_flicker, "kenburns": p_kenburns}


def fx_static(w=640, h=360, n=24):
    rng = np.random.default_rng(3)
    frames = []
    for _ in range(n):
        g = rng.integers(0, 255, (h, w), dtype=np.uint8)
        arr = np.dstack([g, g, g, np.full((h, w), 70, np.uint8)])
        frames.append(Image.fromarray(arr, "RGBA"))
    return frames, 24, True


def fx_pleth(w=640, h=160, n=90):
    """Decorative scrolling pulse-like line for HUD idle states (not real data)."""
    def wave(x):
        ph = x % 1.0
        return (math.exp(-((ph - 0.25) / 0.05) ** 2) * 1.0
                + math.exp(-((ph - 0.45) / 0.07) ** 2) * 0.35)
    frames = []
    beats = 3.0
    for i in range(n):
        layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        pts = [(x, h * 0.75 - wave(x / w * beats + i / n) * h * 0.55) for x in range(0, w, 2)]
        d.line(pts, fill=(127, 231, 220, 255), width=3)
        glow = layer.filter(ImageFilter.GaussianBlur(6))
        f = Image.alpha_composite(glow, layer)
        frames.append(f)
    return frames, 30, True


# --------------------------------------------------------------------------------------------
# The forge
# --------------------------------------------------------------------------------------------
class Forge:
    def __init__(self, args, assets: list[Asset]):
        self.args = args
        self.out = Path(args.out)
        self.raw = self.out / "raw"
        self.final = self.out / "final"
        self.anim = self.out / "anim"
        self.assets = assets
        self.by_id = {a.id: a for a in assets}
        self.picks_file = self.out / "picks.json"
        self.picks = json.loads(self.picks_file.read_text()) if self.picks_file.exists() else {}
        self.lock = threading.Lock()
        self.calls = 0
        self.failures: list[dict] = []
        self.manifest = {"generator": "hush_asset_forge", "model": MODEL,
                         "images": {}, "animations": {}}
        self.client = None

    # ---- paths ----
    def rel(self, p: Path) -> str:
        return p.relative_to(self.out).as_posix()

    def raw_base(self, a: Asset, v: int) -> Path:
        return self.raw / a.category / f"{a.id}_v{v}"

    def find_raw(self, a: Asset, v: int) -> Path | None:
        d = self.raw / a.category
        if not d.exists():
            return None
        for p in sorted(d.glob(f"{a.id}_v{v}.*")):
            if p.suffix != ".part":
                return p
        return None

    def final_path(self, a: Asset, v: int) -> Path:
        return self.final / a.category / f"{a.id}_v{v}.png"

    def pick(self, asset_id: str) -> int:
        return int(self.picks.get(asset_id, 1))

    def variants(self, a: Asset) -> int:
        if a.anim:
            return 1
        if self.args.variants:
            return self.args.variants
        return max(1, round(a.variants * self.args.variant_scale))

    # ---- planning ----
    def todo(self, assets):
        jobs = []
        for a in assets:
            for v in range(1, self.variants(a) + 1):
                if self.args.force or not self.find_raw(a, v):
                    jobs.append((a, v))
        return jobs

    # ---- generation ----
    def _call(self, prompt: str, size: str | None, refs: list[Path]) -> bytes:
        kw = {"model": MODEL, "prompt": prompt, "n": 1}
        if size:
            kw["size"] = size
        if refs:
            files = [open(p, "rb") for p in refs]  # reopen per call (files are exhausted once read)
            try:
                resp = self.client.images.edit(image=files if len(files) > 1 else files[0], **kw)
            finally:
                for f in files:
                    f.close()
        else:
            resp = self.client.images.generate(**kw)
        b64 = resp.data[0].b64_json
        if not b64:
            raise RuntimeError("response contained no b64_json image")
        return base64.b64decode(b64)

    def gen_one(self, a: Asset, v: int) -> str:
        refs = []
        for r in a.refs:
            ra = self.by_id.get(r)
            p = self.find_raw(ra, self.pick(r)) if ra else None
            if p:
                refs.append(p)
            else:
                print(f"  ! {a.id}: anchor '{r}' missing, generating without it")
        prompt = a.full_prompt()
        size = a.size
        last_err = None
        for attempt in range(MAX_RETRIES):
            try:
                data = self._call(prompt, size, refs)
                base = self.raw_base(a, v)
                base.parent.mkdir(parents=True, exist_ok=True)
                for old in base.parent.glob(f"{base.name}.*"):
                    old.unlink()
                tmp = Path(str(base) + ".part")
                tmp.write_bytes(data)
                tmp.replace(Path(str(base) + detect_ext(data)))
                with self.lock:
                    self.calls += 1
                return "ok"
            except Exception as e:  # noqa: BLE001
                last_err = e
                msg = str(e).lower()
                if openai and isinstance(e, openai.BadRequestError):
                    if size and "size" in msg:
                        size = None  # endpoint rejected the size: retry without it
                        continue
                    break  # policy / validation errors won't fix themselves
                if openai and isinstance(e, openai.AuthenticationError):
                    raise
                time.sleep(min(90, 2 ** attempt + random.random() * 2))
        with self.lock:
            self.failures.append({"id": a.id, "variant": v, "error": str(last_err)[:500]})
        return "fail"

    def generate(self, assets: list[Asset]):
        if OpenAI is None:
            sys.exit("pip install openai  (needed for generation)")
        key = os.environ.get("MODEL_API_KEY")
        if not key:
            sys.exit("Set MODEL_API_KEY (create one at dev.meta.ai)")
        self.client = OpenAI(base_url=BASE_URL, api_key=key, timeout=300, max_retries=0)

        jobs = self.todo(assets)
        tiers = sorted({a.tier for a, _ in jobs})
        done = 0
        for t in tiers:
            batch = [(a, v) for a, v in jobs if a.tier == t]
            print(f"\n== tier {t}: {len(batch)} images ==")
            with ThreadPoolExecutor(max_workers=self.args.workers) as ex:
                futs = {ex.submit(self.gen_one, a, v): (a, v) for a, v in batch}
                for fut in as_completed(futs):
                    a, v = futs[fut]
                    try:
                        status = fut.result()
                    except Exception as e:  # auth errors etc.
                        sys.exit(f"Fatal: {e}")
                    done += 1
                    print(f"  [{done}/{len(jobs)}] {status:4s} {a.category}/{a.id}_v{v}")
        if self.failures:
            (self.out / "failures.json").write_text(json.dumps(self.failures, indent=2))
            print(f"\n{len(self.failures)} failed -> failures.json (re-run to retry)")
        print(f"API calls made: {self.calls}  (~${self.calls * PRICE_PER_IMAGE:.2f})")

    # ---- post-processing ----
    def matte(self, img: Image.Image) -> Image.Image:
        mode = self.args.matting
        if mode == "none":
            return img
        if mode == "rembg":
            cut = rembg_cut(img)
            if cut is not None:
                return cut
            print("  ! rembg unavailable, falling back to chroma key")
        out = chroma_key(img)
        if mode == "auto" and not (0.01 < coverage(out) < 0.97):
            cut = rembg_cut(img)
            if cut is not None:
                return cut
        return out

    def post_one(self, a: Asset, v: int):
        src = self.find_raw(a, v)
        if not src:
            return None
        img = Image.open(src)
        img.load()
        img = img.convert("RGBA")
        if a.transparent:
            img = trim(self.matte(img), 12)
        extra = []
        for op in a.post:
            if op == "dev_cover":
                img = fit_cover(img, 1000, 420)
            elif op == "thumb":
                img = fit_cover(img, 1280, 720)
            elif op == "icon_sizes":
                sq = fit_cover(img, min(img.size), min(img.size))
                for s in (1024, 512, 256, 128, 64, 32):
                    p = self.final / a.category / f"{a.id}_v{v}_{s}.png"
                    p.parent.mkdir(parents=True, exist_ok=True)
                    sq.resize((s, s), Image.LANCZOS).save(p, optimize=True)
                    extra.append(self.rel(p))
        dst = self.final_path(a, v)
        dst.parent.mkdir(parents=True, exist_ok=True)
        (img if a.transparent else img.convert("RGB")).save(dst, optimize=True)
        return dst, img.size, extra

    def postprocess(self):
        print("\n== post-processing ==")
        for a in self.assets:
            files, extras, dims = [], [], None
            for v in range(1, self.variants(a) + 1):
                res = self.post_one(a, v)
                if res:
                    dst, size, extra = res
                    files.append(self.rel(dst))
                    extras += extra
                    if v == self.pick(a.id) or dims is None:
                        dims = size
            if files:
                self.manifest["images"][a.id] = {
                    "category": a.category, "transparent": a.transparent,
                    "picked": self.pick(a.id), "files": files, "extra": extras,
                    "width": dims[0], "height": dims[1], "refs": a.refs, "prompt": a.prompt,
                }
        print(f"  {len(self.manifest['images'])} assets processed")

    # ---- animations ----
    def load_final(self, a: Asset) -> Image.Image | None:
        v = self.pick(a.id)
        p = self.final_path(a, v)
        if not p.exists():
            p = self.final_path(a, 1)
        if not p.exists():
            return None
        im = Image.open(p)
        im.load()
        return im.convert("RGBA")

    def assemble(self, name, frames, fps, transparent, source, kind, sheet=True):
        d = self.anim / name
        d.mkdir(parents=True, exist_ok=True)
        w, h = frames[0].size
        entry = {"source": source, "kind": kind, "fps": fps, "frameWidth": w,
                 "frameHeight": h, "frameCount": len(frames), "transparent": transparent}
        if sheet:
            cols = min(len(frames), 8)
            rows = math.ceil(len(frames) / cols)
            sh = Image.new("RGBA", (cols * w, rows * h), (0, 0, 0, 0))
            meta = {"name": name, "fps": fps, "frameWidth": w, "frameHeight": h, "frames": []}
            for i, f in enumerate(frames):
                x, y = (i % cols) * w, (i // cols) * h
                sh.alpha_composite(f, (x, y))
                meta["frames"].append({"x": x, "y": y, "w": w, "h": h})
            sh.save(d / "sheet.png", optimize=True)
            (d / "sheet.json").write_text(json.dumps(meta, indent=1))
            entry["sheet"], entry["sheetJson"] = self.rel(d / "sheet.png"), self.rel(d / "sheet.json")

        bg = (11, 16, 22)
        gif_frames = [cap(on_bg(f, bg), max_w=480).convert("RGB")
                      .quantize(colors=128, method=Image.Quantize.MEDIANCUT) for f in frames]
        gif = d / f"{name}.gif"
        gif_frames[0].save(gif, save_all=True, append_images=gif_frames[1:],
                           duration=max(20, int(1000 / fps)), loop=0, disposal=2)
        entry["gif"] = self.rel(gif)

        if FFMPEG:
            with tempfile.TemporaryDirectory() as td:
                for i, f in enumerate(frames):
                    f.save(f"{td}/a_{i:04d}.png")
                    on_bg(f, bg).convert("RGB").save(f"{td}/b_{i:04d}.png")
                webm, mp4 = d / f"{name}.webm", d / f"{name}.mp4"
                pad_a = "pad=ceil(iw/2)*2:ceil(ih/2)*2:color=black@0"
                cmd_webm = [FFMPEG, "-y", "-loglevel", "error", "-framerate", str(fps),
                            "-i", f"{td}/a_%04d.png", "-vf", pad_a, "-c:v", "libvpx-vp9",
                            "-pix_fmt", "yuva420p" if transparent else "yuv420p",
                            "-b:v", "0", "-crf", "32", "-row-mt", "1", "-deadline", "good",
                            "-cpu-used", "4", "-auto-alt-ref", "0", str(webm)]
                cmd_mp4 = [FFMPEG, "-y", "-loglevel", "error", "-framerate", str(fps),
                           "-i", f"{td}/b_%04d.png", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
                           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
                           "-preset", "veryfast", "-movflags", "+faststart", str(mp4)]
                for cmd, key, path in ((cmd_webm, "webm", webm), (cmd_mp4, "mp4", mp4)):
                    r = subprocess.run(cmd, capture_output=True, text=True)
                    if r.returncode == 0 and path.exists():
                        entry[key] = self.rel(path)
                    else:
                        print(f"  ! ffmpeg {key} failed for {name}: {r.stderr.strip()[:200]}")
        self.manifest["animations"][name] = entry

    def animations(self):
        print("\n== animations ==")
        # frame-by-frame groups
        groups: dict[str, list] = {}
        for a in self.assets:
            if a.anim:
                groups.setdefault(a.anim[0], []).append(a)
        for g, members in groups.items():
            members.sort(key=lambda a: a.anim[1])
            frames = [self.load_final(a) for a in members]
            if any(f is None for f in frames):
                print(f"  - {g}: missing frames, skipped")
                continue
            frames = normalize_frames(frames)
            fps = members[0].anim[2]
            if g == "listener_tilt":
                frames = frames + frames[-2:0:-1]  # ping-pong for a seamless loop
            self.assemble(g, frames, fps, True, [m.id for m in members], "frames")
            print(f"  + {g} ({len(frames)} frames)")
        # procedural loops from single images
        for a in self.assets:
            if not a.proc:
                continue
            img = self.load_final(a)
            if img is None:
                continue
            for kind in a.proc:
                frames, fps, transparent = PROC[kind](img)
                name = f"{a.id}_{kind}"
                big = kind in ("flicker", "kenburns")
                self.assemble(name, frames, fps, transparent, a.id, kind, sheet=not big)
                print(f"  + {name}")
        # pure effects (no API needed)
        for name, fn in (("fx_static", fx_static), ("fx_pleth", fx_pleth)):
            frames, fps, tr = fn()
            self.assemble(name, frames, fps, tr, None, "fx")
            print(f"  + {name}")
        for name, im in (("fx_scanlines", scanlines((1280, 720))),
                         ("fx_vignette", vignette((1280, 720)))):
            p = self.final / "effects" / f"{name}.png"
            p.parent.mkdir(parents=True, exist_ok=True)
            im.save(p)
            self.manifest["images"][name] = {"category": "effects", "transparent": True,
                                             "picked": 1, "files": [self.rel(p)],
                                             "width": 1280, "height": 720, "refs": [],
                                             "prompt": "procedural"}
        if not FFMPEG:
            print("  (ffmpeg not found: made sheets + GIFs only; install ffmpeg for WebM/MP4)")

    # ---- manifest + gallery ----
    def write_outputs(self):
        (self.out / "manifest.json").write_text(json.dumps(self.manifest, indent=1))
        cards = []
        for aid, e in self.manifest["images"].items():
            for f in e["files"]:
                pick = " picked" if f.endswith(f"_v{e['picked']}.png") else ""
                cls = "chk" if e["transparent"] else ""
                cards.append(f'<figure class="{cls}{pick}"><img loading="lazy" src="{f}">'
                             f'<figcaption>{html.escape(e["category"])} · '
                             f'{html.escape(Path(f).stem)}</figcaption></figure>')
        for name, e in self.manifest["animations"].items():
            if e.get("webm"):
                media = (f'<video autoplay loop muted playsinline src="{e["webm"]}" '
                         f'poster="{e.get("gif", "")}"></video>')
            else:
                media = f'<img loading="lazy" src="{e["gif"]}">'
            cards.append(f'<figure class="chk">{media}<figcaption>anim · {html.escape(name)} · '
                         f'{e["kind"]} · {e["fps"]}fps</figcaption></figure>')
        page = f"""<!doctype html><meta charset="utf-8"><title>HUSH asset pack</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{{margin:0;background:#0b1016;color:#cffaf4;font:14px system-ui,sans-serif;padding:16px}}
h1{{font-weight:800;letter-spacing:.2em}} .grid{{display:grid;gap:12px;
grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}}
figure{{margin:0;background:#141c25;border:1px solid #23313f;border-radius:10px;overflow:hidden}}
figure.picked{{outline:2px solid #7fe7dc}}
figure img,figure video{{width:100%;height:200px;object-fit:contain;display:block}}
.chk img,.chk video{{background:repeating-conic-gradient(#1d2733 0 25%,#141c25 0 50%) 0 0/20px 20px}}
figcaption{{padding:8px;font-size:12px;color:#8fb3b0;word-break:break-all}}
</style><h1>HUSH · asset pack</h1>
<p>{len(self.manifest['images'])} images · {len(self.manifest['animations'])} animations.
Pick favourites with <code>--pick id=N</code>, then re-run dependants with <code>--force</code>.</p>
<div class="grid">{''.join(cards)}</div>"""
        (self.out / "gallery.html").write_text(page, encoding="utf-8")
        print(f"\nmanifest -> {self.out / 'manifest.json'}\ngallery  -> {self.out / 'gallery.html'}")


# --------------------------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------------------------
def parse():
    ap = argparse.ArgumentParser(description="Generate the HUSH asset pack with Meta Muse Image.")
    ap.add_argument("--out", default="hush_assets", help="output folder")
    ap.add_argument("--workers", type=int, default=6, help="parallel API requests")
    ap.add_argument("--only", help="comma-separated categories (anchors,backgrounds,characters,"
                    "frames,props,ui,icons,badges,stamps,report,keyart,story,tutorial,loading,"
                    "tapes,effects,foregrounds)")
    ap.add_argument("--ids", help="comma-separated asset ids")
    ap.add_argument("--variants", type=int, help="force N variants for every asset")
    ap.add_argument("--variant-scale", type=float, default=1.0,
                    help="multiply default variant counts (e.g. 2 for twice the options)")
    ap.add_argument("--pick", action="append", default=[], help="id=N  choose a variant")
    ap.add_argument("--matting", choices=["auto", "chroma", "rembg", "none"], default="auto")
    ap.add_argument("--force", action="store_true", help="regenerate even if files exist")
    ap.add_argument("--skip-gen", action="store_true", help="post-process only")
    ap.add_argument("--skip-post", action="store_true", help="generate only")
    ap.add_argument("--dry-run", action="store_true", help="show plan and cost, do nothing")
    ap.add_argument("--max-cost", type=float, default=50.0, help="abort if estimate exceeds")
    ap.add_argument("--list", action="store_true", help="list asset ids and exit")
    return ap.parse_args()


def main():
    args = parse()
    all_assets = catalog()
    assign_tiers(all_assets)
    ids = [a.id for a in all_assets]
    assert len(ids) == len(set(ids)), "duplicate asset ids"

    if args.list:
        for a in all_assets:
            print(f"{a.category:12s} t{a.tier}  {a.id}")
        return

    forge = Forge(args, all_assets)
    if args.pick:
        for p in args.pick:
            k, _, v = p.partition("=")
            if k not in forge.by_id or not v.isdigit():
                sys.exit(f"bad --pick '{p}' (use id=N)")
            forge.picks[k] = int(v)
        forge.out.mkdir(parents=True, exist_ok=True)
        forge.picks_file.write_text(json.dumps(forge.picks, indent=2))
        print(f"picks saved: {forge.picks}")

    selected = all_assets
    if args.only:
        cats = {c.strip() for c in args.only.split(",")}
        selected = [a for a in selected if a.category in cats]
    if args.ids:
        want = {i.strip() for i in args.ids.split(",")}
        selected = [a for a in selected if a.id in want]

    jobs = forge.todo(selected)
    est = len(jobs) * PRICE_PER_IMAGE
    print(f"HUSH asset forge · model {MODEL} · {len(selected)} assets · "
          f"{len(jobs)} images to generate · est. ${est:.2f}")
    if args.dry_run:
        by_cat: dict[str, int] = {}
        for a, _ in jobs:
            by_cat[a.category] = by_cat.get(a.category, 0) + 1
        for c, n in sorted(by_cat.items()):
            print(f"  {c:12s} {n}")
        return
    if est > args.max_cost:
        sys.exit(f"Estimate ${est:.2f} exceeds --max-cost {args.max_cost}")

    forge.out.mkdir(parents=True, exist_ok=True)
    if not args.skip_gen and jobs:
        forge.generate(selected)
    if not args.skip_post:
        forge.postprocess()
        forge.animations()
        forge.write_outputs()


if __name__ == "__main__":
    main()
