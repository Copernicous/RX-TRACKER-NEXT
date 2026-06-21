# Patient RX Delivery Management System - Implementation Plan

This document outlines the architecture, database schema, and implementation strategy for the Patient RX Delivery Management System.

## User Review Required

> [!IMPORTANT]
> Please review the database schema and proposed project structure below. Let me know if you approve this plan or if you'd like any modifications before we begin development.

## Open Questions

> [!WARNING]
> 1. **Initial Admin Credentials:** Do you have a preferred username/password for the initial administrator account that will be seeded into the database?
> 2. **Design Preferences:** Since we are using Vanilla HTML/CSS with Bootstrap 5, are there any specific color schemes or branding guidelines (logos, themes) you want to incorporate?
> 3. **Hosting/Deployment:** While PM2 is requested for deployment, do you have a specific PostgreSQL hosting provider in mind, or will it be hosted locally on the same server initially?

## Proposed Architecture

We will use a standard MVC (Model-View-Controller) architecture using Express.js.

### Technology Stack
*   **Backend:** Node.js (Latest LTS), Express.js
*   **Database:** PostgreSQL with Sequelize ORM
*   **Frontend:** HTML5, CSS3, Vanilla JavaScript, Bootstrap 5 (no SPA frameworks)
*   **Authentication:** JWT (JSON Web Tokens) with bcrypt for password hashing
*   **Deployment:** PM2

### Directory Structure
```text
/patient-rx-system
│
├── /server                 # Main server configuration
├── /routes                 # Express route definitions
├── /controllers            # Request handling logic
├── /services               # Business logic and complex operations
├── /middleware             # Authentication, error handling, validation
├── /models                 # Sequelize model definitions
├── /migrations             # Database schema migrations
├── /seeders                # Initial data seeding (Admin, Roles, Actions)
├── /views                  # EJS or simple HTML templates (served dynamically)
├── /public                 # Static assets (CSS, JS, Images, Bootstrap)
│   ├── /css
│   ├── /js
│   └── /assets
├── /uploads                # User uploaded files (if any)
├── /reports                # Generated PDF/Excel reports
├── /logs                   # Application logs
├── /docs                   # API and User documentation
├── .env                    # Environment variables
├── package.json
├── pm2.config.js           # PM2 ecosystem configuration
└── app.js                  # Application entry point
```

## PostgreSQL Database Schema

Here is an overview of the core tables we will implement using Sequelize:

### 1. Security & Users
*   **Users**: `id`, `firstName`, `lastName`, `username`, `passwordHash`, `email`, `roleId`, `isActive`, timestamps.
*   **Roles**: `id`, `name` (Administrator, Supervisor, Operator, Read Only), timestamps.
*   **AuditLogs**: `id`, `userId`, `date`, `time`, `module`, `action`, `recordId`, `previousValue` (JSON), `newValue` (JSON), `ipAddress`.

### 2. Core Entities
*   **Pharmacies**: `id`, `name`, `address`, `phone`, `contactPerson`, `notes`, `isActive`, timestamps.
*   **PatientTransportCompanies**: `id`, `companyName`, `phone`, `contactPerson`, `notes`, `isActive`, timestamps.
*   **PharmacyTransportCompanies**: `id`, `companyName`, `phone`, `contactPerson`, `notes`, `isActive`, timestamps.
*   **WorkflowActions**: `id`, `name`, `description`, `sequenceNumber`, `isActive`, timestamps.

### 3. Patients & Prescriptions
*   **Patients**: `id`, `firstName`, `lastName`, `dob`, `address`, `phone`, `serviceDate`, `patientTransportCompanyId`, `pharmacyTransportCompanyId`, `notes`, `isActive`, timestamps.
*   **RXRecords**: `id`, `patientId`, `arrivalDate`, `serviceDate`, `pharmacyId`, `patientTransportCompanyId`, `pharmacyTransportCompanyId`, timestamps.
*   **Medications**: `id`, `rxRecordId`, `name`, `quantity`, `notes`, timestamps.
*   **RXWorkflowTracking**: `id`, `rxRecordId`, `workflowActionId`, `completionDate`, `userId`, timestamps.

## Proposed Implementation Phases

### Phase 1: Foundation & Database
1.  Initialize Node.js project and install dependencies.
2.  Configure Express server and middleware (body-parser, CORS, Morgan logger).
3.  Set up Sequelize connection to PostgreSQL.
4.  Create all Sequelize models, migrations, and relationships.
5.  Create initial seeders for Roles, Workflow Actions, and an Admin user.

### Phase 2: Authentication & Security
1.  Implement User Model methods for password hashing.
2.  Create Auth Controller (Login, Profile).
3.  Implement JWT generation and verification middleware.
4.  Implement Role-Based Access Control (RBAC) middleware.
5.  Implement Audit Logging middleware to intercept and record changes.

### Phase 3: Core CRUD Modules (Backend & Frontend)
1.  Develop REST APIs and UI for:
    *   Pharmacies
    *   Patient/Pharmacy Transportation Companies
    *   Users
    *   Workflow Actions (Admin only)
2.  Implement Vanilla JS frontend using Bootstrap 5 for these modules, including DataTable structures, modals for CRUD, and toast notifications.

### Phase 4: Patients & RX Management
1.  Implement Patient CRUD with the 90-day Service Date validation rule.
2.  Implement RX Record creation with Arrival Date validation.
3.  Implement dynamic Medication addition/removal within the RX form.
4.  Implement the strict sequence Workflow Tracking interface for RX Records.

### Phase 5: Dashboard & Reports
1.  Develop backend services to aggregate statistics for the dashboard (Active patients, RX statuses, Upcoming deliveries).
2.  Build the Dashboard UI with charts (using Chart.js or similar) and widgets.
3.  Implement report generation logic for PDF and Excel exports.

### Phase 6: Polish & Deployment
1.  Finalize UI (Dark/Light mode toggle, responsive design adjustments).
2.  Write PM2 ecosystem configuration.
3.  Compile documentation (API, Installation, User Manual).

## Verification Plan

### Automated Testing
*   We will run basic connection tests and script executions to ensure the Express server starts and the database syncs successfully.
*   We will use REST client testing (or curl) to verify JWT authentication flow and RBAC boundaries.

### Manual Verification
*   We will visually verify the UI components, responsive layout, and Bootstrap styling.
*   We will manually test the 90-day patient service date validation and the strict-sequence workflow logic through the UI to ensure business rules are properly enforced.
*   We will verify that the audit log accurately captures data modifications.
