import { cookies } from 'next/headers';
import { answer, enterPin } from '../../actions';
import { ageSeconds, describeAccuracy, describeAge, freshness } from '../../../lib/age';
import { getJourney, type PublicJourney } from '../../../lib/api';

export const dynamic = 'force-dynamic';

function Position({ j }: { j: PublicJourney }) {
  if (!j.location) {
    return <p>No position is being shared right now. Lumo will not guess one.</p>;
  }
  const secs = ageSeconds(j.location.capturedAt, j.asOf);
  const f = freshness(secs);
  const { latitude: lat, longitude: lon } = j.location;
  return (
    <section aria-labelledby="pos">
      <h2 id="pos">{f === 'stale' ? 'Last known position' : 'Position'}</h2>
      <p>
        <strong>{describeAge(secs)}</strong>, {describeAccuracy(j.location.accuracyM)}
      </p>
      {f !== 'fresh' && <p role="status">This is not live. The phone has not reported a newer position.</p>}
      <p>
        {lat.toFixed(5)}, {lon.toFixed(5)}
      </p>
      {/* A plain link: the coordinates leave this page only if the contact chooses to open it, and never carry the journey's token. */}
      <a href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`} rel="noreferrer noopener" target="_blank">
        Open in a map
      </a>
    </section>
  );
}

export default async function JourneyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const pin = (await cookies()).get('lumo_pin')?.value;
  const r = await getJourney(token, pin);

  if (r.kind === 'invalid') {
    return (
      <>
        <h1>This link is not available</h1>
        <p>It may have expired or been turned off by the person who sent it. Ask them for a new one.</p>
      </>
    );
  }
  if (r.kind === 'unavailable') {
    return (
      <>
        <h1>Lumo could not be reached</h1>
        <p>This is not a sign that anything is wrong with the journey. Reload in a moment, or contact the person directly.</p>
      </>
    );
  }
  if (r.kind === 'pin_required') {
    return (
      <>
        <h1>Enter the PIN</h1>
        <p>The person who sent you this link gave it a PIN.</p>
        <form action={enterPin.bind(null, token)}>
          <label htmlFor="pin">PIN</label>
          <input id="pin" name="pin" inputMode="numeric" autoComplete="off" pattern="\d{4,8}" required />
          <button type="submit">Continue</button>
        </form>
      </>
    );
  }

  const j = r.journey;
  const ended = j.status.code === 'ended' || j.status.code === 'cancelled';
  return (
    <>
      <h1>{j.who}</h1>
      <p role="status" data-status={j.status.code}>
        {j.status.text}
      </p>
      {j.expectedArrivalAt && !ended && (
        <p>
          Expected by <time dateTime={j.expectedArrivalAt}>{new Date(j.expectedArrivalAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
        </p>
      )}
      {!ended && <Position j={j} />}
      {j.canRespond && (
        <section aria-labelledby="resp">
          <h2 id="resp">Can you help?</h2>
          {j.responding ? (
            <>
              <p role="status">You have said you are responding. Lumo has told {j.who} and paused its alerts.</p>
              <form action={answer.bind(null, token, 'unrespond')}>
                <button type="submit">I can&apos;t help after all</button>
              </form>
            </>
          ) : (
            <>
              <p>Pressing this tells Lumo someone is going to {j.who}. It does not contact emergency services.</p>
              <form action={answer.bind(null, token, 'respond')}>
                <button type="submit">I&apos;m responding</button>
              </form>
            </>
          )}
        </section>
      )}
      <p>
        <small>If you think {j.who} is in danger, contact your local emergency number directly.</small>
      </p>
    </>
  );
}
