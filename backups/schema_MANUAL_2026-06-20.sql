--
-- PostgreSQL database dump
--

\restrict 9YL5DCFhIKfe3vhlxTMNHfWj7ftUMtkNtdWhgG7UAiZYTlaUVTeXtDyYJfEXSwX

-- Dumped from database version 17.10
-- Dumped by pg_dump version 17.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: enum_ErrorLogs_severity; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."enum_ErrorLogs_severity" AS ENUM (
    'error',
    'warning',
    'info'
);


ALTER TYPE public."enum_ErrorLogs_severity" OWNER TO postgres;

--
-- Name: enum_ErrorLogs_source; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."enum_ErrorLogs_source" AS ENUM (
    'frontend',
    'backend'
);


ALTER TYPE public."enum_ErrorLogs_source" OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ApiKeys; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."ApiKeys" (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    "keyPrefix" character varying(255) NOT NULL,
    "keyHash" character varying(255) NOT NULL,
    description text,
    "createdByUserId" integer,
    "isActive" boolean DEFAULT true,
    "lastUsedAt" timestamp with time zone,
    "expiresAt" timestamp with time zone,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


ALTER TABLE public."ApiKeys" OWNER TO postgres;

--
-- Name: ApiKeys_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."ApiKeys_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."ApiKeys_id_seq" OWNER TO postgres;

--
-- Name: ApiKeys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."ApiKeys_id_seq" OWNED BY public."ApiKeys".id;


--
-- Name: AuditLogs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."AuditLogs" (
    id integer NOT NULL,
    "userId" integer,
    date date,
    "time" time without time zone,
    module character varying(255),
    action character varying(255),
    "recordId" integer,
    "previousValue" json,
    "newValue" json,
    "ipAddress" character varying(255),
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


ALTER TABLE public."AuditLogs" OWNER TO postgres;

--
-- Name: AuditLogs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."AuditLogs_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."AuditLogs_id_seq" OWNER TO postgres;

--
-- Name: AuditLogs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."AuditLogs_id_seq" OWNED BY public."AuditLogs".id;


--
-- Name: Clinics; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Clinics" (
    id integer NOT NULL,
    name character varying(255),
    address character varying(255),
    phone character varying(255),
    "contactPerson" character varying(255),
    notes text,
    "isActive" boolean,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


ALTER TABLE public."Clinics" OWNER TO postgres;

--
-- Name: Clinics_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."Clinics_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Clinics_id_seq" OWNER TO postgres;

--
-- Name: Clinics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."Clinics_id_seq" OWNED BY public."Clinics".id;


--
-- Name: ErrorLogs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."ErrorLogs" (
    id integer NOT NULL,
    source public."enum_ErrorLogs_source" DEFAULT 'frontend'::public."enum_ErrorLogs_source",
    severity public."enum_ErrorLogs_severity" DEFAULT 'error'::public."enum_ErrorLogs_severity",
    message text,
    stack text,
    url character varying(255),
    "userAgent" character varying(255),
    "userId" integer,
    "ipAddress" character varying(255),
    resolved boolean DEFAULT false,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


ALTER TABLE public."ErrorLogs" OWNER TO postgres;

--
-- Name: ErrorLogs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."ErrorLogs_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."ErrorLogs_id_seq" OWNER TO postgres;

--
-- Name: ErrorLogs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."ErrorLogs_id_seq" OWNED BY public."ErrorLogs".id;


--
-- Name: Medications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Medications" (
    id integer NOT NULL,
    "rxRecordId" integer,
    name character varying(255),
    quantity integer,
    notes text,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


ALTER TABLE public."Medications" OWNER TO postgres;

--
-- Name: Medications_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."Medications_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Medications_id_seq" OWNER TO postgres;

--
-- Name: Medications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."Medications_id_seq" OWNED BY public."Medications".id;


--
-- Name: PatientLocks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."PatientLocks" (
    id integer NOT NULL,
    "patientId" integer NOT NULL,
    "userId" integer NOT NULL,
    "lockedAt" timestamp with time zone NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


ALTER TABLE public."PatientLocks" OWNER TO postgres;

--
-- Name: PatientLocks_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."PatientLocks_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."PatientLocks_id_seq" OWNER TO postgres;

--
-- Name: PatientLocks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."PatientLocks_id_seq" OWNED BY public."PatientLocks".id;


--
-- Name: PatientNotes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."PatientNotes" (
    id integer NOT NULL,
    "patientId" integer NOT NULL,
    "userId" integer,
    note text NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


ALTER TABLE public."PatientNotes" OWNER TO postgres;

--
-- Name: PatientNotes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."PatientNotes_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."PatientNotes_id_seq" OWNER TO postgres;

--
-- Name: PatientNotes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."PatientNotes_id_seq" OWNED BY public."PatientNotes".id;


--
-- Name: PatientTransportCompanies; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."PatientTransportCompanies" (
    id integer NOT NULL,
    "companyName" character varying(255),
    phone character varying(255),
    "contactPerson" character varying(255),
    notes text,
    "isActive" boolean,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


ALTER TABLE public."PatientTransportCompanies" OWNER TO postgres;

--
-- Name: PatientTransportCompanies_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."PatientTransportCompanies_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."PatientTransportCompanies_id_seq" OWNER TO postgres;

--
-- Name: PatientTransportCompanies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."PatientTransportCompanies_id_seq" OWNED BY public."PatientTransportCompanies".id;


--
-- Name: Patients; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Patients" (
    id integer NOT NULL,
    "firstName" character varying(255),
    "lastName" character varying(255),
    dob date,
    address character varying(255),
    phone character varying(255),
    "serviceDate" date,
    "patientTransportCompanyId" integer,
    "pharmacyTransportCompanyId" integer,
    notes text,
    "isActive" boolean,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    "patientCode" character varying(255) NOT NULL,
    "clinicId" integer,
    "isDeleted" boolean DEFAULT false NOT NULL
);


ALTER TABLE public."Patients" OWNER TO postgres;

--
-- Name: Patients_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."Patients_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Patients_id_seq" OWNER TO postgres;

--
-- Name: Patients_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."Patients_id_seq" OWNED BY public."Patients".id;


--
-- Name: Pharmacies; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Pharmacies" (
    id integer NOT NULL,
    name character varying(255),
    address character varying(255),
    phone character varying(255),
    "contactPerson" character varying(255),
    notes text,
    "isActive" boolean,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


ALTER TABLE public."Pharmacies" OWNER TO postgres;

--
-- Name: Pharmacies_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."Pharmacies_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Pharmacies_id_seq" OWNER TO postgres;

--
-- Name: Pharmacies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."Pharmacies_id_seq" OWNED BY public."Pharmacies".id;


--
-- Name: PharmacyTransportCompanies; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."PharmacyTransportCompanies" (
    id integer NOT NULL,
    "companyName" character varying(255),
    phone character varying(255),
    "contactPerson" character varying(255),
    notes text,
    "isActive" boolean,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


ALTER TABLE public."PharmacyTransportCompanies" OWNER TO postgres;

--
-- Name: PharmacyTransportCompanies_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."PharmacyTransportCompanies_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."PharmacyTransportCompanies_id_seq" OWNER TO postgres;

--
-- Name: PharmacyTransportCompanies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."PharmacyTransportCompanies_id_seq" OWNED BY public."PharmacyTransportCompanies".id;


--
-- Name: RXHistories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."RXHistories" (
    id integer NOT NULL,
    "rxRecordId" integer NOT NULL,
    "userId" integer,
    "changeType" character varying(50) DEFAULT 'Update'::character varying,
    snapshot text NOT NULL,
    "changedFields" text,
    note character varying(255),
    "createdAt" timestamp with time zone NOT NULL
);


ALTER TABLE public."RXHistories" OWNER TO postgres;

--
-- Name: RXHistories_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."RXHistories_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."RXHistories_id_seq" OWNER TO postgres;

--
-- Name: RXHistories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."RXHistories_id_seq" OWNED BY public."RXHistories".id;


--
-- Name: RXRecords; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."RXRecords" (
    id integer NOT NULL,
    "patientId" integer,
    "arrivalDate" date,
    "serviceDate" date,
    "pharmacyId" integer,
    "patientTransportCompanyId" integer,
    "pharmacyTransportCompanyId" integer,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    "isDeleted" boolean DEFAULT false NOT NULL,
    "deletedAt" timestamp with time zone
);


ALTER TABLE public."RXRecords" OWNER TO postgres;

--
-- Name: RXRecords_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."RXRecords_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."RXRecords_id_seq" OWNER TO postgres;

--
-- Name: RXRecords_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."RXRecords_id_seq" OWNED BY public."RXRecords".id;


--
-- Name: RXWorkflowTrackings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."RXWorkflowTrackings" (
    id integer NOT NULL,
    "rxRecordId" integer,
    "workflowActionId" integer,
    "completionDate" timestamp with time zone,
    "userId" integer,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


ALTER TABLE public."RXWorkflowTrackings" OWNER TO postgres;

--
-- Name: RXWorkflowTrackings_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."RXWorkflowTrackings_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."RXWorkflowTrackings_id_seq" OWNER TO postgres;

--
-- Name: RXWorkflowTrackings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."RXWorkflowTrackings_id_seq" OWNED BY public."RXWorkflowTrackings".id;


--
-- Name: Roles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Roles" (
    id integer NOT NULL,
    name character varying(255),
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


ALTER TABLE public."Roles" OWNER TO postgres;

--
-- Name: Roles_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."Roles_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Roles_id_seq" OWNER TO postgres;

--
-- Name: Roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."Roles_id_seq" OWNED BY public."Roles".id;


--
-- Name: SequelizeMeta; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."SequelizeMeta" (
    name character varying(255) NOT NULL
);


ALTER TABLE public."SequelizeMeta" OWNER TO postgres;

--
-- Name: SystemSettings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."SystemSettings" (
    id integer NOT NULL,
    key character varying(255) NOT NULL,
    value text,
    description character varying(255),
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


ALTER TABLE public."SystemSettings" OWNER TO postgres;

--
-- Name: SystemSettings_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."SystemSettings_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."SystemSettings_id_seq" OWNER TO postgres;

--
-- Name: SystemSettings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."SystemSettings_id_seq" OWNED BY public."SystemSettings".id;


--
-- Name: Users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Users" (
    id integer NOT NULL,
    "firstName" character varying(255),
    "lastName" character varying(255),
    username character varying(255),
    "passwordHash" character varying(255),
    email character varying(255),
    "roleId" integer,
    "isActive" boolean,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    permissions text
);


ALTER TABLE public."Users" OWNER TO postgres;

--
-- Name: Users_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."Users_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Users_id_seq" OWNER TO postgres;

--
-- Name: Users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."Users_id_seq" OWNED BY public."Users".id;


--
-- Name: WorkflowActions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."WorkflowActions" (
    id integer NOT NULL,
    name character varying(255),
    description text,
    "sequenceNumber" integer,
    "isActive" boolean,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


ALTER TABLE public."WorkflowActions" OWNER TO postgres;

--
-- Name: WorkflowActions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."WorkflowActions_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."WorkflowActions_id_seq" OWNER TO postgres;

--
-- Name: WorkflowActions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."WorkflowActions_id_seq" OWNED BY public."WorkflowActions".id;


--
-- Name: ApiKeys id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ApiKeys" ALTER COLUMN id SET DEFAULT nextval('public."ApiKeys_id_seq"'::regclass);


--
-- Name: AuditLogs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."AuditLogs" ALTER COLUMN id SET DEFAULT nextval('public."AuditLogs_id_seq"'::regclass);


--
-- Name: Clinics id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Clinics" ALTER COLUMN id SET DEFAULT nextval('public."Clinics_id_seq"'::regclass);


--
-- Name: ErrorLogs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ErrorLogs" ALTER COLUMN id SET DEFAULT nextval('public."ErrorLogs_id_seq"'::regclass);


--
-- Name: Medications id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Medications" ALTER COLUMN id SET DEFAULT nextval('public."Medications_id_seq"'::regclass);


--
-- Name: PatientLocks id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."PatientLocks" ALTER COLUMN id SET DEFAULT nextval('public."PatientLocks_id_seq"'::regclass);


--
-- Name: PatientNotes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."PatientNotes" ALTER COLUMN id SET DEFAULT nextval('public."PatientNotes_id_seq"'::regclass);


--
-- Name: PatientTransportCompanies id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."PatientTransportCompanies" ALTER COLUMN id SET DEFAULT nextval('public."PatientTransportCompanies_id_seq"'::regclass);


--
-- Name: Patients id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Patients" ALTER COLUMN id SET DEFAULT nextval('public."Patients_id_seq"'::regclass);


--
-- Name: Pharmacies id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Pharmacies" ALTER COLUMN id SET DEFAULT nextval('public."Pharmacies_id_seq"'::regclass);


--
-- Name: PharmacyTransportCompanies id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."PharmacyTransportCompanies" ALTER COLUMN id SET DEFAULT nextval('public."PharmacyTransportCompanies_id_seq"'::regclass);


--
-- Name: RXHistories id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."RXHistories" ALTER COLUMN id SET DEFAULT nextval('public."RXHistories_id_seq"'::regclass);


--
-- Name: RXRecords id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."RXRecords" ALTER COLUMN id SET DEFAULT nextval('public."RXRecords_id_seq"'::regclass);


--
-- Name: RXWorkflowTrackings id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."RXWorkflowTrackings" ALTER COLUMN id SET DEFAULT nextval('public."RXWorkflowTrackings_id_seq"'::regclass);


--
-- Name: Roles id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Roles" ALTER COLUMN id SET DEFAULT nextval('public."Roles_id_seq"'::regclass);


--
-- Name: SystemSettings id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."SystemSettings" ALTER COLUMN id SET DEFAULT nextval('public."SystemSettings_id_seq"'::regclass);


--
-- Name: Users id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Users" ALTER COLUMN id SET DEFAULT nextval('public."Users_id_seq"'::regclass);


--
-- Name: WorkflowActions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."WorkflowActions" ALTER COLUMN id SET DEFAULT nextval('public."WorkflowActions_id_seq"'::regclass);


--
-- Name: ApiKeys ApiKeys_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ApiKeys"
    ADD CONSTRAINT "ApiKeys_pkey" PRIMARY KEY (id);


--
-- Name: AuditLogs AuditLogs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."AuditLogs"
    ADD CONSTRAINT "AuditLogs_pkey" PRIMARY KEY (id);


--
-- Name: Clinics Clinics_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Clinics"
    ADD CONSTRAINT "Clinics_pkey" PRIMARY KEY (id);


--
-- Name: ErrorLogs ErrorLogs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ErrorLogs"
    ADD CONSTRAINT "ErrorLogs_pkey" PRIMARY KEY (id);


--
-- Name: Medications Medications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Medications"
    ADD CONSTRAINT "Medications_pkey" PRIMARY KEY (id);


--
-- Name: PatientLocks PatientLocks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."PatientLocks"
    ADD CONSTRAINT "PatientLocks_pkey" PRIMARY KEY (id);


--
-- Name: PatientNotes PatientNotes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."PatientNotes"
    ADD CONSTRAINT "PatientNotes_pkey" PRIMARY KEY (id);


--
-- Name: PatientTransportCompanies PatientTransportCompanies_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."PatientTransportCompanies"
    ADD CONSTRAINT "PatientTransportCompanies_pkey" PRIMARY KEY (id);


--
-- Name: Patients Patients_patientCode_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Patients"
    ADD CONSTRAINT "Patients_patientCode_key" UNIQUE ("patientCode");


--
-- Name: Patients Patients_patientCode_key1; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Patients"
    ADD CONSTRAINT "Patients_patientCode_key1" UNIQUE ("patientCode");


--
-- Name: Patients Patients_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Patients"
    ADD CONSTRAINT "Patients_pkey" PRIMARY KEY (id);


--
-- Name: Pharmacies Pharmacies_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Pharmacies"
    ADD CONSTRAINT "Pharmacies_pkey" PRIMARY KEY (id);


--
-- Name: PharmacyTransportCompanies PharmacyTransportCompanies_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."PharmacyTransportCompanies"
    ADD CONSTRAINT "PharmacyTransportCompanies_pkey" PRIMARY KEY (id);


--
-- Name: RXHistories RXHistories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."RXHistories"
    ADD CONSTRAINT "RXHistories_pkey" PRIMARY KEY (id);


--
-- Name: RXRecords RXRecords_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."RXRecords"
    ADD CONSTRAINT "RXRecords_pkey" PRIMARY KEY (id);


--
-- Name: RXWorkflowTrackings RXWorkflowTrackings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."RXWorkflowTrackings"
    ADD CONSTRAINT "RXWorkflowTrackings_pkey" PRIMARY KEY (id);


--
-- Name: Roles Roles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Roles"
    ADD CONSTRAINT "Roles_pkey" PRIMARY KEY (id);


--
-- Name: SequelizeMeta SequelizeMeta_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."SequelizeMeta"
    ADD CONSTRAINT "SequelizeMeta_pkey" PRIMARY KEY (name);


--
-- Name: SystemSettings SystemSettings_key_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."SystemSettings"
    ADD CONSTRAINT "SystemSettings_key_key" UNIQUE (key);


--
-- Name: SystemSettings SystemSettings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."SystemSettings"
    ADD CONSTRAINT "SystemSettings_pkey" PRIMARY KEY (id);


--
-- Name: Users Users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Users"
    ADD CONSTRAINT "Users_pkey" PRIMARY KEY (id);


--
-- Name: WorkflowActions WorkflowActions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."WorkflowActions"
    ADD CONSTRAINT "WorkflowActions_pkey" PRIMARY KEY (id);


--
-- Name: patient_locks_expires_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX patient_locks_expires_at ON public."PatientLocks" USING btree ("expiresAt");


--
-- Name: patient_locks_patient_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX patient_locks_patient_id ON public."PatientLocks" USING btree ("patientId");


--
-- Name: patient_locks_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX patient_locks_user_id ON public."PatientLocks" USING btree ("userId");


--
-- Name: ApiKeys ApiKeys_createdByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ApiKeys"
    ADD CONSTRAINT "ApiKeys_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES public."Users"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ErrorLogs ErrorLogs_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ErrorLogs"
    ADD CONSTRAINT "ErrorLogs_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."Users"(id) ON UPDATE CASCADE;


--
-- Name: PatientLocks PatientLocks_patientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."PatientLocks"
    ADD CONSTRAINT "PatientLocks_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES public."Patients"(id) ON UPDATE CASCADE;


--
-- Name: PatientLocks PatientLocks_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."PatientLocks"
    ADD CONSTRAINT "PatientLocks_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."Users"(id) ON UPDATE CASCADE;


--
-- Name: PatientNotes PatientNotes_patientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."PatientNotes"
    ADD CONSTRAINT "PatientNotes_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES public."Patients"(id) ON UPDATE CASCADE;


--
-- Name: PatientNotes PatientNotes_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."PatientNotes"
    ADD CONSTRAINT "PatientNotes_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."Users"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Patients Patients_clinicId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Patients"
    ADD CONSTRAINT "Patients_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES public."Clinics"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: RXHistories RXHistories_rxRecordId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."RXHistories"
    ADD CONSTRAINT "RXHistories_rxRecordId_fkey" FOREIGN KEY ("rxRecordId") REFERENCES public."RXRecords"(id) ON UPDATE CASCADE;


--
-- Name: RXHistories RXHistories_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."RXHistories"
    ADD CONSTRAINT "RXHistories_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."Users"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict 9YL5DCFhIKfe3vhlxTMNHfWj7ftUMtkNtdWhgG7UAiZYTlaUVTeXtDyYJfEXSwX

