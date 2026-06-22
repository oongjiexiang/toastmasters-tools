# Mission

## Problem

Toastmasters splits member data across two separate portals:

- **Basecamp** (`basecamp.toastmasters.org`) — pathway progress, level completions, speech projects
- **Toastmasters International (TI)** (`toastmasters.org`) — paid membership status, credentials (DTM, etc.)

Neither portal offers a unified view. The TI website's built-in reports are slow to load and require manual browser interaction every time. There is no built-in way to see "who is one project away from their next level" or "which paid members haven't started Basecamp yet."

## Goal

Give the club's **Vice President of Education (VPE)** a single, fast, accurate snapshot of every member's pathway progress and membership standing — runnable in under a minute with one command.

## Scope

- **User**: The VPE of one specific club (personal tooling, not a SaaS product).
- **Output**: CSV files consumed in Google Sheets or Excel for weekly/monthly reporting.
- **Non-goals**: Multi-club support, non-officer access, replacing TI's official tools.

## Core Value

Replace a slow, click-heavy, error-prone browser workflow with a reliable CLI that produces clean CSVs the VPE can use immediately.
