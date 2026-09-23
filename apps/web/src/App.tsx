import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Boxes,
  ChevronRight,
  CircleHelp,
  FileCheck2,
  LayoutDashboard,
  LogOut,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  ApiError,
  asRecord,
  items,
  request,
  setSessionCsrf,
  text,
  type RecordData,
  type Session,
} from './api';
import {
  Badge,
  Empty,
  ErrorNotice,
  Loading,
  PageHeader,
  PrimaryButton,
  RecordForm,
  Status,
  SummaryCard,
} from './components';
import { SystemWorkspace } from './SystemWorkspace';
import { Administration } from './Administration';
import { systemForm } from './forms';
import { TourStartButton, TourPanel, TourProvider } from './SystemTour';

function useRoute() {
  const [path, setPath] = useState(location.hash.replace(/^#/, '') || '/');
  useEffect(() => {
    const change = () => setPath(location.hash.replace(/^#/, '') || '/');
    addEventListener('hashchange', change);
    return () => removeEventListener('hashchange', change);
  }, []);
  return path.split('/').filter(Boolean).map(decodeURIComponent);
}

export function App() {
  const route = useRoute();
  const session = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      const result = await request<Session>('/session');
      setSessionCsrf(result.csrfToken);
      return result;
    },
  });
  if (session.isPending)
    return (
      <div className="screen-center">
        <Brand />
        <Loading label="Opening your workspace…" />
      </div>
    );
  if (session.error instanceof ApiError && session.error.status === 401)
    return <Login />;
  if (session.error || !session.data)
    return (
      <div className="screen-center">
        <Brand />
        <ErrorNotice error={session.error} />
        <button
          className="button button-secondary"
          onClick={() => void session.refetch()}
        >
          Try again
        </button>
      </div>
    );
  return (
    <TourProvider
      key={`${session.data.organization.id}:${session.data.user.id}`}
      route={route}
    >
      <Workspace auth={session.data} route={route} />
    </TourProvider>
  );
}

function Workspace({ auth, route }: { auth: Session; route: string[] }) {
  const current = route[0] ?? 'overview';
  const isAdmin =
    auth.roles.includes('administrator') || auth.roles.includes('admin');
  const synthetic = auth.synthetic;
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Skip to main content
      </a>
      <aside className="sidebar">
        <a className="brand-link" href="#/" aria-label="Zazie home">
          <Brand />
        </a>
        <div className="organisation-label">
          <span className="organisation-mark">
            {auth.organization.name.slice(0, 1).toUpperCase()}
          </span>
          <span>
            {auth.organization.name}
            <small>AI assurance workspace</small>
          </span>
        </div>
        <nav className="main-nav" aria-label="Main navigation">
          <NavLink
            href="#/"
            active={current === 'overview'}
            icon={<LayoutDashboard size={18} />}
          >
            Overview
          </NavLink>
          <NavLink
            href="#/systems"
            active={current === 'systems'}
            icon={<Boxes size={18} />}
          >
            AI systems
          </NavLink>
          {isAdmin && (
            <NavLink
              href="#/administration"
              active={current === 'administration'}
              icon={<Settings2 size={18} />}
            >
              Administration
            </NavLink>
          )}
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={22} />
          <strong>Evidence. Review. Follow-up.</strong>
          <p>Your organisation owns the decisions. Zazie keeps the record.</p>
          <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer">
            API reference <ArrowRight size={13} />
          </a>
        </div>
        <div className="account">
          <div className="avatar">
            {(auth.user.displayName ?? auth.user.email ?? 'U')
              .slice(0, 1)
              .toUpperCase()}
          </div>
          <div>
            <strong>
              {auth.user.displayName ?? auth.user.email ?? 'Workspace member'}
            </strong>
            <span>{auth.roles.join(', ')}</span>
          </div>
          <SignOut />
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {current === 'administration'
                ? 'Administration'
                : current === 'systems'
                  ? 'AI systems'
                  : 'Overview'}
            </strong>
          </div>
          <span className="private-label">
            <ShieldCheck size={14} />
            Self-hosted
          </span>
        </header>
        {synthetic && (
          <div className="synthetic-banner">
            <Sparkles size={15} />
            Synthetic demonstration workspace. These records do not assess a
            real AI system.
          </div>
        )}
        <main id="main-content" tabIndex={-1}>
          {current === 'administration' ? (
            isAdmin ? (
              <Administration />
            ) : (
              <Empty title="Administrator access required">
                Ask an administrator to manage workspace access.
              </Empty>
            )
          ) : current === 'systems' && route[1] ? (
            <SystemWorkspace
              systemId={route[1]}
              tab={route[2] ?? 'overview'}
              session={auth}
            />
          ) : (
            <SystemList session={auth} overview={current === 'overview'} />
          )}
        </main>
        <footer className="workspace-footer">
          <span>Zazie · Open source, under your control</span>
          <span>Workflow evidence supports human judgment.</span>
        </footer>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <span className="brand">
      <span className="brand-symbol" aria-hidden="true">
        z
      </span>
      zazie<span className="brand-dot">.</span>
    </span>
  );
}

