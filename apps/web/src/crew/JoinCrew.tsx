import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Art, Disclaimer } from '../ui/kit';

/**
 * An invite link can't hold anyone's private link, so it remembers the code on this phone and fills it in
 * when they next open Crews from their own Roll Call link.
 */
export default function JoinCrew() {
  const { code = '' } = useParams();
  useEffect(() => {
    try {
      localStorage.setItem('rc_join', code);
    } catch {
      /* They can still type the code in. */
    }
  }, [code]);
  return (
    <main id="content" className="mx-auto max-w-md px-4 py-10 text-center">
      <Art id="rollo_crew" alt="" eager className="mx-auto h-44 w-auto" />
      <h1 className="mt-3 text-3xl">You’re invited to a crew</h1>
      <p className="mt-2 text-lg">
        Your code is <strong data-testid="join-code">{code.toUpperCase()}</strong>.
      </p>
      <p className="mt-2 text-mute">Open your own Roll Call link, go to Crews, and enter it. It’ll be filled in if you use this phone.</p>
      <p className="mt-2 text-sm text-mute">Crews score the decisions you make, never your readings or how hard you train. Your crew never sees your numbers.</p>
      <Disclaimer className="mt-6" />
    </main>
  );
}
