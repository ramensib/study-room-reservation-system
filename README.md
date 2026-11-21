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
icon.png  # shared app icon and web favicon
migrations/
  20261018000100_stage2.sql
.env.example
```

A historical duplicate of the SQL migration may also exist at the root; use the copy in `migrations/` as the documented one.

## Getting started

Prerequisites: Git, Node.js 24 with npm (the Milestone 3 report records Node 24.22.1 and npm 11.9.0), an Expo Go device compatible with this project's Expo SDK, and access to a disposable Supabase project. The direct dependencies and development dependencies are listed in [package.json](package.json); [package-lock.json](package-lock.json) pins the install, including transitive dependencies.

1. Clone this repository, open its root directory, and run `npm ci`. The app configuration uses the tracked root-level `icon.png`; no separate assets folder is required.
2. In a new, disposable Supabase project, review and run [the migration](migrations/20261018000100_stage2.sql) in the SQL Editor. Do not run it against an existing database with important data.
3. Copy the root `.env.example` to a root-level `.env`. Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` using your test project. Use only a publishable key; never commit `.env`, credentials, or a secret/service-role key.
4. In Supabase Authentication, create separate email/password test users that can sign in. New users receive Student profiles. To provision an Administrator, the test-project owner can use the SQL Editor to set `public.profiles.role` to `administrator` for only the approved test account, matching its exact Auth user UUID. Leave the Student account unchanged.
5. Run `npx expo start --clear` from the repository root and open the QR code in compatible Expo Go. For the team's physical iPhone setup, use the same Expo account in Expo CLI and Expo Go.
6. Sign in as Administrator and add a disposable room with a name and positive capacity. Then sign in as Student, search for the room, choose a future slot, and confirm a booking. Use **My Reservations** to view or cancel it.

On Windows PowerShell, use `npm.cmd` and `npx.cmd` if script execution policies block their PowerShell shims.

**Important:** Cloning GitHub does not provide access to the original project's private Supabase configuration or precreated test users. Ask the project owner for approved, non-secret development setup details. The project does not provide a public production service or a self-service sign-up screen. Access requires a configured Supabase project and test accounts.

## Tests and verification

From the **repository root**:

```bash
npm test
npm run typecheck
```

The Milestone 3 report records **56 passing local automated tests, with no failures or skips**, and a passing TypeScript check. See [Testing and verification](docs/TESTING.md) for coverage and limits.

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
