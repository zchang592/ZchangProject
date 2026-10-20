# Composer Opportunities — sourcing and synchronization contract

Project: Zhichang Lin's composition opportunity tracker.
Public frontend: `index.html` (GitHub Pages).
Cloud data: Supabase project `skneweesbyybsuggsvyw`, tables `public.composer_opportunities` and `public.composer_decisions`.

## Run policy
- Manual, on demand only: the user asks in the active ChatGPT conversation. No scheduled scraping.
- Widen discovery beyond The Composer's Site, using trustworthy composer-opportunity listings and organizer pages.
- Aim for at least 20 **qualified** opportunities in each requested research batch. If fewer than 20 qualify, report the actual number and why; never invent, duplicate, or pad with paid opportunities.
- Deadlines must be after today's Beijing date and within the next 365 days.
- Prioritize contemporary classical **solo and chamber** works, international eligibility, **0 application fee AND 0 mandatory participation/registration fee**. Exclude unclear fees until verified. Fully funded residencies may be included where relevant.
- Organizer official rules should be checked before insertion. Organizer URL preferred to aggregators as source_url.
- Convert verified exact deadlines to Asia/Shanghai; if there is no clock time/timezone in official rules, set `deadline_precision=date_only` (or `estimate` for an explicitly labeled earlier safe-submit date), never fabricate an hour.
- The user has requested the live website contain **every newly discussed/listed qualifying opportunity** and retain every old opportunity. Upsert new / corrected rows during the same conversation turn whenever connector access is working, then report write success or failure.
- Determine `source_key` from stable organizer, event/award title, and *edition/year*, to ensure reruns are idempotent. Do not remove old opportunity rows.
- Never mutate `public.composer_decisions` during research. `applied` = archive; `hold` = keep visible in follow-up; `rejected` = exclude that same edition from future recommendations, but preserve the row in website history. A new edition is new.
- Website's Supabase account authentication is shared with the user's existing QE Listening project. Never hard-code secret/private keys.

## Discovery sources (cross-check each item with its organizer)
1. The Composer's Site — https://composerssite.com/
2. ULYSSES Platform open opportunities — https://ulysses-platform.eu/upcoming-and-open-opportunities
3. American Composers Forum opportunities — https://composersforum.org/opportunities
4. Sound and Music opportunities — https://soundandmusic.org/opportunities/
5. ISCM (International Society for Contemporary Music) — https://iscm.org/
6. Independent Society of Musicians composer opportunities — https://www.ism.org/composers/
7. Canadian Music Centre opportunities — https://cmccanada.org/composer-opportunities-awards-commissions/
8. New Music USA programs — https://newmusicusa.org/program/new-music-creator-fund/
9. Composers Society of Singapore calls — https://cssingapore.org/
10. Relevant organizers, ensembles and festival open-call pages discovered from any of these aggregators.

Some sources often list **country/region-restricted**, membership-required, or **paid** opportunities; these are discovery sources only, not guarantees of user eligibility.

## UX requirements
- Spreadsheet-like display with name/source, Beijing deadline, instrumentation/duration, numeric total fees (only 0 when confirmed free), status actions: ✓ applied, — hold, × rejected.
- Sort nearest deadline first, preserve expired items in history, signed-in private status storage with RLS.
- Dark/light theme, glass surfaces, subtle motion with reduced-motion support.
- On-demand cloud refresh and automatic refresh when returning to an idle tab.
