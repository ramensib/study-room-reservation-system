# Study Room Reservation System

A mobile application for searching, reserving, and managing study rooms. Built as a Fall 2026 CSE 3310 software engineering team project by **Team Data**.

**Tech stack:** React Native · Expo · TypeScript · Supabase Auth · PostgreSQL

## Features

### Student
- Sign in and access Student-authorized workflows.
- Search rooms by minimum seating capacity and selected features (all selected features must match).
- View available and occupied one-hour slots by room and date.
- Confirm a reservation, including conflict handling when a slot is taken.
- View upcoming and past reservations.
- Cancel an owned active reservation before its start time.

### Administrator
- Add and edit room names, capacities, and supported features.
- View reservation records across Student accounts, including cancelled records.
- Review and cancel active reservations deemed invalid, after confirmation.

## Architecture

```text
React Native / Expo (TypeScript)
  ├── Authentication / Student / Administrator screens
  ├── Validation, time slots, reservation-history helpers
  └── Authenticated Supabase client / database service
           ├── Supabase Auth → authenticated user sessions
           └── PostgreSQL
                ├── profiles (role)
                ├── rooms (capacity, features[])
                └── reservations (room, owner, interval, status)
                     ├── Row Level Security (RLS)
                     └── Exclusion constraint: no overlapping active
                         reservations for the same room
```

The application does **not** use a custom Node.js backend. Reservation ownership, role permissions, and the active-reservation overlap constraint are handled with Supabase/PostgreSQL policies and constraints. The mobile UI uses one-hour slots from **9 AM to 9 PM, America/Chicago**, seven days per week.

## Project structure

The Expo mobile application lives at the **repository root** (not in a `mobile/` subfolder).

```text
App.tsx
index.ts
app.json
package.json
package-lock.json
tsconfig.json
src/
  AuthScreen.tsx
  RoomSearch.tsx
  RoomAvailability.tsx
  MyReservations.tsx
  RoomManagementScreen.tsx
  AllReservations.tsx
  availability.ts
  reservationHistory.ts
  services/database.ts
  lib/supabase.ts
tests/
migrations/
  20261018000100_stage2.sql
.env.example
```

A historical duplicate of the SQL migration may also exist at the root; use the copy in `migrations/` as the documented one.

## Getting started

1. Install Node.js and dependencies, then open the **cloned repository root** and run `npm install`.
2. Create your own Supabase project and apply the reviewed migration in `migrations/`. **Do not apply it to a database containing important existing data without reviewing it.**
3. In a new root-level `.env` file, configure the values shown in `.env.example`. Use **only a publishable Supabase key**, never a secret/service-role key.
4. Create test Auth users and use the approved role-management procedure to provision an Administrator test account; new users are Students by default.
5. Run `npx expo start --clear` from the repository root, then open the app on a compatible Expo Go device. For physical iPhones opening a development server, Expo CLI and Expo Go must be signed into the **same Expo account**.

On Windows PowerShell, use `npm.cmd` and `npx.cmd` if script execution policies block their PowerShell shims.

**Important:** Cloning GitHub does not provide access to the original project's private Supabase configuration or precreated test users. Ask the project owner for approved, non-secret development setup details. The project does not provide a public production service or a self-service sign-up screen. Access requires a configured Supabase project and test accounts.

## Tests and verification

From the **repository root**:

```bash
node --test tests/*.test.mjs
npm run typecheck
```

The team reported **56 passing local automated tests** at the Milestone 2 checkpoint, plus successful manual iPhone checks for the main Student and Administrator workflows. These local tests are largely isolated/mock-based; they are not a substitute for authenticated database or device acceptance tests.

**Outstanding acceptance work:**
- 100 database-level conflicting-booking trials (NFR-03).
- Full 20-case authenticated authorization suite (NFR-04).
- Performance/usability and complete target viewport-range tests.
- Extended PostgreSQL overlap scenarios.

The existing database protects against overlapping active intervals and enforces role/ownership policy. The fixed one-hour duration, hourly starts, and 9 AM–9 PM Chicago booking window are validated in the application, **not independently enforced by the current database migration**.

## Scope

This course project does not include payments, external calendar sync, QR-based room access, external maps, or email/SMS notifications.

## Credits

**Team Data — CSE 3310, Fall 2026.** Collaborative class project. See course submission materials for the separately reported contributions and verification evidence.

## License

No license has been selected yet. Contact the project owner for reuse permissions.
