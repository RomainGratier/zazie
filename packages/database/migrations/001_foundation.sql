CREATE TABLE organizations (id text PRIMARY KEY, name text NOT NULL, settings jsonb NOT NULL DEFAULT '{}');
CREATE TABLE systems (
 id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id),
 revision integer NOT NULL DEFAULT 1, evidence_revision integer NOT NULL DEFAULT 1,
 data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
 UNIQUE(organization_id,id)
);
CREATE TABLE system_revisions (
 organization_id text NOT NULL, system_id text NOT NULL, revision integer NOT NULL, data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
 PRIMARY KEY(organization_id,system_id,revision),
 FOREIGN KEY(organization_id,system_id) REFERENCES systems(organization_id,id)
);
CREATE TABLE memberships (
 id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id), issuer text NOT NULL,
 subject text NOT NULL, display_name text NOT NULL, roles text[] NOT NULL,
 system_ids text[] NOT NULL DEFAULT '{}', all_systems boolean NOT NULL DEFAULT false,
 active boolean NOT NULL DEFAULT true, UNIQUE(issuer,subject)
);
CREATE TABLE credentials (
 id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id), name text NOT NULL,
 verifier text NOT NULL UNIQUE, system_ids text[] NOT NULL, actions text[] NOT NULL,
 expires_at timestamptz NOT NULL, revoked_at timestamptz, created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE records (
 id text PRIMARY KEY, organization_id text NOT NULL, system_id text NOT NULL,
 kind text NOT NULL, revision integer NOT NULL DEFAULT 1, data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
 FOREIGN KEY(organization_id,system_id) REFERENCES systems(organization_id,id),
 UNIQUE(organization_id,system_id,id)
);
CREATE INDEX records_scope ON records(organization_id,system_id,kind,created_at,id);
CREATE TABLE record_revisions (
 organization_id text NOT NULL, system_id text NOT NULL, record_id text NOT NULL,
 revision integer NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
 PRIMARY KEY(organization_id,system_id,record_id,revision),
 FOREIGN KEY(organization_id,system_id,record_id) REFERENCES records(organization_id,system_id,id)
);
CREATE TABLE record_links (
 organization_id text NOT NULL, system_id text NOT NULL, source_id text NOT NULL, source_revision integer NOT NULL,
 target_id text NOT NULL, target_revision integer NOT NULL, relation text NOT NULL,
 PRIMARY KEY(organization_id,system_id,source_id,source_revision,target_id,relation),
 FOREIGN KEY(organization_id,system_id,source_id,source_revision) REFERENCES record_revisions(organization_id,system_id,record_id,revision),
 FOREIGN KEY(organization_id,system_id,target_id,target_revision) REFERENCES record_revisions(organization_id,system_id,record_id,revision)
);
CREATE TABLE audit_events (
 id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id), system_id text,
 actor_id text NOT NULL, action text NOT NULL, object_id text NOT NULL, revision integer,
 request_id text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,system_id) REFERENCES systems(organization_id,id)
);
CREATE TABLE idempotency (
 organization_id text NOT NULL REFERENCES organizations(id), scope text NOT NULL, operation text NOT NULL,
 key text NOT NULL, fingerprint text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,scope,operation,key)
);
CREATE TABLE event_receipts (
 organization_id text NOT NULL, system_id text NOT NULL, source text NOT NULL, event_id text NOT NULL,
 fingerprint text NOT NULL, record_id text NOT NULL,
 PRIMARY KEY(organization_id,system_id,source,event_id),
 FOREIGN KEY(organization_id,system_id,record_id) REFERENCES records(organization_id,system_id,id)
);
CREATE TABLE sessions (id text PRIMARY KEY, data jsonb NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE worker_status (id text PRIMARY KEY, heartbeat_at timestamptz NOT NULL, last_error text);
CREATE OR REPLACE FUNCTION immutable_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Evidence history is append-only'; END $$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TRIGGER revisions_immutable BEFORE UPDATE OR DELETE ON record_revisions FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TRIGGER system_revisions_immutable BEFORE UPDATE OR DELETE ON system_revisions FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TRIGGER links_immutable BEFORE UPDATE OR DELETE ON record_links FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE OR REPLACE FUNCTION protect_records() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Evidence records cannot be deleted'; END IF;
 IF OLD.kind IN ('versions','evaluations','events','artifacts','release-reviews','decisions','control-reviews','procedure-adoptions','evidence-reuse','finding-resolutions','applicability-decisions') THEN
  RAISE EXCEPTION 'This evidence record is immutable';
 END IF;
 IF NEW.organization_id <> OLD.organization_id OR NEW.system_id <> OLD.system_id OR NEW.kind <> OLD.kind OR NEW.revision <> OLD.revision + 1 THEN
  RAISE EXCEPTION 'Invalid evidence revision';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER records_protected BEFORE UPDATE OR DELETE ON records FOR EACH ROW EXECUTE FUNCTION protect_records();
