import { motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, type CampView, type CrewFeed, type MapView, type Recap } from '../api';
import { ASSETS } from '../assets.gen';
import { Art, Avatar, Problem, Spinner, type AssetId } from '../ui/kit';
import { DawnMapView } from './DawnMap';
import { recapCard, restedCard, saveImage } from './ShareCard';

const EMBLEMS = (Object.keys(ASSETS) as AssetId[]).filter((id) => id.startsWith('emblem_'));
const COLOURS = ['#FF6B5B', '#3FB8AF', '#2B2A6B', '#FFB37A', '#B8352A', '#17706A'];
const LEAGUE_ART: Record<string, AssetId> = {
  Dawn: 'league_dawn',
  Morning: 'league_morning',
  Midday: 'league_midday',
  'Golden Hour': 'league_golden',
};

/** The server says when something changed. It never pushes data: this just fetches again. */
export function useCrewUpdates(token: string, onUpdate: () => void): void {
  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/crew?token=${encodeURIComponent(token)}`);
    ws.onmessage = () => onUpdate();
    return () => ws.close();
  }, [token, onUpdate]);
}

function CreateOrJoin({ token, onDone }: { token: string; onDone: () => void }) {
  const [name, setName] = useState('');
  const [emblem, setEmblem] = useState<string>(EMBLEMS[0] ?? 'emblem_fox');
  const [colour, setColour] = useState(COLOURS[0]!);
  const stored = (() => {
    try {
      return localStorage.getItem('rc_join') ?? '';
    } catch {
      return '';
    }
  })();
  const [code, setCode] = useState(stored);
  const [error, setError] = useState('');
  const send = (path: string, json: unknown): void => {
    setError('');
    api(`/api/a/${token}${path}`, { json })
      .then(() => {
        try {
          localStorage.removeItem('rc_join');
        } catch {
          /* Nothing to clean up. */
        }
        onDone();
      })
      .catch((err: ApiError) => setError(err.message));
  };
  return (
    <main id="content" className="mx-auto max-w-md px-4 py-6 pb-24">
      <Art id="rollo_crew" alt="" eager className="mx-auto h-40 w-auto" />
      <h1 className="mt-2 text-center text-3xl">The competition where resting can win</h1>
      <p className="mt-1 text-center text-mute">Crews score how you respond to your own readings. Nobody is ranked on pulse, jumps, reps or speed, and your crew never sees your numbers.</p>
      {error && (
        <p role="alert" className="mt-3 text-center font-semibold text-coral-ink">
          {error}
        </p>
      )}
      <form
        className="card mt-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          send('/crews/join', { code });
        }}
      >
        <label htmlFor="join-code" className="font-display text-lg font-bold">
          Join with a code
        </label>
        <div className="mt-1 flex gap-2">
          <input id="join-code" value={code} onChange={(e) => setCode(e.target.value)} required className="uppercase" autoComplete="off" />
          <button className="btn btn-primary shrink-0" data-testid="join-crew">
            Join
          </button>
        </div>
      </form>
      <form
        className="card mt-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          send('/crews', { name, emblem, colour });
        }}
      >
        <h2 className="text-lg">Start a crew</h2>
        <label htmlFor="crew-name" className="mt-2 text-sm font-semibold">
          Crew name
        </label>
        <input id="crew-name" required minLength={2} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        <fieldset className="mt-3">
          <legend className="text-sm font-semibold">Emblem</legend>
          <div className="mt-1 grid grid-cols-6 gap-1">
            {EMBLEMS.map((id) => (
              <button
                type="button"
                key={id}
                aria-pressed={emblem === id}
                aria-label={ASSETS[id].alt}
                onClick={() => setEmblem(id)}
                className={`min-h-11 rounded-xl border-2 p-0.5 ${emblem === id ? 'border-indigo bg-apricot' : 'border-transparent'}`}
              >
                <Art id={id} alt="" className="w-full" />
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="mt-3">
          <legend className="text-sm font-semibold">Colour</legend>
          <div className="mt-1 flex gap-2">
            {COLOURS.map((c) => (
              <button
                type="button"
                key={c}
                aria-pressed={colour === c}
                aria-label={`Colour ${c}`}
                onClick={() => setColour(c)}
                className={`h-11 w-11 rounded-full border-4 ${colour === c ? 'border-indigo' : 'border-white'}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </fieldset>
        <button className="btn btn-coral mt-4 w-full" data-testid="create-crew">
          Start the crew
        </button>
      </form>
    </main>
  );
}

