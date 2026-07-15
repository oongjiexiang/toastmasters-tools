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
does not have your logins yet. The next section fixes that.

## First-time setup: add your logins

The app reads two cookies from your browser so it can see your club's data on
your behalf. You only do this once (and again whenever the cookies expire).

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
app only reads your cookies when it starts, so it will not notice them until you
restart.

## Load your data

On the dashboard, top right, there are two buttons:

1. Click **Refresh Progress** — pulls each member's Pathways progress from
   Basecamp.
2. Click **Refresh Membership** — downloads the current roster from
   Toastmasters.org.

A small message appears at the bottom of the screen while it works, then tells
you it succeeded or shows an error. Each refresh can take up to a minute. When
it finishes, the table fills in (or updates).

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
| It says my cookie isn't set | Open **File → Open Credentials File…** and check there is a value after `BASECAMP_SESSIONID=` (and `TI_COOKIE=`). Save, then close and reopen the app. |
| A refresh worked before but now fails | Cookies expire after a while. Copy fresh ones from your browser (see First-time setup), save, and restart. |
| SmartScreen blocked the installer | Click **More info**, then **Run anyway**. The app is safe but unsigned. |
| The dashboard is empty | You have not loaded data yet — click **Refresh Progress** and **Refresh Membership**. |
