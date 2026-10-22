# Backtrack

A website for lectures: students tap "I'm lost" on the slide where they got lost, keep listening, and come back to it after class.

Live at https://backtrack.courses

## The problem

Every student loses part of a lecture sometimes, and fixing it in class costs the next part of the lecture. Fixing it alone after class took one interviewed student 30 minutes to an hour, so small gaps get ignored and pile up.

Backtrack makes a small gap cheap to mark and easy to find again, and it shows the professor which slides lost people while there is still time to go back over them.

## What it does

Students
- Join with a 6 digit code. No sign in, no name.
- Follow the professor's slides live, or look back at earlier ones.
- Tap I'm lost. The slide is saved, and you keep listening.
- Optionally drag on the slide to highlight the part you lost, or add a short note. Undo is one tap.
- My spots lists everything you marked after class, in slide order.
- A tap made while offline is kept in the browser and sent when the connection is back.

Teachers
- Sign in with Google, Miami accounts only (checked on the server and in the database).
- Add courses, then start a lecture from a PDF. The PDF is turned into images in the browser.
- Present from the projector view with the arrow keys or a clicker.
- Watch the live view: how many different students got lost on each slide, with their notes and no names.
- End the lecture to close the code, then look back at past lectures and export a semester CSV.

Who can see what is enforced by Supabase row level security, not only by the screens.

## Stack

- Next.js 16 (App Router, Cache Components), React 19, TypeScript
- Tailwind CSS 4, with the design tokens in `src/app/globals.css`
- Supabase: Postgres with row level security, Realtime, Storage and Auth
- PDF.js to turn slides into images in the browser
- Vercel for hosting
- Vitest, Testing Library and PGlite for tests

## Run it locally

You need Node 22 or newer and a Supabase project of your own.

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in these three names from your own project:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_SITE_URL` (use `http://localhost:3000` here; sign in falls back to the page address if it is empty)
3. In the Supabase SQL editor, run the files in `supabase/migrations` in file name order (A to Z). The files ending in `.remote.sql` set up things that only exist on hosted Supabase (the private `slides` storage bucket and the Realtime tables), so run those too.
4. In Supabase Auth, turn on anonymous sign ins and the Google provider (you need your own Google OAuth client for this), and add `http://localhost:3000/auth/callback` as a redirect URL.
5. `npm run dev` and open http://localhost:3000

Only the Supabase URL and the public anon key go in client code. Never commit `.env.local`.

Scripts: `npm run dev`, `npm run build`, `npm start`, `npm run lint`, `npm test`.

## Tests

`npm test` runs everything. It needs no network and no Supabase project.

- Component and logic tests in `src` use Vitest, Testing Library and jsdom.
- Database tests in `tests/db` apply the real migrations to PGlite (Postgres in WebAssembly) and check the row level security rules, the code limits, the stats and the CSV export.

## Built with AI tools

Most of this code was written by Claude (Anthropic), working through Claude Code. Marko Deric directed it. Here is the split.

What Claude did
- Wrote most of the code: the Next.js app, the SQL migrations and the tests.
- Worked task by task using subagent driven development. A builder agent did each task, and a separate reviewer agent checked it before it was kept. (Claude Opus was the controller, Claude Sonnet built, and Opus, Sonnet and Haiku reviewed.)
- Wrote the spec and the design prompt from Marko's decisions, did the competitor research, and turned the spec into a build plan.
- Drew the design directions and three logo concepts in Figma for Marko to choose from, then designed the final screens through the Figma connector and built them from that design.
- Drove Marko's Chrome to set up GitHub, Vercel, Supabase and Google sign in, and to apply the database migrations.
- Ran live checks on the deployed site, which found two bugs that the tests and reviews had missed.
- Drafted this README.

What Marko did
- Defined the problem from his own research and interviews, and made the spec decisions: no accounts for students, no names, what a professor can see, and that saved spots stay private.
- Chose the design direction and picked logo B.
- Approved every task order and rule.
- Did every login and every secret himself. No secret key is in this repo.
- Clicked the database confirmations himself.
- Tested it.

AI code can be wrong, and some of it was. The reviews, the database tests and the live checks are there for that reason.
