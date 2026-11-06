import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './style.css';
import { Landing } from './Landing';
import { Spinner } from './ui/kit';

// Athletes on phones shouldn't download the coach's charts, and the other way round.
const AthleteApp = lazy(() => import('./athlete/AthleteApp'));
const CoachApp = lazy(() => import('./coach/CoachApp'));
const Recorder = lazy(() => import('./Recorder'));
const PoseRecorder = lazy(() => import('./pose/PoseRecorder'));
const JoinCrew = lazy(() => import('./crew/JoinCrew'));

// No StrictMode: its double-run effects would start the SDK twice per check-in, spending trial credit.
createRoot(document.getElementById('root')!).render(
    <BrowserRouter>
      <a href="#content" className="sr-only-focusable btn fixed top-2 left-2 z-50">
        Skip to content
      </a>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/a/:token/*" element={<AthleteApp />} />
          <Route path="/coach/*" element={<CoachApp />} />
          <Route path="/record" element={<Recorder />} />
          <Route path="/record-pose" element={<PoseRecorder />} />
          <Route path="/join/:code" element={<JoinCrew />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      </Suspense>
    </BrowserRouter>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register('/sw.js');
}
