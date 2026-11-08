# CBO / NGO Portal

Records income from the community projects (Poshomill, Public Transport, Chicken Butcher) and CBO membership
admissions, with a separate portal section per leadership role.

Stack: Node.js/Express, PostgreSQL, vanilla JS frontend (no build step). Same stack as the college portal.

## Run it

```bash
cd backend
cp .env.example .env        # fill DATABASE_URL and JWT_SECRET
npm install
# create the first chief account (Project Coordinator here; use project_admin for the Project Admin)
ADMIN_USERNAME='your-login-id' ADMIN_PASSWORD='choose-a-strong-password' ADMIN_ROLE=project_coordinator npm run seed
npm start                   # http://localhost:3000  (serves the frontend too)
```

The seed also upgrades an older database from the first version of this schema. You can change your password any time from **Account**.

If the frontend is hosted separately (e.g. Netlify), set `window.API_BASE` in `frontend/index.html`
to your API URL and set `CORS_ORIGIN` in `.env` to the frontend's origin.

`npm test` runs 42 end-to-end permission/flow checks. It DROPS the portal tables in `DATABASE_URL`, so point it at a throwaway DB.

## Hosting

See `deploy/DEPLOY.md` for the step-by-step guide to host this on the shared VPS (Supabase + PM2 + nginx + Netlify).

## Logging in

- The login page asks for **Log in ID** and **Log in password**. The ID is not case sensitive; the password is.
- A chief creates each leader (name, phone, role, Log in ID). **No password is set by the chief.**
- The new leader taps **First time log in**, enters their Log in ID and the phone number the chief registered for them
  (this proves it's really them, so nobody else can claim the account by guessing the ID), and chooses their own password.
- That works **once**. After a password exists, First time log in is refused for that account for good.
  The only way to reopen it is a chief deliberately pressing **Reset password** on the Leaders screen
  (for someone who forgot it). That wipes the old password, ends their current session, and allows one new first-time log in.

## What each person can see

**The two chiefs (Project Admin, Project Coordinator) see everything:**
all members and payments, all income records, every leader's earnings, seat usage, accounts (last log in, awaiting first log in),
settings, and the **Activity** feed: every log in, failed log in, first-time log in, password change, member admitted,
payment confirmed, edit, delete, account change and settings change, with who did it and when. Filter by type or by person.

**Everyone else sees only:** the members *they* registered (with their payment status) and what *they* have earned
(referrals, Poshomill, Public Transport, Chicken Butcher, total). They can't see other leaders, anyone else's members or
income, who handled their records, settings, or any activity.

## Roles and what they can do

| Role | Seats | Rights |
|---|---|---|
| Project Admin | 1 | **Chief.** Everything below |
| Project Coordinator | 1 | **Chief.** Everything below |
| Lead Chaplain | 1 | Standard |
| Deputy Lead Chaplain | 2 | Standard |
| Lead Coordinator | 1 | Standard |
| Deputy Lead Coordinator | 2 | Standard |
| Project Clerk | 1 | Standard |
| Proposal Writer | 2 | Standard |
| Champion | 13 | Standard |
| Till Champion | 12 | Standard |

**Standard** roles: admit members, record income (always credited to themselves), and see their own earnings and
the members they admitted. They cannot edit or delete anything.

**Chiefs** additionally: confirm member payments, edit/delete members and payment details, edit/delete income records,
create/disable leader accounts and reset passwords, see the overview of every leader's earnings, change settings.
Everything anyone does is written to `audit_log` and shown on the Activity screen.

Seat counts per role are in `role_limits` (editable in SQL). The overall cap of 200 accounts that can admit members
is the `max_recruiters` setting (editable in the Settings screen).

## How money is counted

- **Referrals:** a member counts only after a chief confirms payment. At that moment the current
  *referral commission* (default KES 100) is locked in for the leader who admitted them. Changing the setting later
  does not change past commissions. Deleting a member removes their commission.
- **Poshomill / Public Transport / Chicken Butcher:** each income record is credited to one leader. A leader's
  earnings for a project are the sum of records credited to them.
- Default membership fee is KES 500 (prefills the add-member form).

## Defaults I assumed (change as needed)

- "Admin" = **Project Admin**; the two chief roles are Project Admin and Project Coordinator.
- The 200 limit = max number of accounts that can admit members (36 seats are defined by role today).
- Income records count immediately; only member payments need chief confirmation.
- "New member" at first-time log in means a new leader account created by a chief (not a CBO member admitted by a leader).
- Standard roles record income only for themselves. Chiefs can credit income to any leader.
- Membership fee KES 500, referral commission KES 100 are placeholders.

## Not built yet (next round)

- Automatic M-Pesa STK Push / payment verification (confirmation is manual for now)
- Payouts / withdrawal tracking against earnings
- CSV/PDF export, date-range reports, SMS notifications
- Self-service forgot-password (chiefs use Reset password for now)