function NavLink({
  children,
  icon,
  active,
  href,
}: {
  children: ReactNode;
  icon: ReactNode;
  active: boolean;
  href: string;
}) {
  return (
    <a
      href={href}
      className={`nav-link ${active ? 'active' : ''}`}
      aria-current={active ? 'page' : undefined}
      id={
        href === '#/'
          ? 'nav-overview'
          : href === '#/systems'
            ? 'nav-systems'
            : undefined
      }
    >
      {icon}
      {children}
    </a>
  );
}

function SignOut() {
  const mutation = useMutation({
    mutationFn: () => request('/session', { method: 'DELETE' }),
    onSuccess: () => location.reload(),
  });
  return (
    <>
      <button
        className="icon-button"
        aria-label="Sign out"
        title="Sign out"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
      >
        <LogOut size={17} />
      </button>
      {mutation.error && <ErrorNotice error={mutation.error} />}
    </>
  );
}

function Login() {
  return (
    <div className="login-page">
      <section className="login-story">
        <Brand />
        <div className="login-copy">
          <p className="eyebrow">AI assurance, made operational</p>
          <h1>
            Make the evidence
            <br />
            part of the process.
          </h1>
          <p>
            Bring your systems, evaluations, and human decisions into one clear
            record.
          </p>
          <div className="login-points">
            <span>
              <FileCheck2 />
              Know what supports a release
            </span>
            <span>
              <ShieldCheck />
              Keep people in control
            </span>
            <span>
              <Boxes />
              Work with the tools you already use
            </span>
          </div>
        </div>
        <p className="login-footer">Open source. Self-hosted. Yours.</p>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <span className="login-icon">
            <ShieldCheck size={30} />
          </span>
          <h2>Welcome to Zazie</h2>
          <p>
            Sign in with your organisation’s identity provider to open your
            workspace.
          </p>
          <a className="button button-primary login-button" href="/auth/login">
            Sign in to your workspace
            <ArrowRight size={18} />
          </a>
          <div className="login-help">
            <CircleHelp size={17} />
            <p>
              Need access? Your workspace administrator manages membership and
              permissions.
            </p>
          </div>
        </div>
        <p className="login-scope">
          Zazie supports evidence and review processes. It does not certify
          regulatory compliance.
        </p>
      </section>
    </div>
  );
}

