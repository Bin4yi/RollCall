import type { Room } from './listener';
import { HIDE_SPOTS, TAPE_ROOMS, type Run } from './run';

/**
 * A sensible player: gathers objectives and hides when the Listener approaches. Used by the run
 * length tests and the end-to-end smoke test. It only ever acts through the public player actions.
 */
export function autopilot(run: Run): void {
  if (!run.canAct) return;
  if (run.phase === 'finale') return; // Nothing to do at the lock except breathe.

  const threatened =
    run.listener.state === 'INVESTIGATE' ||
    (run.listener.state === 'LEAVE' && run.listener.room === run.playerRoom);
  if (threatened) {
    if (!run.hidden && HIDE_SPOTS[run.playerRoom]) run.hide();
    else if (!run.hidden && run.playerRoom === 'corridor') run.move('desk');
    return;
  }
  if (run.hidden) {
    run.unhide();
    return;
  }
  if (run.task) return;

  const walk = (to: Room): void => {
    // Rooms connect through the corridor.
    run.move(run.playerRoom === 'corridor' ? to : 'corridor');
  };

  const nextTape = TAPE_ROOMS.find((room) => !run.tapes.has(room));
  if (nextTape) {
    if (run.playerRoom === nextTape) run.startTape();
    else walk(nextTape);
    return;
  }
  if (!run.hasFuse) {
    if (run.playerRoom === 'boiler') run.startFuse();
    else walk('boiler');
    return;
  }
  if (run.playerRoom !== 'corridor') {
    run.move('corridor');
    return;
  }
  if (!run.fuseInstalled) run.installFuse();
  else run.startFinale();
}
