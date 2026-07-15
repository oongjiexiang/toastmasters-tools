# Toastmasters Tools — User Guide

A simple Windows app that shows each club member's Pathways progress in one place.

## Install the app

1. Double-click **`Toastmasters Tools Setup 1.0.0.exe`**.
2. Windows may show a blue **"Windows protected your PC"** warning about an
   unknown publisher. This is expected — the app is safe but not signed by a
   paid certificate. Click **More info**, then **Run anyway**.
3. Follow the installer. When it finishes, open **Toastmasters Tools** from the
   Start menu.

The first time it opens, the dashboard will be empty. That is normal — the app
is not logged in to Toastmasters yet. The next section fixes that.

## First-time setup: log in to Toastmasters

You sign in to Toastmasters right inside the app. You only do this once (and
again whenever your session expires). You do **not** need to copy anything or
touch any settings files.

### 1. Click Log in

On the dashboard, top right, click the **Log in** button. (You can also use the
menu: **File → Log in to Toastmasters…**.)

### 2. Sign in on the Toastmasters window

A Toastmasters login window opens. Sign in exactly as you normally would in a
browser — your username and password, plus any verification code Toastmasters
asks for. This is the real Toastmasters site; the app never sees your password.

### 3. Sign in on the second window, if one opens

After you finish, a second window for **Basecamp** may open. If it does, sign in
there the same way. This second window only appears when the first login did not
already cover Basecamp — often it does, and no second window opens.

### 4. Done

When the login window (or windows) close, you are logged in and the dashboard
refreshes on its own. That is it — no files, no restart.

Your login **stays active until the session expires** (Toastmasters ends
sessions after a while, just like a browser). It also survives closing and
reopening the app. When the session does expire, the app will tell you — see
[Troubleshooting](#troubleshooting).

## If login doesn't work: enter cookies manually (fallback)

If the **Log in** button does not work for you, you can enter your session
cookies by hand instead. Most people never need this.

### 1. Open the logins file

In the app's menu bar, click **File → Open Credentials File…**. A small text
file called `config.env` opens in Notepad. It already has instructions inside.

### 2. Get your Basecamp cookie

1. In your web browser, go to **`basecamp.toastmasters.org`** and sign in.
2. Press **F12** to open the developer panel.
3. Click the **Application** tab, then **Cookies** in the left list.
4. Find the cookie named **`sessionid`** and copy its value.
5. Back in `config.env`, paste it right after `BASECAMP_SESSIONID=` so the line
   looks like `BASECAMP_SESSIONID=your-copied-value`.

### 3. Get your Toastmasters.org cookies

1. In your browser, go to **`www.toastmasters.org`** and sign in.
2. Press **F12**, open the **Application** tab, then **Cookies**.
3. Copy all the cookies as a single line.
4. Paste them after `TI_COOKIE=` in the file.

### 4. Club ID (optional)

Leave `CLUB_ID=` empty unless you track a club other than the default one. If
you do, paste your club number after the `=`.

### 5. Save and restart

Save the file (**Ctrl+S**), then **fully close the app and open it again**. The
app reads a hand-pasted file when it starts, so it will not notice your changes
until you restart.

## Load your data

On the dashboard, top right, there are two buttons:

1. Click **Refresh Progress** — pulls each member's Pathways progress from
   Basecamp.
2. Click **Refresh Membership** — downloads the current roster from
   Toastmasters.org.

A small message appears at the bottom of the screen while it works, then tells
you it succeeded or shows an error. Each refresh can take up to a minute.

While it runs, a **progress panel** appears just under the buttons showing what
the app is doing right now — for example "Step 1/3 — gathering the member
overview list…" and then each member as it is fetched. This is just so you can
see it is working and roughly how far along it is; you do not need to do anything
with it. When it finishes, the table fills in (or updates).

Run both whenever you want the latest numbers.

## Read the dashboard

The table lists every member with these columns:

| Column | What it shows |
| --- | --- |
| **Name** | The member's name |
| **Title** | Their earned title, if any |
| **Pathway** | The path they are working on |
| **Next level** | The level they are currently in |
| **Remaining** | Projects left in that level (or **Ready** / **Completed**) |

- Members on more than one path show a small arrow — click it to expand and see
  each path.
- Click any member row to open their **detail screen**, which lists every level
  with what is done and what is still outstanding.
- On the detail screen, click **← Back to dashboard** to return to the table.

## Export the roster

To save the membership list as a spreadsheet file:

1. On the dashboard, click the **Membership CSV** button (top right).
2. A save window opens, already pointing at your **Downloads** folder.
3. Choose a location and click **Save**.

## Where your data is kept

Click **File → Open Data Folder** to open the folder that holds the app's
database and your `config.env` logins file. This is also where you go if you
ever want to back up or reset the app's data.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| A refresh says my session expired (or fails with a "not authorized" error) | Your login timed out. Click **Log in again** in the message that appears — after you sign in, the app retries the refresh for you. You can also just click **Log in** at the top right again. |
| A refresh worked before but now fails | Same as above — sessions expire after a while. Click **Log in** (top right) and sign in again. |
| I clicked Log in but nothing loaded | Make sure you finished signing in on the Toastmasters window(s) before they closed. Click **Log in** and try again. If it still won't work, use the manual fallback in [If login doesn't work](#if-login-doesnt-work-enter-cookies-manually-fallback). |
| SmartScreen blocked the installer | Click **More info**, then **Run anyway**. The app is safe but unsigned. |
| The dashboard is empty | You have not loaded data yet — click **Refresh Progress** and **Refresh Membership**. |