function RecapPanel({ recap, crewName, map }: { recap: Recap | null; crewName: string; map: MapView | null }) {
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const yours = map?.crews.find((c) => c.isYours);
  const won = map?.lastTaken && map.lastTaken.crewId === yours?.id;
  const tileKind = won ? map.tiles.find((t) => t.q === map.lastTaken!.q && t.r === map.lastTaken!.r)?.kind : null;
  if (!recap && !won) return null;
  return (
    <section className="card mt-4 p-4" aria-labelledby="recap">
      <h2 id="recap" className="text-xl">
        Share cards
      </h2>
      {recap && (
        <p className="text-sm text-mute" data-testid="recap-line">
          Last season: {recap.crewName} finished {recap.rank} of {recap.crews} with {recap.tiles} tiles.
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {recap && (
          <>
            <button className="btn text-sm" data-testid="recap-portrait" onClick={() => void recapCard(recap, 'portrait').then((url) => setPreview({ url, name: 'roll-call-season.png' }))}>
              Season recap, portrait
            </button>
            <button className="btn text-sm" onClick={() => void recapCard(recap, 'square').then((url) => setPreview({ url, name: 'roll-call-season-square.png' }))}>
              Season recap, square
            </button>
          </>
        )}
        {won && (
          <button className="btn text-sm" data-testid="rested-card" onClick={() => void restedCard(crewName, tileKind ?? 'valley').then((url) => setPreview({ url, name: 'roll-call-rested.png' }))}>
            “Rested and still won the tile”
          </button>
        )}
      </div>
      {preview && (
        <div className="mt-3">
          <img src={preview.url} alt="Your share card" className="w-full rounded-xl border-2 border-indigo" data-testid="share-preview" />
          <button className="btn btn-primary mt-2 w-full" onClick={() => saveImage(preview.url, preview.name)}>
            Save the image
          </button>
        </div>
      )}
    </section>
  );
}

export function CrewScreen({ token }: { token: string }) {
  const [data, setData] = useState<{ feed: CrewFeed | null; recap: Recap | null } | null>(null);
  const [map, setMap] = useState<MapView | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  const still = useReducedMotion();

  const load = useCallback(() => {
    api<{ feed: CrewFeed | null; recap: Recap | null }>(`/api/a/${token}/crew`)
      .then((d) => {
        setData(d);
        if (d.feed) return api<MapView>(`/api/a/${token}/map`).then(setMap);
        setMap(null);
        return undefined;
      })
      .catch((err: ApiError) => setError(err.message));
  }, [token]);
  useEffect(load, [load]);
  useCrewUpdates(token, load);

  if (error) return <Problem title="The crew didn’t load"><p className="text-mute">{error}</p></Problem>;
  if (!data) return <Spinner label="Finding your crew" />;
  if (!data.feed) return <CreateOrJoin token={token} onDone={load} />;
  const { feed, recap } = data;

  const act = (path: string, json: unknown, done?: string): void => {
    setNote('');
    api(`/api/a/${token}${path}`, { json })
      .then(() => {
        if (done) setNote(done);
        load();
      })
      .catch((err: ApiError) => setNote(err.message));
  };
  const inviteUrl = `${location.origin}/join/${feed.crew.code}`;
  const taken = map?.lastTaken;
  const takenWords = taken && map ? `${map.crews.find((c) => c.id === taken.crewId)?.name} took a tile from ${map.crews.find((c) => c.id === taken.fromCrewId)?.name} this morning.` : null;

  return (
    <main id="content" className="mx-auto max-w-2xl px-4 py-5 pb-24">
      <header className="flex items-center gap-3">
        <Art id={feed.crew.emblem as AssetId} alt="" eager className="h-16 w-16" />
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl" data-testid="crew-name">
            {feed.crew.name}
          </h1>
          <p className="text-sm font-semibold text-mute">
            {feed.crew.league} League{map ? `, ${map.season.daysLeft} ${map.season.daysLeft === 1 ? 'day' : 'days'} left this season` : ''}
          </p>
        </div>
        <Art id={LEAGUE_ART[feed.crew.league] ?? 'league_dawn'} alt={`${feed.crew.league} League`} className="h-14 w-auto" />
      </header>

      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="card p-3">
          <dd className="font-display text-2xl font-extrabold text-indigo" data-testid="crew-checked-in">
            {feed.checkedIn} of {feed.total}
          </dd>
          <dt className="text-xs font-semibold text-mute">checked in</dt>
        </div>
        <div className="card p-3">
          <dd className="font-display text-2xl font-extrabold text-indigo">{feed.crewStreak}</dd>
          <dt className="text-xs font-semibold text-mute">crew streak, days</dt>
        </div>
        <div className="card p-3">
          <dd className="font-display text-2xl font-extrabold text-indigo" data-testid="my-today-points">
            +{feed.mine.today.reduce((s, e) => s + e.points, 0)}
          </dd>
          <dt className="text-xs font-semibold text-mute">your points today</dt>
        </div>
      </dl>
      {feed.needsMore > 0 && <p className="mt-2 rounded-xl bg-paper-2 p-3 text-sm font-semibold">Crews are best with 3 to 15. Invite {feed.needsMore} more to get going.</p>}

      {feed.mine.today.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm" data-testid="points-list">
          {feed.mine.today.map((e) => (
            <li key={e.reason} className="flex justify-between rounded-lg bg-paper-2 px-3 py-1.5">
              <span>{e.words}</span>
              <span className="font-bold">+{e.points}</span>
            </li>
          ))}
        </ul>
      )}

      <section className="mt-5" aria-labelledby="dawn">
        <div className="flex items-center gap-2">
          <Art id="rollo_map" alt="" className="h-12 w-auto" />
          <h2 id="dawn" className="text-2xl">
            The Dawn Map
          </h2>
        </div>
        {takenWords && (
          <motion.p initial={still ? false : { y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="mt-2 rounded-xl bg-apricot/60 p-3 font-semibold" data-testid="map-news">
            {takenWords}
          </motion.p>
        )}
        {map ? <div className="mt-2"><DawnMapView map={map} /></div> : <Spinner label="Unrolling the map" />}
        {map && (
          <ol className="mt-3 space-y-1" data-testid="league-table">
            {map.crews.map((c) => (
              <li key={c.id} className={`flex items-center gap-3 rounded-xl border-2 p-2 ${c.isYours ? 'border-indigo bg-white' : 'border-transparent bg-paper-2'}`}>
                <span className="w-5 text-center font-display font-bold">{c.rank}</span>
                <Art id={c.emblem as AssetId} alt="" className="h-9 w-9" />
                <span className="min-w-0 flex-1 font-semibold">{c.name}</span>
                <span className="font-display font-bold" data-testid={`tiles-${c.name}`}>
                  {c.tiles} tiles
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-2 text-xs text-mute">Each day your crew’s mean points spread sunrise light. Contested tiles go to the crew with more points that day. Light fades slowly if a crew stops checking in.</p>
      </section>

      <RecapPanel recap={recap} crewName={feed.crew.name} map={map} />

      <section className="mt-5" aria-labelledby="members">
        <h2 id="members" className="text-2xl">
          The crew
        </h2>
        {note && (
          <p role="status" className="mt-1 font-semibold text-teal-ink" data-testid="crew-note">
            {note}
          </p>
        )}
        <ul className="mt-2 space-y-2">
          {feed.members.map((m) => (
            <li key={m.id} className="card flex items-center gap-3 p-3" data-testid={`member-${m.name}`}>
              <Avatar name={m.name} avatar={m.avatar} size={44} />
              <div className="min-w-0 flex-1">
                <p className="font-display font-bold">
                  {m.name}
                  {m.isYou ? ' (you)' : ''}
                </p>
                <p className="text-xs text-mute">
                  {m.checkedIn ? 'Checked in' : 'Not in yet'}
                  {m.points !== undefined ? `, ${m.points} points this season` : ''}
                  {m.streak ? `, ${m.streak}-day streak` : ''}
                </p>
              </div>
              {m.canNudge && (
                <button className="btn min-h-11 px-3 text-sm" data-testid={`nudge-${m.name}`} onClick={() => act('/crew/nudge', { athleteId: m.id }, `Rollo’s on his way to ${m.name}.`)}>
                  Nudge
                </button>
              )}
              {!m.isYou && (
                <Link to={`/a/${token}/camp/${m.id}${location.search}`} className="btn min-h-11 px-3 text-sm" data-testid={`visit-${m.name}`}>
                  Camp
                </Link>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card mt-4 p-4">
        <h2 className="text-lg">Invite</h2>
        <p className="text-sm text-mute">
          Code: <strong data-testid="invite-code">{feed.crew.code}</strong>
        </p>
        <button
          className="btn mt-2 text-sm"
          onClick={() => {
            void navigator.clipboard?.writeText(inviteUrl).then(() => setCopied(true));
          }}
        >
          {copied ? 'Copied' : 'Copy invite link'}
        </button>
      </section>

      <details className="mt-4 text-sm">
        <summary className="cursor-pointer py-2 font-semibold text-indigo">What my crew sees</summary>
        <div className="mt-1 space-y-2 leading-relaxed text-mute">
          <p>Whether you’ve checked in, plus the points and streak below if you allow them. Never your pulse, breathing, HRV, jumps, reps, speed or how you feel.</p>
          <label className="flex items-center gap-2 font-semibold text-ink">
            <input type="checkbox" className="h-5 w-5" checked={feed.mine.showPoints} onChange={(e) => act('/crew/sharing', { showPoints: e.target.checked })} style={{ width: 20 }} />
            Show my points
          </label>
          <label className="flex items-center gap-2 font-semibold text-ink">
            <input type="checkbox" className="h-5 w-5" checked={feed.mine.showStreak} onChange={(e) => act('/crew/sharing', { showStreak: e.target.checked })} style={{ width: 20 }} />
            Show my streak
          </label>
          <button className="btn text-sm" data-testid="leave-crew" onClick={() => act('/crew/leave', {})}>
            Leave the crew
          </button>
        </div>
      </details>
    </main>
  );
}

const SPOTS: Record<string, { left: string; top: string; width: string }> = {
  coop: { left: '6%', top: '42%', width: '26%' },
  patch: { left: '36%', top: '60%', width: '24%' },
  track: { left: '62%', top: '58%', width: '34%' },
  barn: { left: '36%', top: '26%', width: '30%' },
  windmill: { left: '70%', top: '14%', width: '24%' },
  lighthouse: { left: '6%', top: '8%', width: '18%' },
};

/** Rollo's farm. Grows with check-ins and smart calls, and never shrinks. Buildings only. */
export function CampScreen({ token, memberId, checkedIn }: { token: string; memberId?: string | undefined; checkedIn?: boolean }) {
  const [camp, setCamp] = useState<CampView | null>(null);
  const [error, setError] = useState('');
  const still = useReducedMotion();
  useEffect(() => {
    api<CampView>(`/api/a/${token}/camp${memberId ? `/${memberId}` : ''}`)
      .then(setCamp)
      .catch((err: ApiError) => setError(err.message));
  }, [token, memberId]);
  if (error) return <Problem title="That camp didn’t load"><p className="text-mute">{error}</p></Problem>;
  if (!camp) return <Spinner label="Walking over to the farm" />;
  return (
    <main id="content" className="mx-auto max-w-2xl px-4 py-5 pb-24">
      <h1 className="text-3xl" data-testid="camp-title">
        {memberId ? `${camp.name}’s camp` : 'Your camp'}
      </h1>
      <p className="text-mute">
        {camp.stage} of 6 buildings. {memberId ? 'Buildings only here: never anyone’s readings.' : 'It never shrinks.'}
      </p>
      <div className="relative mt-3 aspect-[4/3] overflow-hidden rounded-2xl border-2 border-indigo" style={{ background: 'linear-gradient(#FFB37A 0%, #FFF6E9 38%, #CFE6C4 38%, #A9D3A2 100%)' }}>
        {camp.buildings.map((b, i) => (
          <motion.div
            key={b.id}
            className="absolute"
            style={SPOTS[b.id]}
            initial={still ? false : { scale: 0, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 14, delay: 0.15 * i }}
            data-testid={`building-${b.id}`}
          >
            <Art id={`camp_${b.id}` as AssetId} alt={b.name} eager className="w-full" />
          </motion.div>
        ))}
        <div aria-hidden className="idle-sprite absolute bottom-[2%] left-[40%]" style={{ '--frame': 'clamp(72px, 20vw, 120px)' } as CSSProperties} />
      </div>
      {camp.next && !memberId && (
        <p className="mt-3 rounded-xl bg-paper-2 p-3 font-semibold" data-testid="camp-next">
          Next up: {camp.next.name.toLowerCase()}. {camp.next.left > 0 ? 'Keep checking in and making smart calls.' : 'Nearly there.'}
        </p>
      )}
      {!memberId && checkedIn === false && <p className="mt-2 text-sm text-mute">No rush. Missed days only pause things. Rollo kept the lights on for you.</p>}
      {memberId && (
        <Link to={`/a/${token}/crew${location.search}`} className="btn mt-3">
          Back to the crew
        </Link>
      )}
    </main>
  );
}