function SystemList({
  session,
  overview,
}: {
  session: Session;
  overview: boolean;
}) {
  const systems = useQuery({
    queryKey: ['systems'],
    queryFn: () => request<unknown>('/systems'),
  });
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const records = items(systems.data);
  const canEdit =
    session.allSystems === true &&
    session.roles.some((role) => ['admin', 'editor'].includes(role));
  const work = useQuery({
    queryKey: ['overview'],
    queryFn: () => request<RecordData>('/overview'),
    enabled: overview,
  });
  const statistics = asRecord(work.data);
  return (
    <>
      <PageHeader
        eyebrow={overview ? 'Your assurance workspace' : 'System registry'}
        title={overview ? 'A clear view of what needs you.' : 'Your AI systems'}
        description={
          overview
            ? 'Evidence, reviews, and follow-up across your organisation.'
            : 'Register each system once. Keep its versions, evidence, and release decisions together.'
        }
        action={
          <div className="header-actions">
            {overview && <TourStartButton />}
            {canEdit && (
              <PrimaryButton onClick={() => setCreating(true)}>
                <Plus size={17} /> Register system
              </PrimaryButton>
            )}
          </div>
        }
      />
      <TourPanel
        placement={overview ? 'overview' : 'systems'}
        systems={records.map((record) => ({
          id: text(record.id, ''),
          name: text(record.name, 'AI system'),
        }))}
        canRegister={canEdit}
        unavailable={
          !overview
            ? systems.isPending
              ? 'loading'
              : systems.error
                ? 'error'
                : undefined
            : undefined
        }
      />
      {overview && (
        <>
          <div
            id="workspace-overview"
            className="summary-grid"
            tabIndex={-1}
            aria-label="Workspace overview"
          >
            <SummaryCard
              label="Registered systems"
              value={systems.isPending ? '—' : records.length}
              description="Systems in this workspace"
              href="#/systems"
            />
            <SummaryCard
              label="Open findings"
              value={
                work.data
                  ? typeof statistics.openFindings === 'number'
                    ? statistics.openFindings
                    : items(statistics.findings).filter(
                        (finding) =>
                          finding.resolved !== true &&
                          finding.status !== 'resolved',
                      ).length
                  : '—'
              }
              description="Follow-up still required"
            />
            <SummaryCard
              label="Pending reviews"
              value={
                work.data
                  ? typeof statistics.pendingReviews === 'number'
                    ? statistics.pendingReviews
                    : items(statistics.pendingReviews).length
                  : '—'
              }
              description="Awaiting a human decision"
            />
            <SummaryCard
              label="Stale evidence"
              value={
                work.data
                  ? typeof statistics.staleEvidence === 'number'
                    ? statistics.staleEvidence
                    : items(statistics.findings).filter(
                        (finding) =>
                          finding.source === 'freshness' &&
                          finding.resolved !== true,
                      ).length
                  : '—'
              }
              description="Check continued relevance"
            />
          </div>
          <ErrorNotice error={work.error} />
        </>
      )}
      <div id="system-list" className="section-title" tabIndex={-1}>
        <div>
          <h2>{overview ? 'Systems at a glance' : 'Registered systems'}</h2>
          <p>Select a system to inspect its evidence and next actions.</p>
        </div>
        <Badge>
          {records.length} system{records.length === 1 ? '' : 's'}
        </Badge>
      </div>
      <ErrorNotice error={systems.error} />
      {systems.isPending ? (
        <Loading />
      ) : records.length === 0 ? (
        <div className="panel">
          <Empty
            title="Your first system starts here"
            action={
              canEdit && (
                <PrimaryButton onClick={() => setCreating(true)}>
                  <Plus size={16} />
                  Register system
                </PrimaryButton>
              )
            }
          >
            You do not need model weights, raw personal data, or an integration
            to register a system.
          </Empty>
        </div>
      ) : (
        <div className="system-grid">
          {records.map((system) => (
            <a
              className="system-card"
              key={text(system.id)}
              href={`#/systems/${encodeURIComponent(text(system.id))}/overview`}
            >
              <div className="system-card-top">
                <span className="system-icon">
                  <Boxes size={22} />
                </span>
                {system.synthetic === true ? (
                  <Badge tone="warning">Synthetic example</Badge>
                ) : (
                  <Badge>AI system</Badge>
                )}
              </div>
              <h3>{text(system.name)}</h3>
              <p>{text(system.intendedUse, 'Intended use not recorded.')}</p>
              <div className="system-card-meta">
                <span>
                  Owner{' '}
                  <strong>
                    {text(system.owner ?? system.ownerId, 'Unassigned')}
                  </strong>
                </span>
                <Status value={system.status ?? 'registered'} />
              </div>
              <div className="system-card-link">
                Open system workspace
                <ArrowRight size={17} />
              </div>
            </a>
          ))}
        </div>
      )}
      <div className="coverage-note">
        <ShieldCheck size={20} />
        <div>
          <strong>Draft starter profile · limited coverage</strong>
          <p>
            Requirements are versioned and linked to their sources. Review
            applicability and omissions before relying on a profile for your
            organisation.
          </p>
        </div>
      </div>
      {creating && (
        <RecordForm
          spec={{
            ...systemForm,
            fields: systemForm.fields.map((field) =>
              field.key === 'ownerId'
                ? { ...field, initial: session.user.id }
                : field,
            ),
          }}
          onClose={() => setCreating(false)}
          onSubmit={async (values, key) => {
            const created = await request<RecordData>('/systems', {
              method: 'POST',
              body: JSON.stringify(values),
              headers: { 'idempotency-key': key },
            });
            await client.invalidateQueries({ queryKey: ['systems'] });
            if (typeof created.id === 'string')
              location.hash = `/systems/${created.id}`;
          }}
        />
      )}
    </>
  );
}
