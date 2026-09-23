import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { placeTourTooltip } from './tourPosition';
import { ArrowLeft, ArrowRight, Compass } from 'lucide-react';
import { tourSteps, type TourStep } from './tourSteps';

interface TourState {
  index: number;
  systemId?: string;
}

interface TourContextValue {
  tour: TourState | null;
  start: () => void;
  go: (index: number) => void;
  selectSystem: (systemId: string) => void;
  end: (explore?: boolean) => void;
}

const tooltipWidth = 520;
const tooltipHeight = 560;

const TourContext = createContext<TourContextValue | null>(null);

export function useTour() {
  const context = useContext(TourContext);
  if (!context) throw new Error('Tour controls need a TourProvider.');
  return context;
}

function replaceRoute(hash: string) {
  if (location.hash === hash) return;
  // Tour navigation does not add a browser history entry for every step.
  history.replaceState(history.state, '', hash);
  dispatchEvent(new HashChangeEvent('hashchange'));
}

/** Keep the tour alive while the user moves between the registry and a system. */
export function TourProvider({
  route,
  children,
}: {
  route: readonly string[];
  children: ReactNode;
}) {
  const [tour, setTour] = useState<TourState | null>(null);
  const page = route[0] ?? 'overview';
  const systemId = page === 'systems' ? route[1] : undefined;
  const tab = route[2] ?? 'overview';

  // Ordinary navigation stays usable. Follow a selected system or tab, and end
  // the guide on unrelated pages instead of leaving instructions on the wrong UI.
  useEffect(() => {
    setTour((current) => {
      if (!current) return current;
      let index = -1;
      if (page === 'overview') index = 0;
      else if (page === 'systems' && !systemId) index = 1;
      else if (systemId) {
        const step = tourSteps[current.index];
        index =
          current.systemId === systemId &&
          step?.page === 'system' &&
          step.tab === tab
            ? current.index
            : tourSteps.findIndex(
                (item) => item.page === 'system' && item.tab === tab,
              );
      }
      if (index < 0) return null;
      if (
        current.index === index &&
        (!systemId || current.systemId === systemId)
      )
        return current;
      return { index, systemId: systemId ?? current.systemId };
    });
  }, [page, systemId, tab]);

  function start() {
    setTour({ index: 0, systemId });
    replaceRoute('#/');
  }

  function go(index: number) {
    const step = tourSteps[index];
    if (!tour || !step || (step.page === 'system' && !tour.systemId)) return;
    setTour({ ...tour, index });
    replaceRoute(
      step.page === 'overview'
        ? '#/'
        : step.page === 'systems'
          ? '#/systems'
          : `#/systems/${encodeURIComponent(tour.systemId!)}/${step.tab}`,
    );
  }

  function selectSystem(systemId: string) {
    setTour({ index: 2, systemId });
    replaceRoute(`#/systems/${encodeURIComponent(systemId)}/overview`);
  }

  function end(explore = false) {
    const target = explore && tour ? tourSteps[tour.index]?.target : undefined;
    setTour(null);
    requestAnimationFrame(() => {
      const element =
        (target ? document.getElementById(target) : null) ??
        document.getElementById('tour-launcher') ??
        document.getElementById('tour-return') ??
        document.getElementById('main-content');
      element?.focus({ preventScroll: true });
      if (target)
        element?.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
  }

  return (
    <TourContext.Provider
      value={{
        tour,
        start,
        go,
        selectSystem,
        end,
      }}
    >
      {children}
    </TourContext.Provider>
  );
}

/** Keep the entry point visible even after the guide has been used. */
export function TourStartButton() {
  const { start } = useTour();
  return (
    <button
      id="tour-launcher"
      type="button"
      className="button button-secondary"
      onClick={start}
    >
      <Compass size={17} aria-hidden="true" /> Start guided tour
    </button>
  );
}

export function TourReturnLink() {
  return (
    <a id="tour-return" className="tour-return" href="#/">
      <Compass size={16} /> Start tour from Overview
    </a>
  );
}

interface TourPanelProps {
  placement: TourStep['page'];
  systems?: readonly { id: string; name: string }[];
  canRegister?: boolean;
  unavailable?: 'loading' | 'error';
}

export function TourPanel(props: TourPanelProps) {
  const { tour } = useTour();
  const step = tour && tourSteps[tour.index];
  if (!tour || !step || step.page !== props.placement) return null;
  return (
    <TourCard
      key={`${tour.index}:${tour.systemId ?? ''}:${props.unavailable ?? 'ready'}`}
      {...props}
      step={step}
      index={tour.index}
    />
  );
}

function TourCard({
  step,
  index,
  placement,
  systems = [],
  canRegister,
  unavailable,
}: TourPanelProps & { step: TourStep; index: number }) {
  const { tour, go, end, selectSystem } = useTour();
  const system =
    systems.find((item) => item.id === tour?.systemId) ?? systems[0];
  const systemId = system?.id;
  const card = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [offscreen, setOffscreen] = useState(false);
  const reposition = useRef(() => {});
  const selector = unavailable ? '#nav-systems' : step.anchor;
  const followsTabs = step.anchor.startsWith('#system-tabs') && !unavailable;

  useLayoutEffect(() => {
    const element = card.current;
    const anchor = document.querySelector<HTMLElement>(selector);
    if (!element || !anchor) return;
    anchor.dataset.tourActive = 'true';

    function position() {
      if (!element || !anchor) return;
      const bounds = anchor.getBoundingClientRect();
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const hidden =
        bounds.bottom <= 0 ||
        bounds.top >= viewport.height ||
        bounds.right <= 0 ||
        bounds.left >= viewport.width;
      setOffscreen(hidden);
      element.style.visibility = hidden ? 'hidden' : 'visible';
      if (hidden) return;
      const body = content.current;
      const chrome = element.offsetHeight - (body?.clientHeight ?? 0);
      const desiredHeight = Math.min(
        tooltipHeight,
        chrome + (body?.scrollHeight ?? 0),
      );
      const result = placeTourTooltip(
        bounds,
        {
          width: Math.min(tooltipWidth, viewport.width - 24),
          height: desiredHeight,
        },
        viewport,
        12,
        12,
        selector.startsWith('#nav-') ? 'right' : 'bottom',
        followsTabs ? ['bottom', 'top'] : undefined,
      );
      element.style.left = `${result.left}px`;
      element.style.top = `${result.top}px`;
      element.style.maxWidth = `${Math.min(tooltipWidth, result.maxWidth)}px`;
      element.style.maxHeight = `${Math.min(tooltipHeight, result.maxHeight)}px`;
      element.style.setProperty('--tour-arrow', `${result.arrowOffset}px`);
      element.dataset.side = result.side;
    }

    reposition.current = position;
    const bounds = anchor.getBoundingClientRect();
    if (followsTabs) {
      // Keep the walkthrough on one horizontal navigation rail. Reveal the
      // active tab horizontally, then leave room below the bar for the card.
      anchor.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: 'instant',
      });
      document
        .getElementById('system-tabs')
        ?.scrollIntoView({ block: 'start', behavior: 'instant' });
    } else if (
      bounds.top < 12 ||
      bounds.bottom > window.innerHeight - 12 ||
      bounds.left < 12 ||
      bounds.right > window.innerWidth - 12
    ) {
      anchor.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: 'instant',
      });
    }
    position();
    heading.current?.focus({ preventScroll: true });
    const observer = new ResizeObserver(position);
    observer.observe(element);
    observer.observe(anchor);
    if (content.current) observer.observe(content.current);
    const main = document.getElementById('main-content');
    if (main) observer.observe(main);
    main?.addEventListener('toggle', position, true);
    window.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
    return () => {
      delete anchor.dataset.tourActive;
      observer.disconnect();
      reposition.current = () => {};
      main?.removeEventListener('toggle', position, true);
      window.removeEventListener('scroll', position, true);
      window.removeEventListener('resize', position);
    };
  }, [selector, followsTabs]);

  return createPortal(
    <>
      {offscreen && (
        <button
          className="button button-secondary tour-resume"
          onClick={() => {
            document.querySelector(selector)?.scrollIntoView({
              block: 'center',
              inline: 'nearest',
              behavior: 'instant',
            });
            reposition.current();
            heading.current?.focus({ preventScroll: true });
          }}
        >
          Return to tour
        </button>
      )}
      <aside
        ref={card}
        className="tour-guide"
        role="dialog"
        aria-modal="false"
        aria-label="Guided tour"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            end();
          }
        }}
      >
        <span className="tour-pointer" aria-hidden="true" />
        <div className="tour-heading">
          <div className="tour-heading-label">
            <span className="tour-icon">
              <Compass size={21} aria-hidden="true" />
            </span>
            <div>
              <p className="tour-step">
                Step {index + 1} of {tourSteps.length}
              </p>
              <p className="tour-location">{step.location}</p>
            </div>
          </div>
          <button type="button" className="text-button" onClick={() => end()}>
            End tour
          </button>
        </div>
        <div ref={content} className="tour-content">
          <h2 ref={heading} tabIndex={-1}>
            {step.title}
          </h2>
          {unavailable ? (
            <p className="tour-introduction" role="status">
              {unavailable === 'loading'
                ? 'Loading this page… You can end the tour while you wait.'
                : 'This page could not be loaded. Use the navigation to choose another system, or end the tour and try again.'}
            </p>
          ) : (
            <>
              <p className="tour-introduction">{step.introduction}</p>
              {placement === 'systems' && (
                <p className="tour-choice">
                  {systems.length === 0
                    ? canRegister
                      ? 'No systems yet. Use Register system to add one yourself, or end the tour and return later.'
                      : 'No systems are available to you yet. Ask an administrator to register a system or grant you access, then return to the tour.'
                    : `Next opens “${system?.name}” for the walkthrough.`}
                </p>
              )}
              <div className="tour-details">
                <ul>
                  {step.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
                {step.example && (
                  <div className="tour-example">
                    <strong>Example</strong>
                    <p>{step.example}</p>
                  </div>
                )}
                <p className="tour-reminder">{step.reminder}</p>
              </div>
            </>
          )}
        </div>
        <footer className="tour-actions">
          <div>
            <button
              type="button"
              className="button button-secondary"
              disabled={index === 0}
              onClick={() => go(index - 1)}
            >
              <ArrowLeft size={14} /> Back
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={
                Boolean(unavailable) || (placement === 'systems' && !systemId)
              }
              onClick={() =>
                placement === 'systems' && systemId
                  ? selectSystem(systemId)
                  : index === tourSteps.length - 1
                    ? end(true)
                    : go(index + 1)
              }
            >
              {index === tourSteps.length - 1 ? 'Finish tour' : 'Next'}{' '}
              <ArrowRight size={14} />
            </button>
          </div>
        </footer>
      </aside>
    </>,
    document.body,
  );
}
